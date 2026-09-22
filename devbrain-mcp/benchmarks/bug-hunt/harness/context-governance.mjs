export const CONTEXT_EXPANSION_REASONS = Object.freeze([
  'ambiguous_symbol',
  'truncated_references',
  'low_confidence_resolution',
  'new_stack_frame',
  'failed_hypothesis',
  'unexpected_dependency',
  'new_test_failure',
]);

const REASON_TOOLS = Object.freeze({
  ambiguous_symbol: new Set(['devbrain_read_symbol']),
  truncated_references: new Set(['devbrain_find_references', 'devbrain_change_impact']),
  low_confidence_resolution: new Set(['devbrain_read_symbol', 'devbrain_read_file_slice', 'devbrain_find_references']),
  new_stack_frame: new Set(['devbrain_read_file_slice']),
  failed_hypothesis: new Set(['devbrain_read_file_slice', 'devbrain_read_symbol', 'devbrain_find_references']),
  unexpected_dependency: new Set(['devbrain_dependency_graph', 'devbrain_change_impact', 'devbrain_find_references', 'devbrain_read_file_slice']),
  new_test_failure: new Set(['devbrain_diagnose_log', 'devbrain_read_file_slice']),
});

function unmet(reason, detail) {
  return { reason, detail };
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function hasRecordedUnknowns(unknowns) {
  return Array.isArray(unknowns)
    && unknowns.length > 0
    && unknowns.every((unknown) => nonEmptyString(unknown?.note));
}

function hasRepositoryWideUnknown(unknowns) {
  return (unknowns ?? []).some((unknown) => (
    unknown?.requiresRepositoryWideRead === true || unknown?.scope === 'repository_wide'
  ));
}

function hasRelevantFrames(frames) {
  const relevant = (frames ?? []).filter((frame) => frame?.relevant !== false && frame?.inRepository !== false);
  return relevant.length > 0 && relevant.every((frame) => (
    (nonEmptyString(frame.file) && Number.isInteger(frame.line))
    || (frame.included === false && nonEmptyString(frame.exclusionReason))
  ));
}

function hasResolvedSuspect(suspect) {
  return suspect?.definitionResolved === true && nonEmptyString(suspect.file);
}

function hasNearestObservable(value) {
  return value && nonEmptyString(value.file) && Number.isInteger(value.line)
    && ['caller', 'test'].includes(value.type);
}

function isLowConfidence(value) {
  return ['low', 'unknown'].includes(value);
}

function ambiguityNeedsCorroboration(evidence) {
  const ambiguity = evidence.ambiguity ?? {};
  return ambiguity.corroborated !== true
    || isLowConfidence(ambiguity.confidence)
    || isLowConfidence(evidence.suspect?.confidence)
    || (evidence.lowConfidenceResolution === true && ambiguity.corroborated !== true);
}

function hasFalsifiablePrediction(prediction) {
  return Array.isArray(prediction?.preconditions)
    && prediction.preconditions.length > 0
    && nonEmptyString(prediction.outcome);
}

function contextTriggers(evidence, reason) {
  const values = [];
  const add = (item) => {
    if (nonEmptyString(item)) values.push(item);
  };
  const addEvents = (items) => (items ?? []).forEach((item) => add(item?.eventId ?? item?.id ?? item?.trigger));

  if (reason === 'ambiguous_symbol') {
    if (evidence.ambiguity?.corroborated !== true || evidence.suspect?.ambiguous === true) {
      add(evidence.ambiguity?.eventId ?? evidence.suspect?.eventId);
      addEvents(evidence.ambiguities);
    }
  }
  if (reason === 'truncated_references' && evidence.impact?.truncated === true) {
    add(evidence.impact?.eventId);
  }
  if (reason === 'low_confidence_resolution' && ambiguityNeedsCorroboration(evidence)) {
    add(evidence.ambiguity?.eventId ?? evidence.suspect?.eventId ?? evidence.lowConfidenceEventId);
  }
  if (reason === 'new_stack_frame') {
    addEvents(evidence.newStackFrames);
    addEvents((evidence.diagnosticFrames ?? []).filter((frame) => frame?.new === true));
  }
  if (reason === 'failed_hypothesis') {
    addEvents(evidence.failedHypotheses);
    addEvents((evidence.hypotheses ?? []).filter((hypothesis) => ['failed', 'rejected'].includes(hypothesis?.status)));
  }
  if (reason === 'unexpected_dependency') addEvents(evidence.unexpectedDependencies);
  if (reason === 'new_test_failure') {
    addEvents(evidence.newTestFailures);
    addEvents(evidence.testFailures);
  }
  return values;
}

function expansionPart(expansion, key) {
  return expansion?.action?.[key] ?? expansion?.[key];
}

function expansionRead(expansion) {
  return expansion?.read ?? null;
}

function normalizedFile(file) {
  return String(file).replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
}

function overlaps(left, right) {
  return left.startLine <= right.endLine && right.startLine <= left.endLine;
}

function isBroadRead(expansion) {
  const scope = expansion?.action?.scope ?? expansion?.scope ?? expansion?.read?.scope;
  return ['directory', 'repository', 'whole_directory', 'whole_repository'].includes(scope);
}

function isEditTarget(expansion) {
  return expansion?.target?.type === 'edit'
    || expansion?.action?.operation === 'edit'
    || expansion?.action?.mode === 'edit';
}

function expansionViolations(evidence, expansion) {
  const violations = [];
  const violate = (code, detail) => violations.push({ code, detail });
  if (!expansion || typeof expansion !== 'object') {
    violate('INVALID_CONTEXT_EXPANSION', 'expansion must be an object');
    return violations;
  }

  const { reason } = expansion;
  if (!CONTEXT_EXPANSION_REASONS.includes(reason)) {
    violate('INVALID_EXPANSION_REASON', `reason ${JSON.stringify(reason)} is not approved`);
    return violations;
  }
  const trigger = expansion.trigger ?? expansion.triggeringEvidence?.eventId;
  if (!nonEmptyString(trigger)) violate('EXPANSION_TRIGGER_REQUIRED', 'expansion needs a triggering evidence event');
  else if (!contextTriggers(evidence, reason).includes(trigger)) {
    violate('EXPANSION_WITHOUT_TRIGGER', `no ${reason} evidence carries trigger ${trigger}`);
  }
  if (!nonEmptyString(expansion.hypothesis)) {
    violate('EXPANSION_HYPOTHESIS_REQUIRED', 'expansion needs the hypothesis it informs');
  }

  const tool = expansionPart(expansion, 'tool');
  if (!REASON_TOOLS[reason].has(tool)) {
    violate('EXPANSION_NOT_TARGETED', `${tool ?? 'missing tool'} is not approved for ${reason}`);
  }
  const file = expansionPart(expansion, 'file');
  const read = expansionRead(expansion);
  if (['devbrain_read_symbol', 'devbrain_read_file_slice'].includes(tool) && !nonEmptyString(file)) {
    violate('FILE_QUALIFIER_REQUIRED', `${tool} requires a repository file`);
  }
  if (tool === 'devbrain_read_symbol' && !nonEmptyString(expansionPart(expansion, 'symbol'))) {
    violate('SYMBOL_REQUIRED', 'devbrain_read_symbol requires a symbol');
  }
  if (isBroadRead(expansion)) {
    violate('UNJUSTIFIED_BROAD_READ', 'whole-directory and repository-wide reads are not bounded expansions');
  }
  if (reason === 'low_confidence_resolution' && isEditTarget(expansion)) {
    violate('LOW_CONFIDENCE_NOT_EDIT_TARGET', 'low-confidence evidence may authorize inspection, not an edit target');
  }
  if (read) {
    if (!nonEmptyString(read.file) || !Number.isInteger(read.startLine) || !Number.isInteger(read.endLine) || read.startLine < 1 || read.endLine < read.startLine) {
      violate('INVALID_READ_INTERVAL', 'read needs an inclusive repository file interval');
    }
    if (read.bytes !== null && (!Number.isInteger(read.bytes) || read.bytes < 0)) {
      violate('INVALID_READ_BYTES', 'read bytes must be an exact non-negative integer or null');
    }
    if (!['context_pack', 'devbrain_slice', 'other'].includes(read.source)) {
      violate('INVALID_READ_SOURCE', 'read source must identify its provenance');
    }
    if (!nonEmptyString(read.trigger) || !nonEmptyString(read.eventId)) {
      violate('READ_PROVENANCE_REQUIRED', 'read needs trigger and eventId');
    }
    const existingReads = [...(evidence.reads ?? []), ...(evidence.includedReads ?? [])];
    const triggerIsNewEvidence = contextTriggers(evidence, reason).includes(trigger);
    if (assessBugContext(evidence).sufficient && !triggerIsNewEvidence && existingReads.some((existing) => (
      normalizedFile(existing.file) === normalizedFile(read.file) && overlaps(existing, read)
    ))) {
      violate('SUFFICIENT_EVIDENCE_REREAD', 'included material was reread without a newly evidenced approved trigger');
    }
  }
  return violations;
}

export function assessBugContext(evidence = {}) {
  const unmetCriteria = [];
  if (!hasRelevantFrames(evidence.diagnosticFrames)) {
    unmetCriteria.push(unmet('relevant_diagnostic_frames', 'relevant in-repository diagnostic frames are missing or unaccounted for'));
  }
  if (!hasResolvedSuspect(evidence.suspect)) {
    unmetCriteria.push(unmet('suspect_definition', 'the suspect definition is not resolved to a repository file'));
  }
  if (!hasNearestObservable(evidence.nearestObservable)) {
    unmetCriteria.push(unmet('nearest_observable_caller_or_test', 'the nearest observable caller or test is not resolved'));
  }
  if (ambiguityNeedsCorroboration(evidence)) {
    unmetCriteria.push(unmet('ambiguity_or_low_confidence_corroboration', 'ambiguous or low-confidence text lacks bounded corroboration'));
  }
  if (evidence.impact?.truncated === true) {
    unmetCriteria.push(unmet('truncated_references', 'directly relevant references were truncated'));
  }
  if ((evidence.impact?.budgetExcluded ?? []).length > 0 || evidence.impact?.silentBudgetExclusion === true) {
    unmetCriteria.push(unmet('silent_budget_exclusion', 'directly relevant candidates were budget-excluded'));
  }
  if (!hasFalsifiablePrediction(evidence.prediction)) {
    unmetCriteria.push(unmet('falsifiable_prediction', 'precondition and outcome context cannot state a falsifiable prediction'));
  }
  if (!Array.isArray(evidence.contradictions) || evidence.contradictions.length === 0) {
    unmetCriteria.push(unmet('contradictory_evidence', 'known contradictory evidence is absent'));
  }
  if (!hasRecordedUnknowns(evidence.unknowns)) {
    unmetCriteria.push(unmet('remaining_unknowns', 'remaining unknowns are not recorded'));
  }
  if (hasRepositoryWideUnknown(evidence.unknowns)) {
    unmetCriteria.push(unmet('repository_wide_unknown', 'a remaining unknown demands repository-wide reading'));
  }
  return { sufficient: unmetCriteria.length === 0, unmet: unmetCriteria };
}

export function gradeContextExpansion(evidence = {}, expansion) {
  const violations = expansionViolations(evidence, expansion);
  return { permitted: violations.length === 0, violations };
}

function validateRead(read) {
  if (!read || typeof read !== 'object' || !nonEmptyString(read.file)
    || !Number.isInteger(read.startLine) || !Number.isInteger(read.endLine)
    || read.startLine < 1 || read.endLine < read.startLine) {
    throw new Error('INVALID_CONTEXT_READ');
  }
  if (read.bytes !== null && (!Number.isInteger(read.bytes) || read.bytes < 0)) {
    throw new Error('INVALID_CONTEXT_READ_BYTES');
  }
}

export function summarizeReads(reads = []) {
  if (!Array.isArray(reads)) throw new Error('CONTEXT_READS_MUST_BE_ARRAY');
  const priorByFile = new Map();
  const intervalsByFile = new Map();
  const duplicateIntervals = [];
  let grossLines = 0;
  let missingBytes = false;
  let byteTotal = 0;

  for (const read of reads) {
    validateRead(read);
    const normalized = { ...read, file: normalizedFile(read.file) };
    grossLines += normalized.endLine - normalized.startLine + 1;
    if (normalized.bytes === null) missingBytes = true;
    else byteTotal += normalized.bytes;
    const prior = priorByFile.get(normalized.file) ?? [];
    for (const previous of prior) {
      if (!overlaps(previous, normalized)) continue;
      duplicateIntervals.push({
        file: normalized.file,
        startLine: Math.max(previous.startLine, normalized.startLine),
        endLine: Math.min(previous.endLine, normalized.endLine),
        eventIds: [previous.eventId, normalized.eventId],
      });
    }
    prior.push(normalized);
    priorByFile.set(normalized.file, prior);
    const intervals = intervalsByFile.get(normalized.file) ?? [];
    intervals.push({ startLine: normalized.startLine, endLine: normalized.endLine });
    intervalsByFile.set(normalized.file, intervals);
  }

  let uniqueLines = 0;
  for (const intervals of intervalsByFile.values()) {
    const sorted = [...intervals].sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
    let current = null;
    for (const interval of sorted) {
      if (!current || interval.startLine > current.endLine + 1) {
        if (current) uniqueLines += current.endLine - current.startLine + 1;
        current = { ...interval };
      } else {
        current.endLine = Math.max(current.endLine, interval.endLine);
      }
    }
    if (current) uniqueLines += current.endLine - current.startLine + 1;
  }
  return {
    grossLines,
    uniqueLines,
    duplicateLines: grossLines - uniqueLines,
    duplicateIntervals,
    bytes: missingBytes
      ? { total: null, reason: 'MISSING_BYTE_COUNTS' }
      : { total: byteTotal, reason: null },
  };
}

export function checkContextBudget(trace = {}) {
  const expansions = trace.expansions ?? [];
  if (!Array.isArray(expansions)) throw new Error('CONTEXT_EXPANSIONS_MUST_BE_ARRAY');
  const summary = summarizeReads(trace.reads ?? []);
  const violations = [];
  if (expansions.length > 5) {
    violations.push({
      code: 'CONTEXT_EXPANSION_BUDGET_EXHAUSTED',
      detail: `used ${expansions.length} expansions after the first pack; maximum is 5`,
    });
  }
  if (summary.duplicateIntervals.length > 0) {
    violations.push({
      code: 'DUPLICATE_READ_INTERVAL',
      detail: `${summary.duplicateIntervals.length} read interval(s) overlap previously read material`,
      intervals: summary.duplicateIntervals,
    });
  }
  return {
    status: expansions.length > 5 ? 'exhausted' : 'within_budget',
    expansionsUsed: expansions.length,
    expansionsMaximum: 5,
    duplicateIntervals: summary.duplicateIntervals,
    violations,
  };
}
