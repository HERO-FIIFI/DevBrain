import { z } from 'zod';
import { boundedInteger } from '../context/budgets.js';
import { collectRoutes } from '../architecture/adapters.js';
import { architectureMap as buildMap } from '../architecture/components.js';
import { repositoryModel } from '../architecture/graph.js';
import { CLASSIFICATIONS, CONFIDENCES, HARD_GRAPH_LIMITS, RELATIONSHIPS, evidenceSchema, provenanceSchema, staticBoundary, staticBoundarySchema } from '../architecture/model.js';
import { migrationChains, repositorySchema, tableReferences } from '../architecture/persistence.js';
import { failure } from './common.js';

const componentSchema = z.object({ id: z.string(), type: z.enum(['application','package','entry_point','api_module','service_module','persistence_module','test_module','module','external_dependency']), name: z.string(), package: z.string(), files: z.array(z.string()), evidence: z.array(evidenceSchema), classification: z.enum(CLASSIFICATIONS), confidence: z.enum(CONFIDENCES), resolutionMethod: z.string() });
const relationshipSchema = z.object({ from: z.string(), to: z.string(), type: z.enum(RELATIONSHIPS), count: z.number().int(), evidence: evidenceSchema, classification: z.enum(CLASSIFICATIONS), confidence: z.enum(CONFIDENCES), resolutionMethod: z.string() });
export const architectureMapInput = z.object({ path: z.string().optional(), maxComponents: z.number().int().min(1).max(HARD_GRAPH_LIMITS.maxNodes).optional(), maxRelationships: z.number().int().min(1).max(HARD_GRAPH_LIMITS.maxEdges).optional() });
export const architectureMapOutput = z.object({ status: z.enum(['complete','partial','error']), repositoryRoot: z.string().optional(), repository: provenanceSchema.optional(), repositoryType: z.string().optional(), languages: z.array(z.string()).optional(), frameworks: z.array(z.string()).optional(), components: z.array(componentSchema).optional(), relationships: z.array(relationshipSchema).optional(), layering: z.object({ method: z.string(), classification: z.enum(CLASSIFICATIONS), confidence: z.enum(CONFIDENCES), status: z.enum(['detected','undetermined']) }).optional(), summary: z.object({ packages: z.number().int(), analyzedFiles: z.number().int(), routes: z.number().int(), tables: z.number().int(), migrations: z.number().int(), externalDependencies: z.number().int() }).optional(), totalComponents: z.number().int().optional(), totalRelationships: z.number().int().optional(), truncated: z.boolean().optional(), boundary: staticBoundarySchema.optional(), errorCode: z.string().optional(), message: z.string().optional() });

export async function architectureMap(input: z.infer<typeof architectureMapInput>) {
  try {
    const model = await repositoryModel(input.path), limits = { maxNodes: boundedInteger(input.maxComponents, 200, HARD_GRAPH_LIMITS.maxNodes, 'max_components'), maxEdges: boundedInteger(input.maxRelationships, 600, HARD_GRAPH_LIMITS.maxEdges, 'max_relationships') };
    const { frameworks, routes } = collectRoutes(model), schema = await repositorySchema(model), references = tableReferences(model, schema), chains = await migrationChains(model), map = buildMap(model, routes, schema, references, limits);
    return { status: map.truncated ? 'partial' as const : 'complete' as const, repositoryRoot: model.root, repository: model.provenance, repositoryType: model.stack.repositoryType, languages: model.stack.languages, frameworks, components: map.components, relationships: map.relationships, layering: map.layering, summary: { packages: model.packages.length, analyzedFiles: model.modules.size, routes: routes.length, tables: schema.tables.length, migrations: chains.reduce((sum, chain) => sum + chain.migrations.length, 0), externalDependencies: map.components.filter((component) => component.type === 'external_dependency').length }, totalComponents: map.totalComponents, totalRelationships: map.totalRelationships, truncated: map.truncated, boundary: staticBoundary };
  } catch (error) { return failure(error, 'ARCHITECTURE_MAP_FAILED'); }
}
