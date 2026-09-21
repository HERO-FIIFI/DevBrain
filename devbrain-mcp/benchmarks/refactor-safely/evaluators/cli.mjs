// Runs one hidden evaluator in its own process: `node evaluators/cli.mjs <taskId> <repositoryRoot>` prints JSON.
import process from 'node:process';
import { loadTask } from '../harness/fixtures.mjs';
import { evaluateTaskA } from './task-a.mjs';
import { evaluateTaskB } from './task-b.mjs';
import { evaluateTaskC } from './task-c.mjs';

export const EVALUATORS = Object.freeze({ 'task-a': evaluateTaskA, 'task-b': evaluateTaskB, 'task-c': evaluateTaskC });

const [taskId, root] = process.argv.slice(2);
const evaluate = EVALUATORS[taskId];
if (!evaluate || !root) { process.stderr.write('usage: node evaluators/cli.mjs <task-a|task-b|task-c> <repositoryRoot>\n'); process.exitCode = 2; }
else {
  try { const task = await loadTask(taskId); process.stdout.write(`${JSON.stringify(await evaluate(root, task))}\n`); }
  catch (error) { process.stderr.write(`EVALUATOR_FAILED: ${error.stack ?? error.message}\n`); process.exitCode = 1; }
}
