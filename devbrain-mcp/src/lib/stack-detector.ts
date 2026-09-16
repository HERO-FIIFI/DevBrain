import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { exists, walkFiles } from './filesystem.js';

export interface Evidence { kind: string; source: string; detail: string }
export interface StackDetection {
  languages: string[];
  packageManagers: string[];
  frameworks: string[];
  repositoryType: 'single-package' | 'monorepo' | 'unknown';
  workspaces: string[];
  scripts: Record<string, string>;
  entryPoints: string[];
  importantConfigFiles: string[];
  evidence: Evidence[];
  truncated: boolean;
}

const languageExtensions: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.py': 'Python',
};
const configs = new Set(['package.json', 'tsconfig.json', 'pyproject.toml', 'requirements.txt', 'poetry.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'eslint.config.js', '.eslintrc', 'vite.config.ts', 'next.config.js']);

async function text(file: string): Promise<string> { return readFile(file, 'utf8'); }
function dependencyNames(pkg: any): Set<string> { return new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })); }

export async function detectStack(root: string): Promise<StackDetection> {
  const walked = await walkFiles(root);
  const normalized = walked.files.map((file) => file.replaceAll('\\', '/'));
  const baseNames = new Set(normalized.map((file) => path.posix.basename(file)));
  const languages = [...new Set(normalized.map((file) => languageExtensions[path.extname(file).toLowerCase()]).filter(Boolean))].sort();
  const evidence: Evidence[] = [];
  for (const file of normalized.filter((item) => /^\.env(?:\.|$)/.test(path.posix.basename(item)))) {
    evidence.push({ kind: 'sensitive_configuration', source: file, detail: 'Environment file present; contents were not read or returned' });
  }
  const packageManagers: string[] = [];
  for (const [file, manager] of [['package-lock.json', 'npm'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['poetry.lock', 'poetry']] as const) {
    if (baseNames.has(file)) { packageManagers.push(manager); evidence.push({ kind: 'package_manager', source: file, detail: manager }); }
  }
  if (baseNames.has('requirements.txt') || (baseNames.has('pyproject.toml') && !baseNames.has('poetry.lock'))) {
    packageManagers.push('pip'); evidence.push({ kind: 'package_manager', source: baseNames.has('requirements.txt') ? 'requirements.txt' : 'pyproject.toml', detail: 'pip' });
  }

  const frameworks = new Set<string>();
  const scripts: Record<string, string> = {};
  const workspaces: string[] = [];
  const entryPoints = new Set<string>();
  for (const packageFile of normalized.filter((file) => path.posix.basename(file) === 'package.json')) {
    try {
      const pkg = JSON.parse(await text(path.join(root, packageFile)));
      const deps = dependencyNames(pkg);
      for (const [dependency, framework] of [['react', 'React'], ['express', 'Express'], ['next', 'Next.js'], ['@nestjs/core', 'NestJS']] as const) {
        if (deps.has(dependency)) { frameworks.add(framework); evidence.push({ kind: 'framework', source: packageFile, detail: `${framework} dependency` }); }
      }
      if (packageFile === 'package.json') {
        Object.assign(scripts, pkg.scripts ?? {});
        const declared = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
        if (Array.isArray(declared)) workspaces.push(...declared.filter((item: unknown): item is string => typeof item === 'string'));
        for (const field of ['main', 'module', 'bin']) {
          const value = pkg[field];
          if (typeof value === 'string') entryPoints.add(value);
          else if (value && typeof value === 'object') Object.values(value).filter((item): item is string => typeof item === 'string').forEach((item) => entryPoints.add(item));
        }
      }
    } catch { evidence.push({ kind: 'invalid_metadata', source: packageFile, detail: 'Invalid package.json' }); }
  }
  for (const file of normalized.filter((item) => path.posix.basename(item) === 'pyproject.toml' || path.posix.basename(item) === 'requirements.txt')) {
    const content = (await text(path.join(root, file))).toLowerCase();
    for (const [dependency, framework] of [['fastapi', 'FastAPI'], ['django', 'Django'], ['flask', 'Flask']] as const) {
      if (new RegExp(`(^|[^a-z0-9_-])${dependency}([^a-z0-9_-]|$)`, 'm').test(content)) { frameworks.add(framework); evidence.push({ kind: 'framework', source: file, detail: `${framework} dependency` }); }
    }
    const scriptMatch = /^\s*[a-zA-Z0-9_-]+\s*=\s*["']([^"']+):[^"']+["']/m.exec(content);
    if (scriptMatch) entryPoints.add(scriptMatch[1]);
  }
  for (const conventional of ['src/index.ts', 'src/index.js', 'index.js', 'main.py', 'app.py']) if (normalized.includes(conventional)) entryPoints.add(conventional);

  const importantConfigFiles = normalized.filter((file) => configs.has(path.posix.basename(file))).slice(0, 100);
  const pnpmWorkspace = path.join(root, 'pnpm-workspace.yaml');
  if (await exists(pnpmWorkspace)) {
    const matches = (await text(pnpmWorkspace)).matchAll(/^\s*-\s*["']?([^"'\r\n]+)["']?\s*$/gm);
    for (const match of matches) workspaces.push(match[1].trim());
  }
  const uniqueManagers = [...new Set(packageManagers)];
  return {
    languages, packageManagers: uniqueManagers, frameworks: [...frameworks].sort(),
    repositoryType: workspaces.length > 0 || normalized.filter((file) => path.posix.basename(file) === 'package.json').length > 1 ? 'monorepo' : normalized.length ? 'single-package' : 'unknown',
    workspaces: [...new Set(workspaces)], scripts, entryPoints: [...entryPoints], importantConfigFiles, evidence, truncated: walked.truncated,
  };
}
