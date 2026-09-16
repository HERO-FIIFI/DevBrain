import { poetryInventory } from '../inventory.js';
import { notRun } from '../vulnerability.js';
import type { DependencyAdapter } from '../types.js';
export const poetryAdapter: DependencyAdapter = { name: 'poetry', ecosystem: 'python', inventory: poetryInventory,
  outdated: async () => notRun('Poetry/PyPI', 'Structured Poetry update output is unsupported'),
  vulnerabilities: async () => notRun('Poetry', 'No supported lockfile-aware vulnerability command is available'),
};
