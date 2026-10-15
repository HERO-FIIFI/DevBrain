import path from 'node:path';
import { z } from 'zod';
import { boundedInteger } from '../context/budgets.js';
import { collectRoutes, type RouteRecord } from '../architecture/adapters.js';
import { repositoryModel, type RepositoryModel } from '../architecture/graph.js';
import { CLASSIFICATIONS, CONFIDENCES, HARD_GRAPH_LIMITS, evidenceSchema, provenanceSchema, staticBoundary, staticBoundarySchema } from '../architecture/model.js';
import { failure } from './common.js';

export const routeSchema = z.object({ kind: z.enum(['http','page']), method: z.string(), path: z.string(), file: z.string(), line: z.number().int(), handler: z.object({ file: z.string(), symbol: z.string() }).optional(), framework: z.string(), middleware: z.array(z.string()), dynamic: z.boolean(), resolved: z.boolean(), mountedAt: z.string().optional(), classification: z.enum(CLASSIFICATIONS), confidence: z.enum(CONFIDENCES), resolutionMethod: z.string(), evidence: evidenceSchema });
const exportSchema = z.object({ package: z.string(), file: z.string(), symbols: z.array(z.string()), evidence: evidenceSchema, classification: z.enum(CLASSIFICATIONS), confidence: z.enum(CONFIDENCES) });
export const apiInventoryInput = z.object({ path: z.string().optional(), maxResults: z.number().int().min(1).max(HARD_GRAPH_LIMITS.maxResults).optional() });
export const apiInventoryOutput = z.object({ status: z.enum(['complete','partial','unsupported','error']), repositoryRoot: z.string().optional(), repository: provenanceSchema.optional(), frameworks: z.array(z.string()).optional(), apis: z.array(routeSchema).optional(), exports: z.array(exportSchema).optional(), totalApis: z.number().int().optional(), returnedApis: z.number().int().optional(), unresolvedApis: z.number().int().optional(), truncated: z.boolean().optional(), boundary: staticBoundarySchema.optional(), errorCode: z.string().optional(), message: z.string().optional() });

/** Public package exports: manifest entry points resolved to analysed modules. */
export function packageExports(model: RepositoryModel) {
  const result: z.infer<typeof exportSchema>[] = [];
  for (const pkg of model.packages) for (const entry of pkg.entryPoints) {
    const candidates = [entry, entry.replace(/(?:^|\/)dist\//, (match) => match.replace('dist', 'src')).replace(/\.js$/, '.ts'), entry.replace(/\.js$/, '.ts'), path.posix.join(pkg.directory, 'src', path.posix.relative(pkg.directory, entry))].map((candidate) => path.posix.normalize(candidate));
    const module = candidates.map((candidate) => model.modules.get(candidate)).find(Boolean); if (!module || result.some((item) => item.file === module.file)) continue;
    result.push({ package: pkg.id, file: module.file, symbols: module.exports.slice(0, 100), evidence: { file: pkg.manifests[0] ?? entry, method: 'manifest_entry_point' }, classification: entry === module.file ? 'observed' : 'inferred', confidence: entry === module.file ? 'high' : 'medium' });
  }
  return result;
}

export function inventory(routes: RouteRecord[], limit: number) { const http = routes.filter((route) => route.kind === 'http'); return { apis: http.slice(0, limit), totalApis: http.length, returnedApis: Math.min(http.length, limit), unresolvedApis: http.filter((route) => !route.resolved).length, truncated: http.length > limit }; }

export async function apiInventory(input: z.infer<typeof apiInventoryInput>) {
  try {
    const model = await repositoryModel(input.path), limit = boundedInteger(input.maxResults, 200, HARD_GRAPH_LIMITS.maxResults, 'max_results'), { frameworks, routes } = collectRoutes(model), bounded = inventory(routes, limit), exports = packageExports(model);
    const status = !frameworks.length && !exports.length ? 'unsupported' as const : bounded.truncated || bounded.unresolvedApis || model.truncated ? 'partial' as const : 'complete' as const;
    return { status, repositoryRoot: model.root, repository: model.provenance, frameworks, ...bounded, exports, truncated: bounded.truncated || model.truncated, boundary: staticBoundary, ...(status === 'unsupported' ? { message: 'No supported web framework dependency or package entry point was found; API discovery is not claimed.' } : {}) };
  } catch (error) { return failure(error, 'API_INVENTORY_FAILED'); }
}
