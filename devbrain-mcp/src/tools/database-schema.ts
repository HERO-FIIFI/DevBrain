import { z } from 'zod';
import { boundedInteger } from '../context/budgets.js';
import { repositoryModel } from '../architecture/graph.js';
import { CLASSIFICATIONS, CONFIDENCES, HARD_GRAPH_LIMITS, RELATIONSHIPS, provenanceSchema, staticBoundary, staticBoundarySchema } from '../architecture/model.js';
import { repositorySchema, tableReferences } from '../architecture/persistence.js';
import { failure } from './common.js';

const columnSchema = z.object({ name: z.string(), type: z.string(), nullable: z.boolean().optional(), primaryKey: z.boolean().optional() });
export const tableSchema = z.object({ name: z.string(), model: z.string().optional(), columns: z.array(columnSchema), indexes: z.array(z.object({ name: z.string().optional(), columns: z.array(z.string()), unique: z.boolean().optional() })), foreignKeys: z.array(z.object({ column: z.string(), referencesTable: z.string(), referencesColumn: z.string().optional() })), source: z.object({ type: z.string(), file: z.string(), line: z.number().int() }), origin: z.enum(['declared','migration_derived','inferred_model_mapping']), classification: z.enum(CLASSIFICATIONS), confidence: z.enum(CONFIDENCES), resolutionMethod: z.string() });
const referenceSchema = z.object({ file: z.string(), line: z.number().int(), table: z.string(), relationship: z.enum(RELATIONSHIPS), method: z.string(), classification: z.enum(CLASSIFICATIONS), confidence: z.enum(CONFIDENCES) });
export const databaseSchemaInput = z.object({ path: z.string().optional(), maxTables: z.number().int().min(1).max(HARD_GRAPH_LIMITS.maxNodes).optional(), maxReferences: z.number().int().min(1).max(HARD_GRAPH_LIMITS.maxEdges).optional() });
export const databaseSchemaOutput = z.object({ status: z.enum(['complete','partial','unsupported','error']), repositoryRoot: z.string().optional(), repository: provenanceSchema.optional(), adapters: z.array(z.string()).optional(), tables: z.array(tableSchema).optional(), datasources: z.array(z.object({ provider: z.string().optional(), file: z.string(), line: z.number().int(), configuration: z.string(), redacted: z.boolean() })).optional(), references: z.array(referenceSchema).optional(), totalTables: z.number().int().optional(), totalReferences: z.number().int().optional(), truncated: z.boolean().optional(), databaseState: z.literal('repository_declared_only').optional(), boundary: staticBoundarySchema.optional(), errorCode: z.string().optional(), message: z.string().optional() });

export async function databaseSchema(input: z.infer<typeof databaseSchemaInput>) {
  try {
    const model = await repositoryModel(input.path), maxTables = boundedInteger(input.maxTables, 200, HARD_GRAPH_LIMITS.maxNodes, 'max_tables'), maxReferences = boundedInteger(input.maxReferences, 500, HARD_GRAPH_LIMITS.maxEdges, 'max_references');
    const schema = await repositorySchema(model), references = tableReferences(model, schema), truncated = schema.tables.length > maxTables || references.length > maxReferences || model.truncated;
    if (!schema.tables.length && !schema.datasources.length) return { status: 'unsupported' as const, repositoryRoot: model.root, repository: model.provenance, adapters: [], tables: [], datasources: [], references: [], totalTables: 0, totalReferences: 0, truncated: model.truncated, databaseState: 'repository_declared_only' as const, boundary: staticBoundary, message: 'No Prisma, TypeORM, Sequelize, SQLAlchemy, Django ORM, or SQL DDL schema evidence was found; no schema is claimed.' };
    return { status: truncated ? 'partial' as const : 'complete' as const, repositoryRoot: model.root, repository: model.provenance, adapters: schema.adapters, tables: schema.tables.slice(0, maxTables), datasources: schema.datasources, references: references.slice(0, maxReferences), totalTables: schema.tables.length, totalReferences: references.length, truncated, databaseState: 'repository_declared_only' as const, boundary: staticBoundary };
  } catch (error) { return failure(error, 'DATABASE_SCHEMA_FAILED'); }
}
