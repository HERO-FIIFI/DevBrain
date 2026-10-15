// "Build" for a dependency-free ESM package: import every source module so unresolved imports and load-time errors fail.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const files = [];
const walk = (dir) => { for (const entry of readdirSync(dir)) { const full = path.join(dir, entry); if (statSync(full).isDirectory()) walk(full); else if (/\.m?js$/.test(entry)) files.push(full); } };
walk('src');

let failed = 0;
for (const file of files) {
  try { await import(pathToFileURL(path.resolve(file)).href); } catch (error) { failed += 1; process.stderr.write(`${file}: ${error.message}\n`); }
}
process.stdout.write(`build: ${files.length} modules loaded, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
