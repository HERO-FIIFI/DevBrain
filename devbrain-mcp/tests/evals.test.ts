import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const load = () => readFile(path.join(process.cwd(), 'evals.xml'), 'utf8');
const questions = (xml: string) => [...xml.matchAll(/<question>(.*?)<\/question>/gs)].map((match) => match[1]);
const phase2 = /devbrain_run_[a-z_]+|devbrain_inspect_docker/;
const phase3 = /devbrain_(?:search_text|search_symbols|find_references|read_file_slice|read_symbol|get_diff|get_execution_evidence|diagnose_log|context_pack)/;
const phase4 = /devbrain_(?:dependency_graph|architecture_map|api_inventory|route_inventory|database_schema|migration_status|change_impact)/;

describe('evaluation set', () => {
  it('contains exactly twenty multi-tool qa pairs', async () => {
    const xml = await load();
    expect(xml.match(/<qa_pair>/g)).toHaveLength(20);
    for (const question of questions(xml)) {
      expect(new Set(question.match(/devbrain_[a-z_]+/g) ?? []).size).toBeGreaterThanOrEqual(2);
    }
  });

  it('preserves exactly five evaluations per phase', async () => {
    const asked = questions(await load());
    expect(asked.filter((question) => phase2.test(question) && !phase4.test(question))).toHaveLength(5);
    expect(asked.filter((question) => !phase2.test(question) && !phase3.test(question) && !phase4.test(question))).toHaveLength(5);
    expect(asked.filter((question) => phase3.test(question) && !phase4.test(question))).toHaveLength(5);
    expect(asked.filter((question) => phase4.test(question))).toHaveLength(5);
  });
});
