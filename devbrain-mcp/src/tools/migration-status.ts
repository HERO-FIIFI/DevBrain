import { z } from 'zod';
import { repositoryModel } from '../architecture/graph.js';
import { CLASSIFICATIONS, CONFIDENCES, provenanceSchema, staticBoundary, staticBoundarySchema } from '../architecture/model.js';
import { migrationChains } from '../architecture/persistence.js';
import { failure } from './common.js';

const operationSchema = z.object({ type: z.enum(['migration_creates','migration_alters','migration_drops']), table: z.string(), line: z.number().int() });
const migrationSchema = z.object({ id: z.string(), name: z.string(), file: z.string(), order: z.number(), dependsOn: z.array(z.string()).optional(), operations: z.array(operationSchema) });
const chainSchema = z.object({ framework: z.string(), directory: z.string(), migrations: z.array(migrationSchema), latest: z.string().optional(), findings: z.array(z.object({ type: z.string(), detail: z.string(), files: z.array(z.string()) })), status: z.enum(['consistent','findings','unknown']), classification: z.enum(CLASSIFICATIONS), confidence: z.enum(CONFIDENCES), resolutionMethod: z.string() });
export const migrationStatusInput = z.object({ path: z.string().optional() });
export const migrationStatusOutput = z.object({ status: z.enum(['complete','partial','error']), repositoryRoot: z.string().optional(), repository: provenanceSchema.optional(), frameworks: z.array(z.string()).optional(), chains: z.array(chainSchema).optional(), totalMigrations: z.number().int().optional(), repositoryChainStatus: z.enum(['consistent','findings','unknown']).optional(), databaseState: z.literal('not_observed').optional(), summary: z.string().optional(), truncated: z.boolean().optional(), boundary: staticBoundarySchema.optional(), errorCode: z.string().optional(), message: z.string().optional() });

export async function migrationStatus(input: z.infer<typeof migrationStatusInput>) {
  try {
    const model = await repositoryModel(input.path), chains = await migrationChains(model), total = chains.reduce((sum, chain) => sum + chain.migrations.length, 0);
    const repositoryChainStatus = !total ? 'unknown' as const : chains.some((chain) => chain.status === 'findings') ? 'findings' as const : 'consistent' as const;
    const summary = repositoryChainStatus === 'unknown' ? 'No migration framework evidence was found in the repository; applied database state is unknown.' : repositoryChainStatus === 'consistent' ? 'Repository migration chain appears consistent; whether it has been applied to any database is not observed.' : 'Repository migration chain has findings that need review; applied database state is not observed.';
    return { status: model.truncated ? 'partial' as const : 'complete' as const, repositoryRoot: model.root, repository: model.provenance, frameworks: chains.map((chain) => chain.framework), chains, totalMigrations: total, repositoryChainStatus, databaseState: 'not_observed' as const, summary, truncated: model.truncated, boundary: staticBoundary };
  } catch (error) { return failure(error, 'MIGRATION_STATUS_FAILED'); }
}
