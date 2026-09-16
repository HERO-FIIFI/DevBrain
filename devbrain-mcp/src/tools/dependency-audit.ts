import { z } from 'zod';
import { detectStack } from '../lib/stack-detector.js';
import type { DependencyAdapter, DependencyItem } from '../lib/dependency/types.js';
import { npmAdapter } from '../lib/dependency/adapters/npm.js';
import { pnpmAdapter } from '../lib/dependency/adapters/pnpm.js';
import { yarnAdapter } from '../lib/dependency/adapters/yarn.js';
import { pipAdapter } from '../lib/dependency/adapters/pip.js';
import { poetryAdapter } from '../lib/dependency/adapters/poetry.js';
import { failure, toolRoot } from './common.js';

export const dependencyAuditInput = z.object({ path: z.string().optional(), limit: z.number().int().min(1).max(500).default(200) });
const dependencyItemSchema = z.object({ name: z.string(), declaredVersion: z.string(), installedVersion: z.string().optional(), dependencyType: z.enum(['production', 'development', 'optional', 'peer']), ecosystem: z.enum(['node', 'python']), source: z.string() });
const outdatedFindingSchema = z.object({ name: z.string(), current: z.string().optional(), declared: z.string().optional(), latest: z.string().optional(), outdated: z.boolean(), deprecated: z.boolean() });
const vulnerabilityFindingSchema = z.object({ name: z.string(), severity: z.string(), direct: z.boolean(), advisory: z.array(z.object({ title: z.string().optional(), url: z.string().optional(), severity: z.string().optional() })) });
const checkSchema = z.object({
  adapter: z.string(), status: z.enum(['complete', 'partial', 'offline', 'not_run', 'unsupported', 'error']), networkUsed: z.boolean(), networkAvailable: z.boolean().optional(), source: z.string(),
  findings: z.array(z.union([outdatedFindingSchema, vulnerabilityFindingSchema])).optional(), summary: z.record(z.string(), z.number()).optional(), reason: z.string().optional(),
});
export const dependencyAuditOutput = z.object({ status: z.enum(['complete', 'partial', 'unsupported', 'error']), requestedPath: z.string().optional(), repositoryRoot: z.string().optional(), packageManagers: z.array(z.string()).optional(), inventoryStatus: z.enum(['complete', 'unsupported']).optional(), inventory: z.array(dependencyItemSchema).optional(), outdated: z.array(checkSchema).optional(), vulnerabilities: z.array(checkSchema).optional(), totalCount: z.number().int().optional(), returnedCount: z.number().int().optional(), truncated: z.boolean().optional(), limit: z.number().int().optional(), errorCode: z.string().optional(), message: z.string().optional() });
const adapters: Record<string, DependencyAdapter> = { npm: npmAdapter, pnpm: pnpmAdapter, yarn: yarnAdapter, pip: pipAdapter, poetry: poetryAdapter };

export async function dependencyAudit(input: z.infer<typeof dependencyAuditInput>) {
  try {
    const root = await toolRoot(input.path); const stack = await detectStack(root.repositoryRoot); const selected = stack.packageManagers.map((manager) => adapters[manager]).filter(Boolean);
    if (!selected.length) return { status: 'unsupported', requestedPath: root.requestedPath, repositoryRoot: root.repositoryRoot, packageManagers: [], inventoryStatus: 'unsupported', inventory: [], outdated: [], vulnerabilities: [], totalCount: 0, returnedCount: 0, truncated: false, limit: input.limit };
    const inventory = (await Promise.all(selected.map((adapter) => adapter.inventory(root.repositoryRoot)))).flat().filter((item, index, all) => all.findIndex((other: DependencyItem) => other.name === item.name && other.ecosystem === item.ecosystem && other.source === item.source) === index);
    const cleanCheck = (check: Record<string, unknown>) => Object.fromEntries(Object.entries(check).filter(([, value]) => value !== null && value !== undefined));
    const outdated = (await Promise.all(selected.map(async (adapter) => ({ adapter: adapter.name, ...(await adapter.outdated(root.repositoryRoot)) })))).map(cleanCheck);
    const vulnerabilities = (await Promise.all(selected.map(async (adapter) => ({ adapter: adapter.name, ...(await adapter.vulnerabilities(root.repositoryRoot)) })))).map(cleanCheck);
    const degraded = [...outdated, ...vulnerabilities].some((check) => check.status !== 'complete');
    const publicInventory = inventory.map(({ installedVersion, ...item }) => installedVersion ? { ...item, installedVersion } : item);
    return { status: degraded ? 'partial' : 'complete', requestedPath: root.requestedPath, repositoryRoot: root.repositoryRoot, packageManagers: selected.map((a) => a.name), inventoryStatus: 'complete', inventory: publicInventory.slice(0, input.limit), outdated, vulnerabilities, totalCount: inventory.length, returnedCount: Math.min(inventory.length, input.limit), truncated: inventory.length > input.limit, limit: input.limit };
  } catch (error) { return failure(error, 'DEPENDENCY_AUDIT_FAILED'); }
}
