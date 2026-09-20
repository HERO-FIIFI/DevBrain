// One benchmark run record. Every section starts unknown (null) and is filled only from cited raw evidence.
export const CONDITIONS = Object.freeze(['control', 'devbrain']);
export const RECORD_VERSION = 1;

export function newRunRecord({ runId, taskId, condition, repetition }) {
  if (typeof runId !== 'string' || !runId || typeof taskId !== 'string' || !taskId || !CONDITIONS.includes(condition) || !Number.isInteger(repetition) || repetition < 1) throw new Error('INVALID_RUN_IDENTITY');
  return {
    recordVersion: RECORD_VERSION,
    runId, taskId, condition, repetition,
    agent: { requestedModel: null, resolvedModel: null, configuration: null },
    baseline: { repositorySha: null, contentSha256: null, files: null },
    // Three read domains, never summed together: agent-visible payload, harness scanning, evaluator reads.
    context: { agentVisible: null, deterministicScanning: null, evaluatorReads: null },
    tools: null,
    changes: null,
    harnessVerification: null,
    agentBehavior: null,
    patch: null,
    timing: { startedAt: null, endedAt: null, durationMs: null },
    notes: [],
    provenance: { parserVersion: null, raw: [] },
  };
}
