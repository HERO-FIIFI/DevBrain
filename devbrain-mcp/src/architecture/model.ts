import { z } from 'zod';

export const HARD_GRAPH_LIMITS = { maxNodes: 500, maxEdges: 1_500, maxDepth: 5, maxFiles: 300, maxResults: 500 } as const;

export const RELATIONSHIPS = ['imports','exports','references','implements','extends','defines_route','handles_route','uses_service','reads_table','writes_table','references_table','covered_by_test','depends_on_package','depends_on_module','migration_creates','migration_alters','migration_drops'] as const;
export const CLASSIFICATIONS = ['observed','inferred','potential'] as const;
export const CONFIDENCES = ['high','medium','low','unknown'] as const;
export const NODE_TYPES = ['repository','package','module','file','symbol','route','table','migration','external_package'] as const;

export type Relationship = typeof RELATIONSHIPS[number];
export type Classification = typeof CLASSIFICATIONS[number];
export type Confidence = typeof CONFIDENCES[number];
export type NodeType = typeof NODE_TYPES[number];

export interface Evidence { file: string; line?: number; method: string }
export interface GraphNode { id: string; type: NodeType; name: string; file?: string; package?: string; language?: string }
export interface GraphEdge { from: string; to: string; relationship: Relationship; evidence: Evidence; classification: Classification; resolutionMethod: string; confidence: Confidence }

export const evidenceSchema = z.object({ file: z.string(), line: z.number().int().optional(), method: z.string() });
export const nodeSchema = z.object({ id: z.string(), type: z.enum(NODE_TYPES), name: z.string(), file: z.string().optional(), package: z.string().optional(), language: z.string().optional() });
export const edgeSchema = z.object({ from: z.string(), to: z.string(), relationship: z.enum(RELATIONSHIPS), evidence: evidenceSchema, classification: z.enum(CLASSIFICATIONS), resolutionMethod: z.string(), confidence: z.enum(CONFIDENCES) });
export const provenanceSchema = z.object({ sha: z.string().optional(), branch: z.string().optional(), dirty: z.boolean(), dirtyFileCount: z.number().int() });
export const staticBoundary = { evidence: 'static_repository_analysis' as const, runtime: 'not_observed' as const };
export const staticBoundarySchema = z.object({ evidence: z.literal('static_repository_analysis'), runtime: z.literal('not_observed') });

export const fileId = (file: string) => `file:${file}`;
export const symbolId = (file: string, symbol: string) => `symbol:${file}#${symbol}`;
export const packageId = (directory: string) => `package:${directory || '.'}`;
export const externalId = (name: string) => `external:${name}`;
export const routeId = (method: string, route: string) => `route:${method} ${route}`;
export const tableId = (table: string) => `table:${table}`;

export function weakest(...values: Confidence[]): Confidence {
  const order: Confidence[] = ['unknown', 'low', 'medium', 'high'];
  return values.reduce((current, value) => (order.indexOf(value) < order.indexOf(current) ? value : current), 'high');
}

// ponytail: bounded in-process memo keyed by repository/worktree state; no daemon, no persisted graph state.
const cache = new Map<string, Promise<unknown>>();
export function memoized<T>(key: string, build: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const pending = build().catch((error) => { cache.delete(key); throw error; });
  cache.set(key, pending);
  if (cache.size > 4) cache.delete(cache.keys().next().value!);
  return pending;
}
