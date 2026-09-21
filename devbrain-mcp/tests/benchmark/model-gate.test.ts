import { describe, expect, it } from 'vitest';
import { PINNED_MODEL } from '../../benchmarks/refactor-safely/harness/conditions.mjs';
import { assertPinnedModel, catalogFromJson, discoverModels, resolveModelEvidence, verifyCliSurface } from '../../benchmarks/refactor-safely/harness/model-gate.mjs';
import { parseJsonl } from '../../benchmarks/refactor-safely/harness/events.mjs';

describe('pinned model gate', () => {
  it('is ready only for an exact requested/resolved match', () => {
    expect(assertPinnedModel({ requested: 'gpt-5.6-sol', resolved: 'gpt-5.6-sol' })).toMatchObject({ status: 'ready' });
    expect(assertPinnedModel({ requested: 'gpt-5.6-sol', resolved: null })).toMatchObject({ status: 'BLOCKED', reason: expect.stringContaining('no resolved model evidence') });
  });
  it('blocks alias, conflicting, wrong-request, and untrusted evidence', () => {
    expect(assertPinnedModel({ requested: 'gpt-5.6-sol', resolved: 'gpt-5.6' })).toMatchObject({ status: 'BLOCKED', reason: expect.stringContaining('resolved "gpt-5.6"') });
    expect(assertPinnedModel({ requested: 'gpt-5.6-sol', resolved: 'gpt-5.6-sol', catalog: { status: 'ok', models: ['gpt-5.6', 'gpt-5.6-sol'], aliases: { 'gpt-5.6-sol': 'gpt-5.6' } } })).toMatchObject({ status: 'BLOCKED', reason: expect.stringContaining('alias') });
    expect(assertPinnedModel({ requested: 'gpt-5.6', resolved: 'gpt-5.6' })).toMatchObject({ status: 'BLOCKED', reason: expect.stringContaining(`requested model must be ${PINNED_MODEL}`) });
    expect(assertPinnedModel({ requested: 'gpt-5.6-sol', resolved: 'gpt-5.6-sol', evidence: { source: 'operator_assertion' } })).toMatchObject({ status: 'BLOCKED', reason: expect.stringContaining('untrusted') });
    expect(assertPinnedModel({ requested: 'gpt-5.6-sol', resolved: 'gpt-5.6-sol', evidence: { source: 'cli_session_metadata', raw: 'model: gpt-5.6-sol' } })).toMatchObject({ status: 'ready' });
  });
  it('blocks when discovery failed, the catalog lacks the model, or the CLI rejected it', () => {
    expect(assertPinnedModel({ requested: 'gpt-5.6-sol', resolved: 'gpt-5.6-sol', catalog: { status: 'failed', error: 'codex: command not found' } })).toMatchObject({ status: 'BLOCKED', reason: expect.stringContaining('discovery failed') });
    expect(assertPinnedModel({ requested: 'gpt-5.6-sol', resolved: 'gpt-5.6-sol', catalog: { status: 'ok', models: ['gpt-5.5'], aliases: {} } })).toMatchObject({ status: 'BLOCKED', reason: expect.stringContaining('catalog does not list') });
    expect(assertPinnedModel({ requested: 'gpt-5.6-sol', resolved: null, cliRejection: 'error: unknown model gpt-5.6-sol' })).toMatchObject({ status: 'BLOCKED', reason: expect.stringContaining('CLI rejected') });
  });
});

describe('model discovery adapters', () => {
  it('parses the installed debug-models JSON catalog shape', () => {
    expect(catalogFromJson('{"models":[{"slug":"gpt-5.6-sol","displayName":"GPT 5.6 Sol"}]}')).toEqual({ models: ['gpt-5.6-sol'], aliases: {} });
  });
  it('records every adapter attempt and never fabricates a catalog', async () => {
    const adapters = [
      { name: 'cli_version', run: async () => ({ status: 'ok', raw: 'codex-cli 0.99.0', models: [], aliases: {} }) },
      { name: 'debug_models', run: async () => { throw new Error('unrecognized subcommand debug'); } },
      { name: 'models_cache', run: async () => ({ status: 'ok', raw: '{"models":[{"slug":"gpt-5.6-sol"},{"slug":"gpt-5.6","aliases":["gpt-5.6-latest"]}]}', models: ['gpt-5.6-sol', 'gpt-5.6'], aliases: { 'gpt-5.6-latest': 'gpt-5.6' } }) },
    ];
    const discovery = await discoverModels({ adapters });
    expect(discovery.adapters.map((adapter: any) => [adapter.name, adapter.status])).toEqual([['cli_version', 'ok'], ['debug_models', 'failed'], ['models_cache', 'ok']]);
    expect(discovery.adapters[1].error).toContain('unrecognized subcommand');
    expect(discovery.catalog).toEqual({ status: 'ok', models: ['gpt-5.6', 'gpt-5.6-sol'], aliases: { 'gpt-5.6-latest': 'gpt-5.6' }, sources: ['models_cache'] });
  });
  it('reports a failed catalog when no adapter produced models', async () => {
    const discovery = await discoverModels({ adapters: [{ name: 'cli_version', run: async () => { throw new Error('spawn codex ENOENT'); } }] });
    expect(discovery.catalog).toEqual({ status: 'failed', error: 'no adapter produced a model catalog', sources: [] });
    expect(assertPinnedModel({ requested: PINNED_MODEL, resolved: PINNED_MODEL, catalog: discovery.catalog })).toMatchObject({ status: 'BLOCKED' });
  });
  it('uses the installed CLI adapters by default and degrades to BLOCKED when absent', async () => {
    const discovery = await discoverModels({ executable: 'definitely-not-a-real-codex-binary', codexHome: 'C:/nonexistent/codex-home' });
    expect(discovery.adapters.map((adapter: any) => adapter.name)).toEqual(['cli_version', 'debug_models', 'models_cache']);
    expect(discovery.adapters.every((adapter: any) => adapter.status === 'failed')).toBe(true);
    expect(discovery.catalog.status).toBe('failed');
  }, 30_000);
});

describe('resolved model evidence from run artifacts', () => {
  it('finds a model field in events and reports its source line', () => {
    const parsed = parseJsonl('{"type":"thread.started","thread_id":"t","model":"gpt-5.6-sol"}\n{"type":"turn.started"}\n');
    expect(resolveModelEvidence({ parsed })).toEqual({ resolved: 'gpt-5.6-sol', evidence: { source: 'event', eventId: 'L1', field: 'model', raw: 'gpt-5.6-sol' }, conflicts: [] });
  });
  it('reports conflicts when events disagree', () => {
    const parsed = parseJsonl('{"type":"thread.started","thread_id":"t","model":"gpt-5.6-sol"}\n{"type":"turn.completed","usage":{"input_tokens":1},"model":"gpt-5.6"}\n');
    const evidence = resolveModelEvidence({ parsed });
    expect(evidence.resolved).toBeNull();
    expect(evidence.conflicts).toEqual([{ eventId: 'L1', field: 'model', value: 'gpt-5.6-sol' }, { eventId: 'L2', field: 'model', value: 'gpt-5.6' }]);
    expect(assertPinnedModel({ requested: PINNED_MODEL, ...evidence })).toMatchObject({ status: 'BLOCKED', reason: expect.stringContaining('conflict') });
  });
  it('falls back to a stderr model line and otherwise stays unresolved', () => {
    expect(resolveModelEvidence({ parsed: parseJsonl('{"type":"turn.started"}\n'), stderr: 'model: gpt-5.6-sol\nsandbox: workspace-write\n' })).toEqual({ resolved: 'gpt-5.6-sol', evidence: { source: 'cli_session_metadata', field: 'stderr:model', raw: 'model: gpt-5.6-sol' }, conflicts: [] });
    expect(resolveModelEvidence({ parsed: parseJsonl('{"type":"turn.started"}\n'), stderr: '' })).toEqual({ resolved: null, evidence: null, conflicts: [] });
  });
});

describe('CLI surface verification', () => {
  it('requires every planned flag to appear in the help text', () => {
    const help = 'Usage: codex exec [OPTIONS] [PROMPT]\n  -m, --model <MODEL>\n      --json\n      --ephemeral\n      --ignore-user-config\n  -s, --sandbox <MODE>\n  -a, --ask-for-approval <POLICY>\n';
    expect(verifyCliSurface(help, ['--model', '--json', '--ephemeral', '--ignore-user-config', '--sandbox', '--ask-for-approval'])).toEqual({ status: 'ok', missing: [] });
    expect(verifyCliSurface(help.replace('      --ignore-user-config\n', ''), ['--model', '--ignore-user-config'])).toEqual({ status: 'BLOCKED', missing: ['--ignore-user-config'] });
  });
  it('requires only the stable invariant-bearing exec surface', () => {
    const help = 'Usage: codex exec [OPTIONS] [PROMPT]\n  -m, --model <MODEL>\n      --json\n      --ephemeral\n  -s, --sandbox <MODE>\n';
    expect(verifyCliSurface(help, ['--model', '--json', '--ephemeral', '--sandbox'])).toEqual({ status: 'ok', missing: [] });
  });
});
