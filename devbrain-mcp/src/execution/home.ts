import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function devbrainHome(): string { return path.resolve(process.env.DEVBRAIN_HOME ?? path.join(os.homedir(), '.devbrain')); }
export const trustRegistryPath = () => path.join(devbrainHome(), 'trust-registry.json');
export const approvalsDirectory = () => path.join(devbrainHome(), 'approvals');
export const executionsDirectory = () => path.join(devbrainHome(), 'executions');

export async function ensureDevbrainHome(): Promise<void> {
  await Promise.all([mkdir(approvalsDirectory(), { recursive: true }), mkdir(executionsDirectory(), { recursive: true })]);
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch (error: any) { if (error?.code === 'ENOENT') return fallback; throw error; }
}

export async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await rename(temporary, file);
}
