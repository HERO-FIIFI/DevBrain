import { pep621Inventory } from '../inventory.js';
import { jsonCommandCheck } from '../outdated.js';
import { notRun } from '../vulnerability.js';
import type { DependencyAdapter } from '../types.js';
export const uvAdapter: DependencyAdapter = { name: 'uv', ecosystem: 'python', inventory: pep621Inventory,
  outdated: (root) => jsonCommandCheck(root, 'uv', ['pip', 'list', '--outdated', '--format=json'], 'PyPI via uv', (value) => Array.isArray(value) ? value.map((item) => ({ name: item.name, current: item.version, latest: item.latest_version, outdated: true, deprecated: false })) : []),
  vulnerabilities: async () => notRun('uv', 'uv has no built-in vulnerability audit command'),
};
