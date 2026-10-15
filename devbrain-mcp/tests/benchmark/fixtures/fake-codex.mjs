// Stand-in child process for harness tests: emits JSONL on stdout, one line on stderr, then exits or hangs.
import process from 'node:process';
import { setInterval } from 'node:timers';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index === -1 ? fallback : args[index + 1]; };
const lines = Number(option('--lines', '3')), exitCode = Number(option('--exit', '0')), hang = args.includes('--hang');

process.stderr.write('fake-codex: started\nmodel: gpt-5.6-sol\n');
process.stdout.write('{"type":"thread.started","thread_id":"fake"}\n');
for (let index = 0; index < lines; index += 1) process.stdout.write(`${JSON.stringify({ type: 'item.completed', item: { id: `item_${index}`, type: 'agent_message', text: `line ${index}` } })}\n`);
if (hang) setInterval(() => {}, 1_000);
else { process.stdout.write('{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}\n'); process.exitCode = exitCode; }
