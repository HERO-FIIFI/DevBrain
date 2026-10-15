import { createHash } from 'node:crypto';
import path from 'node:path';
import { contextRoot, readRepositoryText, repositoryFiles } from '../context/repository.js';
import { symbolsInText, type SymbolRecord } from '../context/symbols.js';
import { gitProvenance } from '../execution/evidence.js';
import { git } from '../lib/git.js';
import { modifiedTime } from '../lib/filesystem.js';
import { detectStack, type StackDetection } from '../lib/stack-detector.js';
import { HARD_GRAPH_LIMITS, externalId, fileId, memoized, packageId, symbolId, type Confidence, type GraphEdge, type GraphNode } from './model.js';

export type Language = 'typescript' | 'javascript' | 'python';
export interface ImportRecord { specifier: string; line: number; names: string[]; resolved?: string; external?: string; declared?: boolean; unresolved: boolean }
export interface ClassRecord { name: string; line: number; bases: string[]; implements: string[] }
export interface ModuleInfo { file: string; package: string; language: Language; text: string; imports: ImportRecord[]; exports: string[]; symbols: SymbolRecord[]; classes: ClassRecord[]; test: boolean }
export interface PackageInfo { id: string; directory: string; name: string; manifests: string[]; dependencies: string[]; entryPoints: string[]; workspace: boolean }
export interface RepositoryModel {
  root: string; gitRepository: boolean; provenance: { sha?: string; branch?: string; dirty: boolean; dirtyFileCount: number }; stack: StackDetection;
  allFiles: string[]; files: string[]; sourceFileCount: number; truncated: boolean; ignoredFiles: number;
  packages: PackageInfo[]; modules: Map<string, ModuleInfo>; dependents: Map<string, { from: string; line: number; names: string[] }[]>;
}

const languageOf = (file: string): Language | null => /\.tsx?$/.test(file) ? 'typescript' : /\.(?:[cm]?js|jsx)$/.test(file) ? 'javascript' : file.endsWith('.py') ? 'python' : null;
export const isTestFile = (file: string) => /(?:^|\/)(?:tests?|__tests__|spec)\//.test(file) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) || /(?:^|\/)(?:test_[^/]+|[^/]+_test|conftest)\.py$/.test(file);
const NODE_BUILTINS = new Set(['assert','buffer','child_process','cluster','crypto','dgram','dns','events','fs','http','http2','https','module','net','os','path','perf_hooks','process','querystring','readline','stream','string_decoder','timers','tls','tty','url','util','v8','vm','worker_threads','zlib']);
const PY_STDLIB = new Set(['__future__','abc','argparse','array','asyncio','base64','bisect','calendar','collections','concurrent','contextlib','copy','csv','ctypes','dataclasses','datetime','decimal','difflib','enum','functools','glob','gzip','hashlib','heapq','html','http','importlib','inspect','io','ipaddress','itertools','json','logging','math','mimetypes','multiprocessing','numbers','operator','os','pathlib','pickle','platform','pprint','queue','random','re','secrets','select','shutil','signal','socket','sqlite3','ssl','statistics','string','struct','subprocess','sys','tempfile','textwrap','threading','time','traceback','types','typing','unicodedata','unittest','urllib','uuid','warnings','weakref','xml','zipfile']);
const packageNameOf = (specifier: string) => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
const normalizePython = (name: string) => name.toLowerCase().replaceAll('-', '_');

function parseImports(file: string, language: Language, text: string): { imports: { specifier: string; line: number; names: string[] }[]; classes: ClassRecord[]; exports: string[] } {
  const lines = text.split(/\r?\n/), imports: { specifier: string; line: number; names: string[] }[] = [], classes: ClassRecord[] = [], exports: string[] = [];
  if (language === 'python') {
    for (const [index, line] of lines.entries()) {
      const from = /^\s*from\s+([.\w]+)\s+import\s+(.+)$/.exec(line), plain = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/.exec(line), cls = /^\s*class\s+(\w+)(?:\(([^)]*)\))?\s*:/.exec(line);
      if (from) imports.push({ specifier: from[1], line: index + 1, names: from[2].replace(/[()]/g, '').split(',').flatMap((name) => name.trim().split(/\s+as\s+/)).filter(Boolean) }); // original and alias: symbols resolve by the former, mounts by the latter
      else if (plain) for (const name of plain[1].split(',')) imports.push({ specifier: name.trim(), line: index + 1, names: [] });
      if (cls) classes.push({ name: cls[1], line: index + 1, bases: (cls[2] ?? '').split(',').map((base) => base.trim().replace(/\[.*$/, '')).filter((base) => base && !['object','ABC','Protocol','Generic'].includes(base)), implements: [] });
    }
    const all = /__all__\s*=\s*\[([^\]]*)\]/.exec(text);
    exports.push(...(all ? [...all[1].matchAll(/["']([\w]+)["']/g)].map((match) => match[1]) : symbolsInText(file, text).map((symbol) => symbol.symbol)));
    return { imports, classes, exports };
  }
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(/(?:import|export)\s+(?:type\s+)?(?:([\w$]+|\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})(?:\s*,\s*(?:[\w$]+|\{[^}]*\}))?\s+from\s+)?["']([^"']+)["']/g)) imports.push({ specifier: match[2], line: index + 1, names: (match[1] ?? '').replace(/[{}]/g, '').split(',').flatMap((name) => name.trim().split(/\s+as\s+/)).filter((name) => name && name !== '*') });
    for (const match of line.matchAll(/(?:require|import)\(\s*["']([^"']+)["']\s*\)/g)) imports.push({ specifier: match[1], line: index + 1, names: [] });
    const cls = /(?:^|\s)class\s+([\w$]+)(?:\s+extends\s+([\w$.]+))?(?:\s+implements\s+([\w$.,\s]+?))?\s*\{/.exec(line);
    if (cls) classes.push({ name: cls[1], line: index + 1, bases: cls[2] ? [cls[2].split('.').at(-1)!] : [], implements: (cls[3] ?? '').split(',').map((name) => name.trim().split('.').at(-1) ?? '').filter(Boolean) });
    const named = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([\w$]+)/.exec(line);
    if (named) exports.push(named[1]);
    const list = /^\s*export\s+\{([^}]*)\}/.exec(line);
    if (list) exports.push(...list[1].split(',').map((name) => name.trim().split(/\s+as\s+/).at(-1) ?? '').filter(Boolean));
  }
  return { imports, classes, exports };
}

async function readPackages(root: string, files: string[]): Promise<PackageInfo[]> {
  const byDirectory = new Map<string, PackageInfo>();
  const record = (directory: string, manifest: string, name: string | undefined, dependencies: string[], entryPoints: string[] = []) => {
    const existing = byDirectory.get(directory) ?? { id: packageId(directory), directory, name: name ?? (directory || 'root'), manifests: [], dependencies: [], entryPoints: [], workspace: directory !== '' };
    existing.manifests.push(manifest); existing.dependencies = [...new Set([...existing.dependencies, ...dependencies])]; existing.entryPoints = [...new Set([...existing.entryPoints, ...entryPoints.map((entry) => path.posix.normalize(path.posix.join(directory, entry)))])]; if (name && existing.name === (directory || 'root')) existing.name = name;
    byDirectory.set(directory, existing);
  };
  const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
  for (const file of files) {
    const base = path.posix.basename(file), directory = path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file);
    try {
      if (base === 'package.json') { const pkg = JSON.parse((await readRepositoryText(root, file)).text); record(directory, file, typeof pkg.name === 'string' ? pkg.name : undefined, Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }), [pkg.main, pkg.module, pkg.bin, pkg.exports].flatMap(strings).filter((entry) => /\.[cm]?[jt]sx?$/.test(entry))); }
      else if (base === 'pyproject.toml') { const text = (await readRepositoryText(root, file)).text, name = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(text)?.[1], block = /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(text)?.[1] ?? ''; record(directory, file, name, [...block.matchAll(/["']\s*([A-Za-z0-9_.-]+)/g)].map((match) => normalizePython(match[1])), [...text.matchAll(/^\s*[\w-]+\s*=\s*["']([\w.]+):\w+["']/gm)].map((match) => `${match[1].replaceAll('.', '/')}.py`)); }
      else if (base === 'requirements.txt') { const text = (await readRepositoryText(root, file)).text; record(directory, file, undefined, text.split(/\r?\n/).map((line) => /^\s*([A-Za-z0-9_.-]+)/.exec(line)?.[1]).filter((name): name is string => Boolean(name)).map(normalizePython)); }
    } catch { /* unreadable manifest: package still discoverable from other evidence */ }
  }
  if (!byDirectory.has('')) byDirectory.set('', { id: packageId(''), directory: '', name: 'root', manifests: [], dependencies: [], entryPoints: [], workspace: false });
  return [...byDirectory.values()].sort((a, b) => a.directory.localeCompare(b.directory));
}

export const packageFor = (packages: PackageInfo[], file: string): PackageInfo => packages.filter((pkg) => !pkg.directory || file.startsWith(`${pkg.directory}/`)).sort((a, b) => b.directory.length - a.directory.length)[0] ?? packages[0];

function resolveSpecifier(module: { file: string; language: Language; package: PackageInfo }, specifier: string, names: string[], fileSet: Set<string>, aliases: Map<string, string>, packages: PackageInfo[]): Partial<ImportRecord> {
  const exists = (candidates: string[]) => candidates.map((candidate) => path.posix.normalize(candidate)).find((candidate) => fileSet.has(candidate));
  if (module.language === 'python') {
    const level = specifier.match(/^\.*/)?.[0].length ?? 0, dotted = specifier.slice(level).replaceAll('.', '/');
    const bases = level ? [path.posix.join(path.posix.dirname(module.file), '../'.repeat(Math.max(0, level - 1)), dotted)] : [...new Set(['', 'src', module.package.directory, `${module.package.directory}/src`].map((prefix) => path.posix.join(prefix, dotted)))];
    const resolved = exists(bases.flatMap((base) => [...names.map((name) => `${base}/${name}.py`), `${base}.py`, `${base}/__init__.py`])); // ponytail: first importable name wins; `from x import a, b` yields one edge
    if (resolved) return { resolved, unresolved: false };
    if (level) return { unresolved: true };
    const top = normalizePython(specifier.split('.')[0]);
    if (PY_STDLIB.has(top)) return { unresolved: false };
    return module.package.dependencies.includes(top) ? { external: top, declared: true, unresolved: false } : { external: top, declared: false, unresolved: false };
  }
  let base: string | undefined;
  if (specifier.startsWith('.')) base = path.posix.join(path.posix.dirname(module.file), specifier);
  else for (const [prefix, target] of aliases) if (specifier.startsWith(prefix)) base = path.posix.join(target, specifier.slice(prefix.length));
  if (base) {
    const stripped = base.replace(/\.(?:[cm]?js|jsx)$/, '');
    const resolved = exists([base, `${stripped}.ts`, `${stripped}.tsx`, `${stripped}.js`, `${stripped}.jsx`, `${stripped}.mjs`, `${stripped}.cjs`, ...['ts','tsx','js','jsx','mjs','cjs'].map((extension) => `${base}/index.${extension}`)]);
    return resolved ? { resolved, unresolved: false } : { unresolved: true };
  }
  const name = packageNameOf(specifier);
  if (specifier.startsWith('node:') || NODE_BUILTINS.has(name)) return { unresolved: false };
  const workspace = packages.find((pkg) => pkg.name === name && pkg.directory);
  if (workspace) { const entry = exists(['index.ts','index.js','src/index.ts','src/index.js'].map((candidate) => `${workspace.directory}/${candidate}`)); return entry ? { resolved: entry, unresolved: false } : { external: name, declared: true, unresolved: false }; }
  return { external: name, declared: module.package.dependencies.includes(name), unresolved: false };
}

async function readAliases(root: string, files: string[]): Promise<Map<string, string>> {
  const aliases = new Map<string, string>();
  for (const file of files.filter((candidate) => path.posix.basename(candidate) === 'tsconfig.json')) {
    try {
      const config = JSON.parse((await readRepositoryText(root, file)).text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')), directory = path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file), baseUrl = config.compilerOptions?.baseUrl ?? '.';
      for (const [pattern, targets] of Object.entries(config.compilerOptions?.paths ?? {})) if (pattern.endsWith('/*') && Array.isArray(targets) && typeof targets[0] === 'string') aliases.set(pattern.slice(0, -1), path.posix.normalize(path.posix.join(directory, baseUrl, String(targets[0]).replace(/\/?\*$/, ''))));
    } catch { /* invalid tsconfig: no aliases */ }
  }
  return aliases;
}

async function buildModel(root: string, gitRepository: boolean): Promise<RepositoryModel> {
  const [listing, stack, provenance] = await Promise.all([repositoryFiles(root, gitRepository), detectStack(root), gitRepository ? gitProvenance(root) : Promise.resolve({ dirty: false, dirtyFileCount: 0 })]);
  const packages = await readPackages(root, listing.files), aliases = await readAliases(root, listing.files), fileSet = new Set(listing.files);
  const source = listing.files.filter((file) => languageOf(file)), files = source.slice(0, HARD_GRAPH_LIMITS.maxFiles), modules = new Map<string, ModuleInfo>(), dependents = new Map<string, { from: string; line: number; names: string[] }[]>();
  for (const file of files) {
    try {
      const language = languageOf(file)!, text = (await readRepositoryText(root, file, 200_000)).text, parsed = parseImports(file, language, text), pkg = packageFor(packages, file);
      const imports = parsed.imports.map((record) => ({ ...record, ...resolveSpecifier({ file, language, package: pkg }, record.specifier, record.names, fileSet, aliases, packages) } as ImportRecord));
      modules.set(file, { file, package: pkg.id, language, text, imports, exports: [...new Set(parsed.exports)], symbols: symbolsInText(file, text), classes: parsed.classes, test: isTestFile(file) });
      for (const record of imports) if (record.resolved) dependents.set(record.resolved, [...(dependents.get(record.resolved) ?? []), { from: file, line: record.line, names: record.names }]);
    } catch { /* binary or unreadable source is skipped */ }
  }
  return { root, gitRepository, provenance, stack, allFiles: listing.files, files, sourceFileCount: source.length, truncated: listing.truncated || source.length > files.length, ignoredFiles: listing.ignoredFiles, packages, modules, dependents };
}

export async function repositoryModel(candidate?: string): Promise<RepositoryModel> {
  const root = await contextRoot(candidate);
  if (!root.gitRepository) return buildModel(root.repositoryRoot, false);
  const [head, status] = await Promise.all([git(root.repositoryRoot, ['rev-parse', 'HEAD']), git(root.repositoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])]);
  const dirty = status.stdout.split('\0').filter(Boolean).map((line) => line.slice(3));
  const stamps = await Promise.all(dirty.map((file) => modifiedTime(path.join(root.repositoryRoot, file))));
  const key = `${root.repositoryRoot}|${head.stdout.trim()}|${createHash('sha256').update(status.stdout + stamps.join(',')).digest('hex')}`;
  return memoized(key, () => buildModel(root.repositoryRoot, true));
}

export function structuralEdges(model: RepositoryModel): { nodes: Map<string, GraphNode>; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>(), edges: GraphEdge[] = [];
  const node = (item: GraphNode) => { if (!nodes.has(item.id)) nodes.set(item.id, item); return item.id; };
  node({ id: 'repository:.', type: 'repository', name: path.basename(model.root) });
  for (const pkg of model.packages) { node({ id: pkg.id, type: 'package', name: pkg.name, file: pkg.manifests[0] }); for (const dependency of pkg.dependencies) edges.push({ from: pkg.id, to: node({ id: externalId(dependency), type: 'external_package', name: dependency }), relationship: 'depends_on_package', evidence: { file: pkg.manifests[0] ?? pkg.directory, method: 'manifest_declaration' }, classification: 'observed', resolutionMethod: 'manifest', confidence: 'high' }); }
  const packageLinks = new Set<string>();
  for (const module of model.modules.values()) {
    node({ id: fileId(module.file), type: 'file', name: module.file, file: module.file, package: module.package, language: module.language });
    for (const record of module.imports) {
      if (record.resolved) {
        const target = model.modules.get(record.resolved), targetPackage = target?.package ?? packageFor(model.packages, record.resolved).id;
        node({ id: fileId(record.resolved), type: 'file', name: record.resolved, file: record.resolved, package: targetPackage, language: target?.language });
        edges.push({ from: fileId(module.file), to: fileId(record.resolved), relationship: 'imports', evidence: { file: module.file, line: record.line, method: 'import_statement' }, classification: 'observed', resolutionMethod: 'path_resolution', confidence: 'high' });
        if (targetPackage !== module.package && !packageLinks.has(`${module.package}>${targetPackage}`)) { packageLinks.add(`${module.package}>${targetPackage}`); edges.push({ from: module.package, to: targetPackage, relationship: 'depends_on_module', evidence: { file: module.file, line: record.line, method: 'cross_package_import' }, classification: 'inferred', resolutionMethod: 'path_resolution', confidence: 'high' }); }
      } else if (record.external) edges.push({ from: fileId(module.file), to: node({ id: externalId(record.external), type: 'external_package', name: record.external }), relationship: 'depends_on_package', evidence: { file: module.file, line: record.line, method: 'import_statement' }, classification: record.declared ? 'observed' : 'inferred', resolutionMethod: 'import_specifier', confidence: record.declared ? 'high' : 'medium' });
    }
    for (const symbol of module.symbols.filter((item) => module.exports.includes(item.symbol))) edges.push({ from: fileId(module.file), to: node({ id: symbolId(module.file, symbol.symbol), type: 'symbol', name: symbol.symbol, file: module.file, package: module.package, language: module.language }), relationship: 'exports', evidence: { file: module.file, line: symbol.startLine, method: 'export_declaration' }, classification: 'observed', resolutionMethod: 'heuristic', confidence: 'medium' });
    for (const cls of module.classes) for (const [relationship, names] of [['extends', cls.bases], ['implements', cls.implements]] as const) for (const name of names) {
      const target = locateSymbol(model, module, name); if (!target) continue;
      edges.push({ from: node({ id: symbolId(module.file, cls.name), type: 'symbol', name: cls.name, file: module.file, package: module.package, language: module.language }), to: node({ id: symbolId(target.file, name), type: 'symbol', name, file: target.file, package: target.package, language: target.language }), relationship, evidence: { file: module.file, line: cls.line, method: 'class_declaration' }, classification: 'observed', resolutionMethod: 'heuristic', confidence: 'medium' });
    }
  }
  return { nodes, edges };
}

export function locateSymbol(model: RepositoryModel, from: ModuleInfo, name: string): ModuleInfo | undefined {
  if (from.symbols.some((symbol) => symbol.symbol === name)) return from;
  for (const record of from.imports) { const target = record.resolved ? model.modules.get(record.resolved) : undefined; if (target && (record.names.includes(name) || target.symbols.some((symbol) => symbol.symbol === name))) return target; }
  return undefined;
}

export interface BoundedGraph { nodes: GraphNode[]; edges: GraphEdge[]; depthReached: number; totalKnownNodes: number; totalKnownEdges: number; truncated: boolean; returnedNodes: number; returnedEdges: number }
export function boundedGraph(nodes: Map<string, GraphNode>, edges: GraphEdge[], seeds: string[], limits: { depth: number; maxNodes: number; maxEdges: number }, direction: 'both' | 'dependents' = 'both'): BoundedGraph {
  const adjacency = new Map<string, Set<string>>(); const link = (a: string, b: string) => adjacency.set(a, (adjacency.get(a) ?? new Set()).add(b));
  for (const edge of edges) { if (direction === 'both') link(edge.from, edge.to); link(edge.to, edge.from); }
  const known = seeds.filter((seed) => nodes.has(seed)), visited = new Map<string, number>(); let queue = known.slice(0, limits.maxNodes), depthReached = 0, truncated = known.length > limits.maxNodes;
  for (const seed of queue) visited.set(seed, 0);
  while (queue.length && !truncated) {
    const next: string[] = [];
    for (const current of queue) for (const neighbour of [...(adjacency.get(current) ?? [])].sort()) {
      if (visited.has(neighbour)) continue;
      const depth = visited.get(current)! + 1; if (depth > limits.depth) { truncated = true; continue; }
      if (visited.size >= limits.maxNodes) { truncated = true; continue; }
      visited.set(neighbour, depth); depthReached = Math.max(depthReached, depth); next.push(neighbour);
    }
    queue = next;
  }
  const selectedEdges = edges.filter((edge) => visited.has(edge.from) && visited.has(edge.to));
  if (selectedEdges.length > limits.maxEdges) truncated = true;
  return { nodes: [...visited.keys()].map((id) => nodes.get(id)!), edges: selectedEdges.slice(0, limits.maxEdges), depthReached, totalKnownNodes: nodes.size, totalKnownEdges: edges.length, truncated, returnedNodes: visited.size, returnedEdges: Math.min(selectedEdges.length, limits.maxEdges) };
}

export const confidenceOf = (edges: GraphEdge[]): Confidence => edges.length ? (edges.every((edge) => edge.confidence === 'high') ? 'high' : edges.some((edge) => edge.confidence === 'low') ? 'low' : 'medium') : 'unknown';
export const methodsOf = (edges: GraphEdge[]) => [...new Set(edges.map((edge) => edge.resolutionMethod))].sort();
