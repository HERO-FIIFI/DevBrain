import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { exists, walkFiles } from '../filesystem.js';
import type { DependencyItem, DependencyType } from './types.js';

export async function nodeInventory(root: string): Promise<DependencyItem[]> {
  const { files } = await walkFiles(root); const result: DependencyItem[] = [];
  for (const file of files.filter((item) => path.basename(item) === 'package.json')) {
    let pkg: any; try { pkg = JSON.parse(await readFile(path.join(root, file), 'utf8')); } catch { continue; }
    for (const [field, dependencyType] of [['dependencies', 'production'], ['devDependencies', 'development'], ['optionalDependencies', 'optional'], ['peerDependencies', 'peer']] as const) {
      for (const [name, declaredVersion] of Object.entries(pkg[field] ?? {})) {
        const installedFile = path.join(path.dirname(path.join(root, file)), 'node_modules', name, 'package.json'); let installedVersion: string | null = null;
        if (await exists(installedFile)) { try { installedVersion = JSON.parse(await readFile(installedFile, 'utf8')).version ?? null; } catch { /* metadata unreadable */ } }
        result.push({ name, declaredVersion: String(declaredVersion), installedVersion, dependencyType: dependencyType as DependencyType, ecosystem: 'node', source: file.replaceAll('\\', '/') });
      }
    }
  }
  return result;
}

export async function requirementsInventory(root: string): Promise<DependencyItem[]> {
  const file = path.join(root, 'requirements.txt'); if (!await exists(file)) return [];
  const result: DependencyItem[] = [];
  for (const line of (await readFile(file, 'utf8')).split(/\r?\n/).map((item) => item.trim()).filter((item) => item && !item.startsWith('#') && !item.startsWith('-'))) {
    const match = /^([A-Za-z0-9_.-]+)\s*([<>=!~].*)?$/.exec(line);
    if (match) result.push({ name: match[1], declaredVersion: match[2] ?? '*', installedVersion: null, dependencyType: 'production', ecosystem: 'python', source: 'requirements.txt' });
  }
  return result;
}

export async function poetryInventory(root: string): Promise<DependencyItem[]> {
  const file = path.join(root, 'pyproject.toml'); if (!await exists(file)) return [];
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/); const items: DependencyItem[] = []; let type: DependencyType | null = null;
  for (const line of lines) {
    const section = /^\s*\[([^\]]+)\]/.exec(line);
    if (section) { type = section[1] === 'tool.poetry.dependencies' ? 'production' : /tool\.poetry\.group\..+\.dependencies/.test(section[1]) || section[1] === 'tool.poetry.dev-dependencies' ? 'development' : null; continue; }
    if (!type) continue; const dependency = /^\s*([A-Za-z0-9_.-]+)\s*=\s*["']([^"']+)["']/.exec(line);
    if (dependency && dependency[1].toLowerCase() !== 'python') items.push({ name: dependency[1], declaredVersion: dependency[2], installedVersion: null, dependencyType: type, ecosystem: 'python', source: 'pyproject.toml' });
  }
  return items;
}
