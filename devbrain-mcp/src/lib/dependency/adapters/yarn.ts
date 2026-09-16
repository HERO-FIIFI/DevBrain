import { nodeInventory } from '../inventory.js';
import { notRun } from '../vulnerability.js';
import type { DependencyAdapter } from '../types.js';
export const yarnAdapter: DependencyAdapter = { name: 'yarn', ecosystem: 'node', inventory: nodeInventory,
  outdated: async () => notRun('Yarn registry', 'Yarn output varies by major version; update check not run safely'),
  vulnerabilities: async () => notRun('Yarn audit', 'Yarn audit support depends on the installed Yarn major version'),
};
