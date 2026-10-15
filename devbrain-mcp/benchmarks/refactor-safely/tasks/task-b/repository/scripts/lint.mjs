// Syntax-checks every JavaScript module with `node --check`; no third-party linter.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const files = [];
const walk = (dir) => { for (const entry of readdirSync(dir)) { const full = path.join(dir, entry); if (statSync(full).isDirectory()) walk(full); else if (/\.m?js$/.test(entry)) files.push(full); } };
for (const dir of ['src', 'tests', 'scripts']) walk(dir);

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { failed += 1; process.stderr.write(result.stderr); }
}
process.stdout.write(`lint: ${files.length} files checked, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
