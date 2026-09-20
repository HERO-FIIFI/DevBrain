import path from 'node:path';
import type { RouteRecord } from './adapters.js';
import type { RepositoryModel } from './graph.js';
import { HARD_GRAPH_LIMITS, externalId, type Classification, type Confidence, type Evidence, type Relationship } from './model.js';
import type { SchemaResult, TableReference } from './persistence.js';

export type ComponentType = 'application' | 'package' | 'entry_point' | 'api_module' | 'service_module' | 'persistence_module' | 'test_module' | 'module' | 'external_dependency';
export interface Component { id: string; type: ComponentType; name: string; package: string; files: string[]; evidence: Evidence[]; classification: Classification; confidence: Confidence; resolutionMethod: string }
export interface ComponentRelationship { from: string; to: string; type: Relationship; count: number; evidence: Evidence; classification: Classification; confidence: Confidence; resolutionMethod: string }
export interface ArchitectureMap { components: Component[]; relationships: ComponentRelationship[]; layering: { method: string; classification: Classification; confidence: Confidence; status: 'detected' | 'undetermined' }; truncated: boolean; totalComponents: number; totalRelationships: number }

const API_PATH = /(?:^|\/)(?:routes?|controllers?|api|handlers?|endpoints?|views|pages)\//i, PERSISTENCE_PATH = /(?:^|\/)(?:models?|entities|repositories|prisma|migrat\w*|db|database|schemas?|persistence|dao|store)\//i, SERVICE_PATH = /(?:^|\/)(?:services?|use-?cases|domain|core|logic|application|lib|utils?)\//i;
const ENTRY_NAME = /^(?:index|main|app|server|cli|manage)\.(?:[cm]?[jt]sx?|py)$/;

export function architectureMap(model: RepositoryModel, routes: RouteRecord[], schema: SchemaResult, references: TableReference[], limits: { maxNodes: number; maxEdges: number } = { maxNodes: HARD_GRAPH_LIMITS.maxNodes, maxEdges: HARD_GRAPH_LIMITS.maxEdges }): ArchitectureMap {
  const components = new Map<string, Component>(), routeFiles = new Set(routes.map((route) => route.file)), tableFiles = new Set(schema.tables.map((record) => record.source.file)), referenceFiles = new Set(references.map((reference) => reference.file));
  const upsert = (id: string, type: ComponentType, name: string, pkg: string, file: string | undefined, evidence: Evidence, classification: Classification, confidence: Confidence, method: string) => {
    const existing = components.get(id) ?? { id, type, name, package: pkg, files: [], evidence: [], classification, confidence, resolutionMethod: method };
    if (file && !existing.files.includes(file)) existing.files.push(file);
    if (existing.evidence.length < 5 && !existing.evidence.some((item) => item.file === evidence.file && item.method === evidence.method)) existing.evidence.push(evidence);
    if (classification === 'observed' && existing.classification !== 'observed') { existing.classification = 'observed'; existing.confidence = confidence; existing.resolutionMethod = method; }
    components.set(id, existing); return existing;
  };
  for (const pkg of model.packages) {
    const hasRoutes = [...model.modules.values()].some((module) => module.package === pkg.id && routeFiles.has(module.file));
    const hasEntry = model.stack.entryPoints.some((entry) => pkg.directory ? entry.startsWith(`${pkg.directory}/`) : !entry.includes('/') || model.packages.length === 1);
    const hasStart = !pkg.directory && Object.keys(model.stack.scripts).some((script) => /^(?:start|dev|serve)$/.test(script));
    upsert(pkg.id, hasRoutes || hasEntry || hasStart ? 'application' : 'package', pkg.name, pkg.id, pkg.manifests[0], { file: pkg.manifests[0] ?? '.', method: pkg.manifests.length ? 'manifest' : 'repository_root' }, pkg.manifests.length ? 'observed' : 'inferred', pkg.manifests.length ? 'high' : 'low', 'package_manifest');
  }
  const membership = new Map<string, string>();
  for (const module of [...model.modules.values()].sort((a, b) => a.file.localeCompare(b.file))) {
    const pkg = model.packages.find((candidate) => candidate.id === module.package)!, relative = pkg.directory ? module.file.slice(pkg.directory.length + 1) : module.file, base = path.posix.basename(module.file);
    const manifestEntry = pkg.entryPoints.some((entry) => entry === module.file || entry.replace(/(?:^|\/)dist\//, (match) => match.replace('dist', 'src')).replace(/\.js$/, '.ts') === module.file || path.posix.join(pkg.directory, 'src', path.posix.relative(pkg.directory, entry)) === module.file), rootLevel = !relative.includes('/') || /^src\/[^/]+$/.test(relative);
    let id: string, type: ComponentType, classification: Classification = 'inferred', confidence: Confidence = 'medium', method = 'path_convention', evidence: Evidence = { file: module.file, method: 'path_convention' };
    if (module.test) { id = `test:${pkg.id}`; type = 'test_module'; method = 'test_naming_convention'; evidence = { file: module.file, method }; }
    else if (manifestEntry) { id = `entry:${pkg.id}`; type = 'entry_point'; classification = 'observed'; confidence = 'high'; method = 'manifest_entry_point'; evidence = { file: pkg.manifests[0] ?? module.file, method }; }
    else if (routeFiles.has(module.file)) { id = `api:${pkg.id}`; type = 'api_module'; classification = 'observed'; confidence = 'high'; method = 'route_evidence'; evidence = { file: module.file, line: routes.find((route) => route.file === module.file)!.line, method }; }
    else if (tableFiles.has(module.file) || referenceFiles.has(module.file)) { id = `persistence:${pkg.id}`; type = 'persistence_module'; classification = 'observed'; confidence = tableFiles.has(module.file) ? 'high' : 'medium'; method = tableFiles.has(module.file) ? 'schema_evidence' : 'table_reference_evidence'; evidence = { file: module.file, method }; }
    else if (API_PATH.test(relative)) { id = `api:${pkg.id}`; type = 'api_module'; }
    else if (PERSISTENCE_PATH.test(relative)) { id = `persistence:${pkg.id}`; type = 'persistence_module'; }
    else if (SERVICE_PATH.test(relative) || /service|usecase|repository/i.test(base)) { id = `service:${pkg.id}`; type = 'service_module'; }
    else if (rootLevel && ENTRY_NAME.test(base)) { id = `entry:${pkg.id}`; type = 'entry_point'; }
    else { const directory = path.posix.dirname(relative), group = directory === '.' ? '.' : directory.split('/').slice(0, 2).join('/'); id = `module:${pkg.id}/${group}`; type = 'module'; classification = 'observed'; confidence = 'high'; method = 'directory_grouping'; evidence = { file: module.file, method }; }
    upsert(id, type, id.replace(/^\w+:package:/, '').replace(/^\./, pkg.name), pkg.id, module.file, evidence, classification, confidence, method);
    membership.set(module.file, id);
  }
  const relationships = new Map<string, ComponentRelationship>();
  const relate = (from: string, to: string, type: Relationship, evidence: Evidence, classification: Classification, confidence: Confidence, method: string) => { const key = `${from}>${to}>${type}`, existing = relationships.get(key); if (existing) existing.count++; else relationships.set(key, { from, to, type, count: 1, evidence, classification, confidence, resolutionMethod: method }); };
  for (const pkg of model.packages) for (const dependency of pkg.dependencies) if (components.size < limits.maxNodes) { upsert(externalId(dependency), 'external_dependency', dependency, pkg.id, undefined, { file: pkg.manifests[0] ?? '.', method: 'manifest_declaration' }, 'observed', 'high', 'package_manifest'); relate(pkg.id, externalId(dependency), 'depends_on_package', { file: pkg.manifests[0] ?? '.', method: 'manifest_declaration' }, 'observed', 'high', 'manifest_declaration'); }
  for (const module of model.modules.values()) {
    const from = membership.get(module.file)!, fromComponent = components.get(from)!;
    for (const record of module.imports) {
      const evidence = { file: module.file, line: record.line, method: 'import_statement' };
      if (record.resolved && membership.has(record.resolved)) {
        const to = membership.get(record.resolved)!, toComponent = components.get(to)!; if (to === from) continue;
        if (fromComponent.type === 'test_module') relate(to, from, 'covered_by_test', evidence, 'inferred', 'medium', 'test_import');
        else if (fromComponent.type === 'api_module' && toComponent.type === 'service_module') relate(from, to, 'uses_service', evidence, 'inferred', 'medium', 'layer_import');
        else relate(from, to, 'imports', evidence, 'observed', 'high', 'import_statement');
      } else if (record.external && components.has(externalId(record.external))) relate(from, externalId(record.external), 'depends_on_package', evidence, record.declared ? 'observed' : 'inferred', record.declared ? 'high' : 'medium', 'import_statement');
    }
  }
  for (const reference of references) if (membership.has(reference.file)) { const record = schema.tables.find((candidate) => candidate.name === reference.table); if (record && membership.has(record.source.file) && membership.get(record.source.file) !== membership.get(reference.file)) relate(membership.get(reference.file)!, membership.get(record.source.file)!, reference.relationship, { file: reference.file, line: reference.line, method: reference.method }, 'observed', reference.confidence, reference.method); }
  const layered = [...components.values()].filter((component) => ['api_module','service_module','persistence_module'].includes(component.type));
  const all = [...components.values()], allRelationships = [...relationships.values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { components: all.slice(0, limits.maxNodes), relationships: allRelationships.slice(0, limits.maxEdges), layering: { method: 'path_convention_and_content_evidence', classification: 'inferred', confidence: layered.some((component) => component.classification === 'observed') ? 'high' : layered.length ? 'medium' : 'unknown', status: layered.length ? 'detected' : 'undetermined' }, truncated: all.length > limits.maxNodes || allRelationships.length > limits.maxEdges || model.truncated, totalComponents: all.length, totalRelationships: allRelationships.length };
}
