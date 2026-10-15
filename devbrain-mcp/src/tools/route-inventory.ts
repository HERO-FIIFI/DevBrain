import { z } from 'zod';
import { boundedInteger } from '../context/budgets.js';
import { collectRoutes, FRAMEWORK_ADAPTERS } from '../architecture/adapters.js';
import { repositoryModel } from '../architecture/graph.js';
import { HARD_GRAPH_LIMITS, provenanceSchema, staticBoundary, staticBoundarySchema } from '../architecture/model.js';
import { routeSchema } from './api-inventory.js';
import { failure } from './common.js';

const downstreamSchema = z.object({ file: z.string(), line: z.number().int(), names: z.array(z.string()), classification: z.literal('inferred'), confidence: z.literal('medium'), resolutionMethod: z.literal('handler_file_import') });
export const routeInventoryInput = z.object({ path: z.string().optional(), framework: z.enum(['express','next','fastapi','flask','django']).optional(), maxResults: z.number().int().min(1).max(HARD_GRAPH_LIMITS.maxResults).optional() });
export const routeInventoryOutput = z.object({ status: z.enum(['complete','partial','unsupported','error']), repositoryRoot: z.string().optional(), repository: provenanceSchema.optional(), frameworks: z.array(z.string()).optional(), routes: z.array(routeSchema.extend({ downstream: z.array(downstreamSchema) })).optional(), totalRoutes: z.number().int().optional(), returnedRoutes: z.number().int().optional(), unresolvedRoutes: z.number().int().optional(), truncated: z.boolean().optional(), boundary: staticBoundarySchema.optional(), errorCode: z.string().optional(), message: z.string().optional() });

export async function routeInventory(input: z.infer<typeof routeInventoryInput>) {
  try {
    const model = await repositoryModel(input.path), limit = boundedInteger(input.maxResults, 200, HARD_GRAPH_LIMITS.maxResults, 'max_results'), collected = collectRoutes(model);
    if (input.framework && !FRAMEWORK_ADAPTERS.some((adapter) => adapter.name === input.framework)) throw new Error('UNSUPPORTED_FRAMEWORK');
    const frameworks = input.framework ? collected.frameworks.filter((name) => name === input.framework) : collected.frameworks, all = collected.routes.filter((route) => frameworks.includes(route.framework));
    if (!frameworks.length) return { status: 'unsupported' as const, repositoryRoot: model.root, repository: model.provenance, frameworks: [], routes: [], totalRoutes: 0, returnedRoutes: 0, unresolvedRoutes: 0, truncated: false, boundary: staticBoundary, message: input.framework ? `No ${input.framework} dependency evidence was found in this repository.` : 'No supported web framework dependency (Express, Next.js, FastAPI, Flask, Django) was found; routes are not claimed.' };
    const routes = all.slice(0, limit).map((route) => { const module = model.modules.get(route.handler?.file ?? route.file); const downstream = (module?.imports ?? []).filter((record) => record.resolved && !model.modules.get(record.resolved)?.test).slice(0, 10).map((record) => ({ file: record.resolved!, line: record.line, names: record.names, classification: 'inferred' as const, confidence: 'medium' as const, resolutionMethod: 'handler_file_import' as const })); return { ...route, downstream }; });
    const unresolvedRoutes = all.filter((route) => !route.resolved).length, truncated = all.length > routes.length || model.truncated;
    return { status: truncated || unresolvedRoutes ? 'partial' as const : 'complete' as const, repositoryRoot: model.root, repository: model.provenance, frameworks, routes, totalRoutes: all.length, returnedRoutes: routes.length, unresolvedRoutes, truncated, boundary: staticBoundary };
  } catch (error) { return failure(error, 'ROUTE_INVENTORY_FAILED'); }
}
