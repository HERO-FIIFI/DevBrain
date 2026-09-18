import { describe, expect, it } from 'vitest';
import { environmentProvenance, packageManagerVersionInvocation } from '../../src/execution/evidence.js';
import type { ResolvedCapability } from '../../src/execution/types.js';

const npmResolution: ResolvedCapability = {
  capability: 'test',
  invocation: { executable: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'test'], cwd: process.cwd() },
  definition: { source: 'package.json', fingerprint: 'sha256:test', framework: 'vitest' },
  packageManager: 'npm',
};

describe('environment provenance', () => {
  it('preserves the Windows package-manager launcher when probing its version', () => {
    expect(packageManagerVersionInvocation(npmResolution, 'win32')).toEqual({ executable: npmResolution.invocation.executable, args: [npmResolution.invocation.args[0], '--version'] });
  });

  it('records npm and Node versions separately on the current platform', async () => {
    const current: ResolvedCapability = process.platform === 'win32' ? { ...npmResolution, invocation: { executable: process.execPath, args: [npmResolution.invocation.args[0], 'test'], cwd: process.cwd() } } : { ...npmResolution, invocation: { executable: 'npm', args: ['test'], cwd: process.cwd() } };
    const environment = await environmentProvenance(current);
    expect(environment).toMatchObject({ nodeVersion: process.version, packageManager: 'npm', packageManagerVersion: expect.stringMatching(/^\d+\.\d+\.\d+/) });
    expect(environment.packageManagerVersion).not.toBe(process.version);
  });
});
