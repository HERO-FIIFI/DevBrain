import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const load = () => readFile(path.join(process.cwd(), 'evals.xml'), 'utf8');
const questions = (xml: string) => [...xml.matchAll(/<question>(.*?)<\/question>/gs)].map((match) => match[1]);
const phase2 = /devbrain_run_[a-z_]+|devbrain_inspect_docker/;

describe('evaluation set', () => {
  it('contains exactly ten multi-tool qa pairs', async () => {
    const xml = await load();
    expect(xml.match(/<qa_pair>/g)).toHaveLength(10);
    for (const question of questions(xml)) {
      expect(new Set(question.match(/devbrain_[a-z_]+/g) ?? []).size).toBeGreaterThanOrEqual(2);
    }
  });

  it('preserves five phase 1 evaluations and adds exactly five phase 2 evaluations', async () => {
    const asked = questions(await load());
    expect(asked.filter((question) => phase2.test(question))).toHaveLength(5);
    expect(asked.filter((question) => !phase2.test(question))).toHaveLength(5);
  });
});
