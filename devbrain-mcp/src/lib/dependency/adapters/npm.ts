import { nodeInventory } from '../inventory.js';
import { jsonCommandCheck } from '../outdated.js';
import { npmAuditResult } from '../vulnerability.js';
import type { DependencyAdapter } from '../types.js';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
export const npmAdapter: DependencyAdapter = {
  name: 'npm', ecosystem: 'node', inventory: nodeInventory,
  outdated: (root) => jsonCommandCheck(root, npm, ['outdated', '--json'], 'npm registry', (value) => Object.entries(value).map(([name, item]: [string, any]) => ({ name, current: item.current, declared: item.wanted, latest: item.latest, outdated: item.wanted !== item.latest, deprecated: false }))),
  vulnerabilities: async (root) => {
    const result = await jsonCommandCheck(root, npm, ['audit', '--json'], 'npm audit', (value) => npmAuditResult(value).findings);
    if (result.findings) {
      result.summary = { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0, total: result.findings.length };
      for (const finding of result.findings as Array<{ severity?: string }>) { const severity = finding.severity && finding.severity in result.summary ? finding.severity : 'unknown'; result.summary[severity]++; }
    }
    return result;
  },
};
