import { requirementsInventory } from '../inventory.js';
import { jsonCommandCheck } from '../outdated.js';
import type { DependencyAdapter } from '../types.js';
export const pipAdapter: DependencyAdapter = { name: 'pip', ecosystem: 'python', inventory: requirementsInventory,
  outdated: (root) => jsonCommandCheck(root, 'python', ['-m', 'pip', 'list', '--outdated', '--format=json'], 'PyPI via pip', (value) => Array.isArray(value) ? value.map((item) => ({ name: item.name, current: item.version, latest: item.latest_version, outdated: true, deprecated: false })) : []),
  vulnerabilities: (root) => jsonCommandCheck(root, 'python', ['-m', 'pip_audit', '--format=json'], 'pip-audit / PyPI advisory service', (value) => (value.dependencies ?? []).flatMap((dependency: any) => (dependency.vulns ?? []).map((finding: any) => ({ name: String(dependency.name), severity: 'unknown', direct: true, advisory: [{ title: String(finding.id ?? 'advisory'), url: Array.isArray(finding.aliases) && finding.aliases[0] ? `https://osv.dev/vulnerability/${finding.aliases[0]}` : undefined }] })))),
};
