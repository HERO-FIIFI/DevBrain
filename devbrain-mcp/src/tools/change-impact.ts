import { z } from 'zod';
import { boundedInteger } from '../context/budgets.js';
import { repositoryModel } from '../architecture/graph.js';
import { changeImpact as computeImpact } from '../architecture/impact.js';
import { CONFIDENCES, HARD_GRAPH_LIMITS, RELATIONSHIPS, evidenceSchema, provenanceSchema, staticBoundary, staticBoundarySchema } from '../architecture/model.js';
import { failure } from './common.js';

const ref = z.string().regex(/^[A-Za-z0-9._/@{}~^-]+$/).max(200);
const seedSchema = z.object({ type: z.enum(['symbol','file','diff']), value: z.string().max(500).optional(), mode: z.enum(['working_tree','staged','commit','range']).optional(), commit: ref.optional(), from: ref.optional(), to: ref.optional() });
const categories = ['direct','transitive','interface','persistence','test','configuration'] as const;
export const impactSchema = z.object({ target: z.object({ type: z.enum(['file','symbol','route','table','test','configuration']), id: z.string(), name: z.string(), file: z.string().optional() }), category: z.enum(categories), relationship: z.enum(RELATIONSHIPS), relationshipPath: z.array(z.string()), evidence: z.array(evidenceSchema), classification: z.literal('potential'), confidence: z.enum(CONFIDENCES), depth: z.number().int(), resolutionMethod: z.string() });
export const changeImpactInput = z.object({ path: z.string().optional(), seed: seedSchema, depth: z.number().int().min(1).max(HARD_GRAPH_LIMITS.maxDepth).optional(), maxResults: z.number().int().min(1).max(HARD_GRAPH_LIMITS.maxResults).optional() });
export const changeImpactOutput = z.object({ status: z.enum(['complete','partial','error']), repositoryRoot: z.string().optional(), repository: provenanceSchema.optional(), seed: seedSchema.extend({ resolved: z.boolean() }).optional(), changed: z.object({ files: z.array(z.string()), symbols: z.array(z.object({ file: z.string(), symbol: z.string(), line: z.number().int() })) }).optional(), impacts: z.array(impactSchema).optional(), counts: z.object({ direct: z.number().int(), transitive: z.number().int(), interface: z.number().int(), persistence: z.number().int(), test: z.number().int(), configuration: z.number().int() }).optional(), depthReached: z.number().int().optional(), totalCandidates: z.number().int().optional(), truncated: z.boolean().optional(), confidence: z.enum(CONFIDENCES).optional(), boundary: staticBoundarySchema.optional(), errorCode: z.string().optional(), message: z.string().optional() });

export async function changeImpact(input: z.infer<typeof changeImpactInput>) {
  try {
    const model = await repositoryModel(input.path), report = await computeImpact(model, input.seed, { depth: boundedInteger(input.depth, 3, HARD_GRAPH_LIMITS.maxDepth, 'depth'), maxResults: boundedInteger(input.maxResults, 100, HARD_GRAPH_LIMITS.maxResults, 'max_results') });
    return { status: report.truncated ? 'partial' as const : 'complete' as const, repositoryRoot: model.root, repository: model.provenance, ...report, boundary: staticBoundary, ...(report.seed.resolved ? {} : { message: 'Seed did not resolve to any analysed repository file; no impact is claimed.' }) };
  } catch (error) { return failure(error, 'CHANGE_IMPACT_FAILED'); }
}
