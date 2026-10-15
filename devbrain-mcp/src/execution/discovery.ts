import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { exists, resolveSafePath } from '../lib/filesystem.js';
import { sha256 } from './trust/repository-identity.js';
import type { Capability, ResolvedCapability } from './types.js';

const dangerous = /(?:^|[;&|]\s*)sudo\b|(?:curl|wget)[^\n|]*\|\s*(?:sh|bash|zsh)\b|\brm\s+-rf\b|\b(?:del|erase|rmdir)\s+\/s\b|(?:^|\s)(?:\.\.\/|\.\.\\){2,}/i;
function managerInvocation(name:string,args:string[]):{executable:string;args:string[]} {
  if(process.platform!=='win32')return{executable:name,args};
  const cli=name==='npm'?path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js'):path.join(path.dirname(process.execPath),'node_modules','corepack','dist',`${name}.js`);
  return{executable:process.execPath,args:[cli,...args]};
}

export async function validateTarget(root: string, target: string): Promise<string> {
  if (path.isAbsolute(target) || target.includes('\0')) throw new Error('INVALID_TEST_TARGET');
  const canonicalRoot = await resolveSafePath(root, root);
  const resolved = await resolveSafePath(path.resolve(canonicalRoot, target), canonicalRoot);
  const relative = path.relative(canonicalRoot, resolved).replaceAll('\\', '/');
  if (!/((?:^|\/)(?:test_[^/]+|[^/]+_(?:test)|[^/]+\.(?:test|spec))\.(?:py|[cm]?[jt]sx?)$)/i.test(relative)) throw new Error('UNSUPPORTED_TEST_TARGET');
  return relative;
}

export async function discoverCapability(root: string, capability: Capability, target?: string): Promise<ResolvedCapability | null> {
  const packageFile = path.join(root, 'package.json');
  if (await exists(packageFile)) {
    const raw = await readFile(packageFile, 'utf8'); const pkg = JSON.parse(raw); const scriptName = capability === 'targeted_test' ? 'test' : capability;
    const script = pkg.scripts?.[scriptName];
    if (typeof script === 'string') {
      if (dangerous.test(script)) throw new Error('DANGEROUS_EXECUTION_DEFINITION');
      const manager = await exists(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : await exists(path.join(root, 'yarn.lock')) ? 'yarn' : await exists(path.join(root, 'package-lock.json')) ? 'npm' : null;
      if (!manager) return null;
      const args = manager === 'npm' && scriptName === 'test' ? ['test'] : ['run', scriptName];
      if (capability === 'targeted_test') { if (!target) throw new Error('TEST_TARGET_REQUIRED'); args.push('--', await validateTarget(root, target)); }
      const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
      const framework = /vitest/i.test(script) || dependencies.vitest ? 'vitest' : /jest/i.test(script) || dependencies.jest ? 'jest' : 'generic';
      const command=managerInvocation(manager,args);
      return { capability, invocation: { ...command, cwd: root }, definition: { source: 'package.json', script, fingerprint: sha256(`${raw}\0${scriptName}\0${script}`), framework }, packageManager: manager };
    }
  }

  const pyproject = path.join(root, 'pyproject.toml'); const pytestIni = path.join(root, 'pytest.ini');
  if (await exists(pyproject) || await exists(pytestIni)) {
    const source = await exists(pyproject) ? pyproject : pytestIni; const raw = await readFile(source, 'utf8'); let args: string[] | null = null; let framework: 'pytest' | 'generic' = 'generic';
    if (capability === 'test' || capability === 'targeted_test') {
      if (!/pytest|\[tool\.pytest/i.test(raw) && !await exists(pytestIni)) return null;
      args = ['-m', 'pytest']; framework = 'pytest';
      if (capability === 'targeted_test') { if (!target) throw new Error('TEST_TARGET_REQUIRED'); args.push(await validateTarget(root, target)); }
    } else if (capability === 'build' && /\[build-system\]/i.test(raw)) args = ['-m', 'build'];
    else if (capability === 'lint' && /\[tool\.ruff/i.test(raw)) args = ['-m', 'ruff', 'check', '.'];
    if (args) return { capability, invocation: { executable: process.platform === 'win32' ? 'python.exe' : 'python3', args, cwd: root }, definition: { source: path.basename(source), fingerprint: sha256(`${raw}\0${capability}`), framework }, packageManager: 'python' };
  }
  return null;
}
