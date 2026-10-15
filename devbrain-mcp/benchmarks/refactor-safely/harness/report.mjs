// Builds a two-condition pilot comparison without collapsing correctness, context, discipline, or cost into one score.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const unwrap = (record) => record?.value ?? record;
const number = (value) => Number.isFinite(value) ? value : null;
const metricValue = (value) => number(value?.value ?? value);
const difference = (control, devbrain) => control === null || devbrain === null ? null : devbrain - control;
const stats = (values) => {
  const usable = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!usable.length) return { individual: values, mean: null, median: null, range: null };
  const middle = Math.floor(usable.length / 2), median = usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
  return { individual: values, mean: usable.reduce((sum, value) => sum + value, 0) / usable.length, median, range: [usable[0], usable.at(-1)] };
};

function view(record) {
  const value = unwrap(record), visible = value?.context?.agentVisible ?? {}, source = visible.repository_source ?? {};
  return {
    runId: value?.runId ?? null,
    model: { requested: value?.agent?.requestedModel ?? null, resolved: value?.agent?.resolvedModel ?? null, gate: value?.agent?.modelGate ?? null },
    patch: value?.patch ?? null,
    discipline: value?.discipline ?? null,
    context: value?.context ?? null,
    repositorySource: { grossBytes: number(source.grossBytes), uniqueBytes: number(source.uniqueBytes), duplicateBytes: number(source.duplicateBytes), grossLines: number(source.grossLines), uniqueLines: number(source.uniqueLines), duplicateLines: number(source.duplicateLines), duplicationRatio: number(source.duplicationRatio) },
    totalMeasurablePayloadBytes: number(visible.totalMeasurableBytes),
    devbrainMetadataBytes: number(visible.devbrain_metadata?.grossBytes),
    skillInstructionBytes: number(visible.skill_instruction?.grossBytes),
    tools: value?.tools ?? null,
    agentBehavior: value?.agentBehavior ?? null,
    devbrain: value?.devbrain ?? null,
    substitution: value?.treatment?.classification ?? 'unknown',
    durationMs: number(value?.timing?.durationMs),
    usage: value?.usage ?? null,
    notes: value?.notes ?? [],
  };
}

export function buildPilotSummary(controlRecord, devbrainRecord, audit = {}) {
  const control = view(controlRecord), devbrain = view(devbrainRecord);
  const essentialUnknown = [control.repositorySource.grossBytes, control.repositorySource.uniqueBytes, devbrain.repositorySource.grossBytes, devbrain.repositorySource.uniqueBytes].some((value) => value === null);
  const blocked = [control, devbrain].some((run) => run.model.gate?.status && run.model.gate.status !== 'ready');
  const failed = [control, devbrain].some((run) => !run.patch || ['FAILURE', 'HARNESS_ERROR'].includes(run.patch.status)) || audit.isolation === 'failed' || audit.baselineParity === 'mismatch';
  const recommendation = blocked ? 'BLOCKED' : failed || essentialUnknown ? 'REMEDIATE' : 'PROCEED';
  return {
    reportVersion: 1,
    title: 'DEVBrain /refactor-safely — Pilot Benchmark',
    runs: { control, devbrain },
    comparison: {
      repositorySource: {
        grossBytesDifference: difference(control.repositorySource.grossBytes, devbrain.repositorySource.grossBytes),
        uniqueBytesDifference: difference(control.repositorySource.uniqueBytes, devbrain.repositorySource.uniqueBytes),
        duplicateBytesDifference: difference(control.repositorySource.duplicateBytes, devbrain.repositorySource.duplicateBytes),
      },
      totalMeasurablePayload: { bytesDifference: difference(control.totalMeasurablePayloadBytes, devbrain.totalMeasurablePayloadBytes) },
      correctness: { control: control.patch?.status ?? null, devbrain: devbrain.patch?.status ?? null },
      discipline: { control: control.discipline?.status ?? null, devbrain: devbrain.discipline?.status ?? null },
      duration: { millisecondsDifference: difference(control.durationMs, devbrain.durationMs) },
      toolCalls: { difference: difference(number(control.tools?.totalCalls), number(devbrain.tools?.totalCalls)) },
      substitution: devbrain.substitution,
    },
    statistics: {
      repetitionsPerCondition: 1,
      inference: 'not_applicable',
      statement: 'No statistical inference is possible from one repetition per condition.',
      durationMs: { control: stats([control.durationMs]), devbrain: stats([devbrain.durationMs]) },
      repositoryGrossBytes: { control: stats([control.repositorySource.grossBytes]), devbrain: stats([devbrain.repositorySource.grossBytes]) },
      repositoryUniqueBytes: { control: stats([control.repositorySource.uniqueBytes]), devbrain: stats([devbrain.repositorySource.uniqueBytes]) },
    },
    audit,
    instrumentationLimitations: collectLimitations(control, devbrain),
    recommendation,
  };
}

function collectLimitations(...runs) {
  const limitations = ['One repetition per condition cannot support statistical significance.'];
  for (const [index, run] of runs.entries()) {
    if (metricValue(run.context?.deterministicScanning?.subprocessReads) === null) limitations.push(`${index ? 'DEVBrain' : 'CONTROL'} subprocess filesystem reads are unobservable.`);
    if (metricValue(run.context?.evaluatorReads?.subprocessReads) === null) limitations.push(`${index ? 'DEVBrain' : 'CONTROL'} evaluator subprocess reads are unobservable.`);
    if (run.usage?.inputTokens?.value === null) limitations.push(`${index ? 'DEVBrain' : 'CONTROL'} actual input-token usage is unavailable.`);
  }
  return [...new Set(limitations)];
}

const display = (value, suffix = '') => value === null || value === undefined ? 'UNKNOWN' : `${value}${suffix}`;
export function renderPilotMarkdown(summary) {
  const c = summary.runs.control, d = summary.runs.devbrain;
  return `# ${summary.title}\n\n## Baseline\n\n- Model: \`${display(c.model.resolved)}\` (CONTROL), \`${display(d.model.resolved)}\` (DEVBrain)\n- Repetitions: one per condition\n\n## CONTROL\n\n- Patch: ${display(c.patch?.status)}\n- Repository source: ${display(c.repositorySource.grossBytes, ' B gross')} / ${display(c.repositorySource.uniqueBytes, ' B unique')} / ${display(c.repositorySource.duplicateBytes, ' B duplicate')}\n- Total measurable agent-visible payload: ${display(c.totalMeasurablePayloadBytes, ' B')}\n- Tool calls: ${display(c.tools?.totalCalls)}\n- Agent verification discipline: ${display(c.discipline?.status)}\n- Duration: ${display(c.durationMs, ' ms')}\n\n## DEVBrain\n\n- Patch: ${display(d.patch?.status)}\n- Repository source: ${display(d.repositorySource.grossBytes, ' B gross')} / ${display(d.repositorySource.uniqueBytes, ' B unique')} / ${display(d.repositorySource.duplicateBytes, ' B duplicate')}\n- DevBrain metadata: ${display(d.devbrainMetadataBytes, ' B')}\n- Skill instructions: ${display(d.skillInstructionBytes, ' B')}\n- Total measurable agent-visible payload: ${display(d.totalMeasurablePayloadBytes, ' B')}\n- Context Packs: ${display(d.devbrain?.contextPacks?.length)}\n- Tool calls: ${display(d.tools?.totalCalls)}\n- Agent verification discipline: ${display(d.discipline?.status)}\n- Duration: ${display(d.durationMs, ' ms')}\n\n## Comparison\n\n- Repository gross-byte difference: ${display(summary.comparison.repositorySource.grossBytesDifference, ' B')}\n- Repository unique-byte difference: ${display(summary.comparison.repositorySource.uniqueBytesDifference, ' B')}\n- Total measurable-payload difference: ${display(summary.comparison.totalMeasurablePayload.bytesDifference, ' B')}\n- Correctness: CONTROL ${display(summary.comparison.correctness.control)} / DEVBrain ${display(summary.comparison.correctness.devbrain)}\n- Verification discipline: CONTROL ${display(summary.comparison.discipline.control)} / DEVBrain ${display(summary.comparison.discipline.devbrain)}\n- Time difference: ${display(summary.comparison.duration.millisecondsDifference, ' ms')}\n- Substitution versus accumulation: ${display(summary.comparison.substitution)}\n\n## Statistical discipline\n\n${summary.statistics.statement}\n\n## Instrumentation limitations\n\n${summary.instrumentationLimitations.map((item) => `- ${item}`).join('\n')}\n\n## Recommendation\n\n**${summary.recommendation}**\n`;
}

export async function writePilotReports(directory, summary) {
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, 'benchmark-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
    await writeFile(path.join(directory, 'benchmark-summary.md'), renderPilotMarkdown(summary), { flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('REPORT_ALREADY_EXISTS', { cause: error });
    throw error;
  }
  return { json: path.join(directory, 'benchmark-summary.json'), markdown: path.join(directory, 'benchmark-summary.md') };
}
