// Pinned-model gate. The invariant is trustworthy evidence that requested and resolved model are both exactly
// PINNED_MODEL; the discovery commands are adapters that record raw evidence and may all fail (-> BLOCKED).
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { PINNED_MODEL } from './conditions.mjs';
import { runCommand } from './fixtures.mjs';

const TRUSTED_SOURCES = new Set(['event', 'cli_session_metadata', 'cli_catalog']);

export function assertPinnedModel({ requested, resolved, catalog, evidence, cliRejection, conflicts }) {
  const blocked = (reason) => ({ status: 'BLOCKED', requested, resolved: resolved ?? null, reason, catalog: catalog ?? null, evidence: evidence ?? null });
  if (requested !== PINNED_MODEL) return blocked(`requested model must be ${PINNED_MODEL}, got "${requested}"`);
  if (cliRejection) return blocked(`CLI rejected the model: ${cliRejection}`);
  if (conflicts?.length) return blocked(`resolved model evidence is in conflict: ${conflicts.map((entry) => `${entry.eventId ?? entry.field}=${entry.value}`).join(', ')}`);
  if (catalog) {
    if (catalog.status !== 'ok') return blocked(`model discovery failed: ${catalog.error ?? 'unknown error'}`);
    if (catalog.aliases?.[requested]) return blocked(`"${requested}" is only an alias of "${catalog.aliases[requested]}" in the catalog`);
    if (!catalog.models.includes(requested)) return blocked(`catalog does not list "${requested}" (listed: ${catalog.models.join(', ') || 'none'})`);
  }
  if (!resolved) return blocked('no resolved model evidence; command acceptance alone is insufficient');
  if (resolved !== requested) return blocked(`resolved "${resolved}" does not equal requested "${requested}"`);
  if (evidence && !TRUSTED_SOURCES.has(evidence.source)) return blocked(`resolved model evidence source "${evidence.source}" is untrusted`);
  return { status: 'ready', requested, resolved, catalog: catalog ?? null, evidence: evidence ?? null };
}

// ---- discovery adapters -------------------------------------------------------------------------------------------

const MODEL_ID = /^[a-z0-9][a-z0-9.-]*$/i;

function catalogFromJson(text) {
  const parsed = JSON.parse(text), models = new Set(), aliases = {};
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    const id = node.slug ?? node.id ?? node.model ?? node.name;
    if (typeof id === 'string' && MODEL_ID.test(id)) { models.add(id); for (const alias of node.aliases ?? []) if (typeof alias === 'string') aliases[alias] = id; }
    for (const value of Object.values(node)) if (value && typeof value === 'object') visit(value);
  };
  visit(parsed);
  return { models: [...models].sort(), aliases };
}

export function defaultAdapters({ executable = 'codex', codexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex') } = {}) {
  const cli = async (args) => { const result = await runCommand({ executable, args }, process.cwd(), { timeoutMs: 30_000 }); if (result.exitCode !== 0) throw new Error(`${executable} ${args.join(' ')} exited ${result.exitCode}: ${(result.stderr || result.stdout).trim().slice(0, 300)}`); return result.stdout; };
  return [
    { name: 'cli_version', run: async () => ({ status: 'ok', raw: (await cli(['--version'])).trim(), models: [], aliases: {} }) },
    { name: 'debug_models', run: async () => { const raw = await cli(['debug', 'models']); const models = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => MODEL_ID.test(line)); return { status: 'ok', raw, models, aliases: {} }; } },
    { name: 'models_cache', run: async () => { const raw = await readFile(path.join(codexHome, 'models_cache.json'), 'utf8'); return { status: 'ok', raw, ...catalogFromJson(raw) }; } },
  ];
}

/** Runs every adapter, records raw evidence per adapter, and merges model lists; no adapter output means `failed`. */
export async function discoverModels(options = {}) {
  const adapters = options.adapters ?? defaultAdapters(options);
  const results = [], models = new Set(), aliases = {}, sources = [];
  for (const adapter of adapters) {
    try {
      const result = await adapter.run();
      results.push({ name: adapter.name, status: 'ok', raw: result.raw ?? null, models: result.models ?? [], aliases: result.aliases ?? {} });
      if (result.models?.length) { sources.push(adapter.name); for (const model of result.models) models.add(model); Object.assign(aliases, result.aliases ?? {}); }
    } catch (error) { results.push({ name: adapter.name, status: 'failed', error: error.message }); }
  }
  const catalog = models.size ? { status: 'ok', models: [...models].sort(), aliases, sources } : { status: 'failed', error: 'no adapter produced a model catalog', sources: [] };
  return { adapters: results, catalog };
}

// ---- resolved-model evidence from run artifacts ------------------------------------------------------------------

const MODEL_FIELDS = ['model', 'model_name', 'resolved_model'];

/** Looks for model fields in normalized events, then for a `model: <id>` line on stderr; conflicts stay unresolved. */
export function resolveModelEvidence({ parsed, stderr = '' }) {
  const found = [];
  for (const event of parsed.events) {
    const raw = event.raw && typeof event.raw === 'object' ? event.raw : null;
    if (!raw) continue;
    for (const holder of [raw, raw.item, raw.session, raw.config]) if (holder && typeof holder === 'object') for (const field of MODEL_FIELDS) if (typeof holder[field] === 'string') found.push({ eventId: event.eventId, field, value: holder[field] });
  }
  const distinct = [...new Set(found.map((entry) => entry.value))];
  if (distinct.length > 1) return { resolved: null, evidence: null, conflicts: found };
  if (distinct.length === 1) return { resolved: distinct[0], evidence: { source: 'event', eventId: found[0].eventId, field: found[0].field, raw: found[0].value }, conflicts: [] };
  const line = stderr.split(/\r?\n/).find((entry) => /^\s*model:\s*\S+/i.test(entry));
  if (line) { const value = line.replace(/^\s*model:\s*/i, '').trim(); return { resolved: value, evidence: { source: 'cli_session_metadata', field: 'stderr:model', raw: line.trim() }, conflicts: [] }; }
  return { resolved: null, evidence: null, conflicts: [] };
}

/** Every planned flag must appear in `codex exec --help`; unknown flags block before a measured run. */
export function verifyCliSurface(helpText, flags) {
  const missing = flags.filter((flag) => !new RegExp(`(^|\\s)${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|[<=])`, 'm').test(helpText));
  return missing.length ? { status: 'BLOCKED', missing } : { status: 'ok', missing: [] };
}
