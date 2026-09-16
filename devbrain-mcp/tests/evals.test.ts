import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('evaluation set', () => it('contains exactly five multi-tool qa pairs', async () => {
  const xml = await readFile(path.join(process.cwd(), 'evals.xml'), 'utf8');
  expect(xml.match(/<qa_pair>/g)).toHaveLength(5);
  for (const question of xml.matchAll(/<question>(.*?)<\/question>/gs)) {
    expect(new Set(question[1].match(/devbrain_[a-z_]+/g) ?? []).size).toBeGreaterThanOrEqual(2);
  }
}));
