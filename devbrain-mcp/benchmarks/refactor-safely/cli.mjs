#!/usr/bin/env node
// Operator CLI. Live model and pilot paths always require an explicit approval record; validate is offline-only.
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadTask, materializeTask } from './harness/fixtures.mjs';
import { buildPilotSummary, writePilotReports } from './harness/report.mjs';
import { preflightModel, runCondition, runPilotAfterApproval } from './harness/runner.mjs';

const COMMANDS = new Set(['prepare', 'validate', 'preflight-model', 'run', 'pilot', 'report', 'help']);
const VALUE_OPTIONS = new Set(['task', 'condition', 'repetition', 'approval', 'output', 'runs-root', 'control-record', 'devbrain-record']);
const TASKS = new Set(['task-a', 'task-b', 'task-c']);

export function parseArguments(argv) {
  const [command = 'help', ...rest] = argv;
  if (!COMMANDS.has(command)) throw new Error(`UNKNOWN_COMMAND: ${command}`);
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index]; if (!flag?.startsWith('--')) throw new Error(`INVALID_OPTION: ${flag}`);
    const key = flag.slice(2); if (!VALUE_OPTIONS.has(key) || rest[index + 1] === undefined) throw new Error(`INVALID_OPTION: ${flag}`);
    options[key] = key === 'repetition' ? Number(rest[index + 1]) : rest[index + 1];
  }
  // Tasks B/C are materialized by offline validation only. Measured CLI runs are
  // deliberately bounded to the approved Task A pilot matrix.
  if (options.task && options.task !== 'task-a') throw new Error(`TASK_OUT_OF_SCOPE: ${options.task}`);
  if (options.condition && !['control', 'devbrain'].includes(options.condition)) throw new Error(`CONDITION_OUT_OF_SCOPE: ${options.condition}`);
  if (options.repetition !== undefined && options.repetition !== 1) throw new Error(`REPETITION_OUT_OF_SCOPE: ${options.repetition}`);
  return { command, options };
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const usage = 'Usage: node benchmarks/refactor-safely/cli.mjs <prepare|validate|preflight-model|run|pilot|report> [options]';

export async function main(argv = process.argv.slice(2), deps = {}) {
  const write = deps.write ?? ((line) => process.stdout.write(line.endsWith('\n') ? line : `${line}\n`));
  try {
    const { command, options } = parseArguments(argv);
    if (command === 'help') { write(usage); return 0; }
    if (command === 'validate' || command === 'prepare') {
      const result = await validateFixtures(options.output);
      write(json(result)); return result.status === 'ready' ? 0 : 1;
    }
    const approval = await readApproval(options.approval);
    if (!approval) { write(json({ status: 'BLOCKED', error: 'PILOT_NOT_AUTHORIZED: provide --approval with statement PILOT_EXECUTION_APPROVED and approvedBy' })); return 2; }
    if (command === 'preflight-model') {
      const preflight = await (deps.preflight ?? preflightModel)();
      if (options.output) { await mkdir(options.output, { recursive: true }); await writeFile(path.join(options.output, 'model-preflight.json'), json(preflight), { flag: 'wx' }); }
      write(json(preflight)); return preflight.status === 'ready' ? 0 : 2;
    }
    if (command === 'run') {
      const taskId = options.task ?? 'task-a', condition = options.condition, repetition = options.repetition ?? 1;
      if (!condition) throw new Error('CONDITION_REQUIRED');
      const result = await (deps.run ?? runCondition)({ taskId, condition, repetition, runsRoot: options['runs-root'] ?? path.resolve('benchmarks/refactor-safely/runs'), environment: process.env });
      write(json(result)); return result.state === 'derived' ? 0 : 1;
    }
    if (command === 'pilot') {
      const result = await (deps.pilot ?? runPilotAfterApproval)({ approval, runsRoot: options['runs-root'] ?? path.resolve('benchmarks/refactor-safely/runs'), environment: process.env });
      write(json(result)); return result.runs?.every((run) => run.state === 'derived') ? 0 : 1;
    }
    if (command === 'report') {
      if (!options['control-record'] || !options['devbrain-record']) throw new Error('REPORT_RECORDS_REQUIRED');
      const [control, devbrain] = await Promise.all([options['control-record'], options['devbrain-record']].map(async (file) => JSON.parse(await readFile(file, 'utf8'))));
      const summary = buildPilotSummary(control, devbrain);
      await writePilotReports(options.output ?? path.resolve('benchmarks/refactor-safely/reports'), summary);
      write(json({ status: 'written', recommendation: summary.recommendation })); return 0;
    }
    throw new Error(`UNKNOWN_COMMAND: ${command}`);
  } catch (error) { write(json({ status: 'error', error: error.message })); return 1; }
}

async function readApproval(file) {
  if (!file) return null;
  try { const approval = JSON.parse(await readFile(path.resolve(file), 'utf8')); return approval?.statement === 'PILOT_EXECUTION_APPROVED' && approval?.approvedBy ? approval : null; } catch { return null; }
}

async function validateFixtures(output) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'devbrain-benchmark-validate-')), tasks = {};
  try {
    for (const taskId of TASKS) {
      const task = await loadTask(taskId), first = await materializeTask(task, path.join(temp, `${taskId}-1`)), second = await materializeTask(task, path.join(temp, `${taskId}-2`));
      tasks[taskId] = { identical: first.repositorySha === second.repositorySha && first.contentSha256 === second.contentSha256 && JSON.stringify(first.files) === JSON.stringify(second.files), repositorySha: first.repositorySha, contentSha256: first.contentSha256, files: first.files.length };
    }
    const result = { status: Object.values(tasks).every((task) => task.identical) ? 'ready' : 'mismatch', tasks };
    if (output) { await mkdir(output, { recursive: true }); await writeFile(path.join(output, 'fixture-validation.json'), json(result), { flag: 'wx' }); }
    return result;
  } finally { await rm(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
