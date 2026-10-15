import path from 'node:path';
import { safeRepositoryFile } from '../context/repository.js';
import { git } from '../lib/git.js';
import { diffArguments } from '../tools/get-diff.js';
import { collectRoutes } from './adapters.js';
import { isTestFile, type RepositoryModel } from './graph.js';
import { HARD_GRAPH_LIMITS, fileId, routeId, symbolId, tableId, weakest, type Confidence, type Evidence, type Relationship } from './model.js';
import { migrationChains, repositorySchema, tableReferences } from './persistence.js';

export type ImpactCategory = 'direct' | 'transitive' | 'interface' | 'persistence' | 'test' | 'configuration';
export interface ImpactSeed { type: 'symbol' | 'file' | 'diff'; value?: string; mode?: 'working_tree' | 'staged' | 'commit' | 'range'; commit?: string; from?: string; to?: string }
export interface ImpactCandidate { target: { type: 'file' | 'symbol' | 'route' | 'table' | 'test' | 'configuration'; id: string; name: string; file?: string }; category: ImpactCategory; relationship: Relationship; relationshipPath: string[]; evidence: Evidence[]; classification: 'potential'; confidence: Confidence; depth: number; resolutionMethod: string }
export interface ImpactReport { seed: ImpactSeed & { resolved: boolean }; changed: { files: string[]; symbols: { file: string; symbol: string; line: number }[] }; impacts: ImpactCandidate[]; counts: Record<ImpactCategory, number>; depthReached: number; totalCandidates: number; truncated: boolean; confidence: Confidence }

const CATEGORY_RANK: Record<ImpactCategory, number> = { direct: 0, interface: 1, persistence: 2, test: 3, transitive: 4, configuration: 5 };
const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2, unknown: 3 };
const CONFIGURATION = /(?:^|\/)(?:Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml|\.github\/workflows\/[^/]+|\.env\.example|[^/]*\.config\.[cm]?[jt]s|tsconfig[^/]*\.json|pyproject\.toml|package\.json|requirements[^/]*\.txt|[^/]+\.toml|[^/]+\.ya?ml)$/;

async function changedByDiff(model: RepositoryModel, seed: ImpactSeed): Promise<{ files: string[]; ranges: Map<string, [number, number][]> }> {
  if (!model.gitRepository) throw new Error('GIT_REPOSITORY_REQUIRED');
  const input = { mode: seed.mode ?? 'working_tree', commit: seed.commit, from: seed.from, to: seed.to } as Parameters<typeof diffArguments>[0];
  const [names, patch] = await Promise.all([git(model.root, diffArguments(input, 'name-status')), git(model.root, [...diffArguments(input, 'patch'), ].flatMap((argument) => argument === '--patch' ? ['--patch', '-U0'] : [argument]), 30_000)]);
  if (names.status !== 'completed' || patch.status !== 'completed') throw new Error('GIT_DIFF_FAILED');
  const files = names.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.split('\t').at(-1)!.replaceAll('\\', '/')), ranges = new Map<string, [number, number][]>();
  let current: string | undefined;
  for (const line of patch.stdout.split(/\r?\n/)) { const header = /^\+\+\+ b\/(.+)$/.exec(line), hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line); if (header) current = header[1]; else if (hunk && current) ranges.set(current, [...(ranges.get(current) ?? []), [Number(hunk[1]), Number(hunk[1]) + Math.max(0, Number(hunk[2] ?? 1) - 1)]]); }
  return { files, ranges };
}

export async function changeImpact(model: RepositoryModel, seed: ImpactSeed, limits: { depth: number; maxResults: number }): Promise<ImpactReport> {
  const changedFiles: string[] = [], changedSymbols: { file: string; symbol: string; line: number }[] = [];
  let resolved = true;
  if (seed.type === 'file') { if (!seed.value) throw new Error('SEED_VALUE_REQUIRED'); const target = await safeRepositoryFile(model.root, seed.value); if (!model.allFiles.includes(target.relative)) throw new Error('SEED_FILE_NOT_FOUND'); changedFiles.push(target.relative); }
  else if (seed.type === 'symbol') { if (!seed.value) throw new Error('SEED_VALUE_REQUIRED'); for (const module of model.modules.values()) for (const symbol of module.symbols) if (symbol.symbol === seed.value) { if (!changedFiles.includes(module.file)) changedFiles.push(module.file); changedSymbols.push({ file: module.file, symbol: symbol.symbol, line: symbol.startLine }); } resolved = changedFiles.length > 0; }
  else { const diff = await changedByDiff(model, seed); changedFiles.push(...diff.files); for (const [file, ranges] of diff.ranges) for (const symbol of model.modules.get(file)?.symbols ?? []) if (ranges.some(([start, end]) => symbol.startLine <= end && symbol.endLine >= start)) changedSymbols.push({ file, symbol: symbol.symbol, line: symbol.startLine }); resolved = changedFiles.length > 0; }

  const candidates: ImpactCandidate[] = [], reached = new Map<string, { depth: number; path: string[] }>(), changedSet = new Set(changedFiles);
  const push = (candidate: ImpactCandidate) => { if (!candidates.some((existing) => existing.target.id === candidate.target.id && existing.category === candidate.category)) candidates.push(candidate); };
  let frontier = changedFiles.map((file) => ({ file, path: [fileId(file)] })), depthReached = 0;
  for (const file of changedFiles) reached.set(file, { depth: 0, path: [fileId(file)] });
  for (let depth = 1; depth <= limits.depth && frontier.length; depth++) {
    const next: typeof frontier = [];
    for (const { file, path: trail } of frontier) for (const dependent of [...(model.dependents.get(file) ?? [])].sort((a, b) => a.from.localeCompare(b.from))) {
      if (reached.has(dependent.from)) continue;
      const module = model.modules.get(dependent.from), test = module?.test ?? isTestFile(dependent.from), relationshipPath = [...trail, fileId(dependent.from)], confidence: Confidence = test ? 'medium' : depth === 1 ? 'high' : depth === 2 ? 'medium' : 'low';
      reached.set(dependent.from, { depth, path: relationshipPath }); depthReached = Math.max(depthReached, depth); next.push({ file: dependent.from, path: relationshipPath });
      push({ target: { type: test ? 'test' : 'file', id: fileId(dependent.from), name: dependent.from, file: dependent.from }, category: test ? 'test' : depth === 1 ? 'direct' : 'transitive', relationship: test ? 'covered_by_test' : 'imports', relationshipPath, evidence: [{ file: dependent.from, line: dependent.line, method: 'import_statement' }], classification: 'potential', confidence, depth, resolutionMethod: test ? 'test_import' : 'reverse_import_traversal' });
    }
    frontier = next;
  }
  for (const changed of changedSymbols) for (const module of model.modules.values()) {
    if (changedSet.has(module.file) || reached.has(module.file)) continue;
    const index = module.text.split(/\r?\n/).findIndex((line) => new RegExp(`\\b${changed.symbol.replace(/[$]/g, '\\$&')}\\b`).test(line)); if (index < 0) continue;
    reached.set(module.file, { depth: 1, path: [symbolId(changed.file, changed.symbol), fileId(module.file)] }); depthReached = Math.max(depthReached, 1);
    push({ target: { type: module.test ? 'test' : 'file', id: fileId(module.file), name: module.file, file: module.file }, category: module.test ? 'test' : 'direct', relationship: module.test ? 'covered_by_test' : 'references', relationshipPath: [symbolId(changed.file, changed.symbol), fileId(module.file)], evidence: [{ file: module.file, line: index + 1, method: 'textual_reference' }], classification: 'potential', confidence: 'low', depth: 1, resolutionMethod: 'textual_reference' });
  }
  for (const changed of changedFiles) { const stem = path.posix.basename(changed).replace(/\.[^.]+$/, ''); for (const module of model.modules.values()) if (module.test && !reached.has(module.file) && !changedSet.has(module.file) && new RegExp(`(?:^|/)(?:test_${stem}|${stem}[._-]?(?:test|spec))\\.`).test(module.file)) { reached.set(module.file, { depth: 1, path: [fileId(changed), fileId(module.file)] }); push({ target: { type: 'test', id: fileId(module.file), name: module.file, file: module.file }, category: 'test', relationship: 'covered_by_test', relationshipPath: [fileId(changed), fileId(module.file)], evidence: [{ file: module.file, method: 'test_naming_convention' }], classification: 'potential', confidence: 'low', depth: 1, resolutionMethod: 'test_naming_convention' }); } }

  const { routes } = collectRoutes(model);
  for (const route of routes) { const hit = reached.get(route.file); if (!hit) continue; push({ target: { type: 'route', id: routeId(route.method, route.path), name: `${route.method} ${route.path}`, file: route.file }, category: 'interface', relationship: 'handles_route', relationshipPath: [...hit.path, routeId(route.method, route.path)], evidence: [route.evidence], classification: 'potential', confidence: weakest(route.confidence, hit.depth === 0 ? 'high' : hit.depth === 1 ? 'high' : 'medium'), depth: hit.depth, resolutionMethod: route.resolutionMethod }); }

  const schema = await repositorySchema(model), references = tableReferences(model, schema), chains = await migrationChains(model);
  for (const reference of references) { const hit = reached.get(reference.file); if (!hit) continue; push({ target: { type: 'table', id: tableId(reference.table), name: reference.table, file: schema.tables.find((record) => record.name === reference.table)?.source.file }, category: 'persistence', relationship: reference.relationship, relationshipPath: [...hit.path, tableId(reference.table)], evidence: [{ file: reference.file, line: reference.line, method: reference.method }], classification: 'potential', confidence: weakest(reference.confidence, hit.depth <= 1 ? 'high' : 'medium'), depth: hit.depth, resolutionMethod: reference.method }); }
  const changedTables = [...schema.tables.filter((record) => changedSet.has(record.source.file)).map((record) => ({ table: record.name, file: record.source.file, line: record.source.line, method: record.resolutionMethod, confidence: record.confidence })), ...chains.flatMap((chain) => chain.migrations.filter((migration) => changedSet.has(migration.file)).flatMap((migration) => migration.operations.map((operation) => ({ table: operation.table, file: migration.file, line: operation.line, method: operation.type, confidence: chain.confidence }))))];
  for (const changed of changedTables) {
    push({ target: { type: 'table', id: tableId(changed.table), name: changed.table, file: changed.file }, category: 'persistence', relationship: changed.method.startsWith('migration_') ? changed.method as Relationship : 'references_table', relationshipPath: [fileId(changed.file), tableId(changed.table)], evidence: [{ file: changed.file, line: changed.line, method: changed.method }], classification: 'potential', confidence: changed.confidence, depth: 0, resolutionMethod: changed.method });
    for (const reference of references.filter((item) => item.table === changed.table && !changedSet.has(item.file))) { const test = model.modules.get(reference.file)?.test ?? false; if (!reached.has(reference.file)) reached.set(reference.file, { depth: 1, path: [fileId(changed.file), tableId(changed.table), fileId(reference.file)] }); push({ target: { type: test ? 'test' : 'file', id: fileId(reference.file), name: reference.file, file: reference.file }, category: 'persistence', relationship: reference.relationship, relationshipPath: [fileId(changed.file), tableId(changed.table), fileId(reference.file)], evidence: [{ file: reference.file, line: reference.line, method: reference.method }], classification: 'potential', confidence: weakest(changed.confidence, reference.confidence), depth: 1, resolutionMethod: reference.method }); }
  }
  for (const file of changedFiles) if (CONFIGURATION.test(file)) push({ target: { type: 'configuration', id: fileId(file), name: file, file }, category: 'configuration', relationship: 'references', relationshipPath: [fileId(file)], evidence: [{ file, method: 'configuration_file_change' }], classification: 'potential', confidence: 'medium', depth: 0, resolutionMethod: 'configuration_file_change' });

  const ranked = candidates.sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || a.depth - b.depth || CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] || a.target.id.localeCompare(b.target.id));
  const impacts = ranked.slice(0, limits.maxResults), counts = { direct: 0, transitive: 0, interface: 0, persistence: 0, test: 0, configuration: 0 } as Record<ImpactCategory, number>;
  for (const candidate of impacts) counts[candidate.category]++;
  const direct = impacts.filter((candidate) => candidate.category === 'direct');
  const depthTruncated = frontier.some(({ file }) => (model.dependents.get(file) ?? []).some((dependent) => !reached.has(dependent.from)));
  return { seed: { ...seed, resolved }, changed: { files: changedFiles, symbols: changedSymbols }, impacts, counts, depthReached, totalCandidates: ranked.length, truncated: ranked.length > impacts.length || depthTruncated || model.truncated, confidence: !impacts.length ? 'unknown' : direct.length && direct.every((candidate) => candidate.confidence === 'high') ? 'high' : impacts.some((candidate) => candidate.confidence !== 'low') ? 'medium' : 'low' };
}

export const IMPACT_LIMITS = { depth: HARD_GRAPH_LIMITS.maxDepth, maxResults: HARD_GRAPH_LIMITS.maxResults } as const;
