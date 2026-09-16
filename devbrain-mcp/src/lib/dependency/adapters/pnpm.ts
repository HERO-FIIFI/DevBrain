import { nodeInventory } from '../inventory.js';
import { jsonCommandCheck } from '../outdated.js';
import { npmAuditResult } from '../vulnerability.js';
import type { DependencyAdapter } from '../types.js';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
export const pnpmAdapter: DependencyAdapter = { name: 'pnpm', ecosystem: 'node', inventory: nodeInventory,
  outdated: (root) => jsonCommandCheck(root, pnpm, ['outdated', '--format', 'json'], 'npm registry via pnpm', (value) => (Array.isArray(value) ? value : Object.entries(value).map(([name, item]: [string, any]) => ({ name, ...item }))).map((item: any) => ({ name: String(item.name ?? item.packageName ?? 'unknown'), current: item.current, declared: item.wanted, latest: item.latest, outdated: item.wanted !== item.latest, deprecated: Boolean(item.deprecated) }))),
  vulnerabilities: (root) => jsonCommandCheck(root, pnpm, ['audit', '--json'], 'pnpm audit', (value) => npmAuditResult(value).findings),
};
