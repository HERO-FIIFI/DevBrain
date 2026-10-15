// Exposure accounting across three read domains that are never summed together. Repository-source exposure is
// deduplicated per (file, line) so a reread contributes to gross but not unique exposure; unattributable source
// output keeps exact aggregate bytes while unique/duplicate values degrade to partial rather than being estimated.
import { Buffer } from 'node:buffer';
import { CONFIDENCE, exact, measurement, partial, unknownMeasurement } from './measurements.mjs';

export const DOMAINS = Object.freeze(['agent_visible', 'deterministic_scanning', 'evaluator_reads']);
export const CATEGORIES = Object.freeze(['repository_source', 'devbrain_metadata', 'verification_output', 'task_instruction', 'skill_instruction', 'other_tool_output']);

/** UTF-8 bytes of a line plus its newline; the one byte rule every accounting path shares. */
export const lineBytes = (line) => Buffer.byteLength(line, 'utf8') + 1;

// Line-number prefixes that DevBrain (`12: text`) and `cat -n` (`    12\ttext`) add; stripped for identity, kept for bytes.
const NUMBERED = { devbrain: /^\d+: ?/, 'cat-n': /^\s*\d+\t/ };

export class ExposureLedger {
  constructor() { this.entries = []; this.identity = new Map(); }

  add(exposure) {
    const { domain, category, confidence } = exposure;
    if (!DOMAINS.includes(domain)) throw new Error(`INVALID_DOMAIN: ${domain}`);
    if (!CATEGORIES.includes(category)) throw new Error(`INVALID_CATEGORY: ${category}`);
    if (!CONFIDENCE.includes(confidence)) throw new Error(`INVALID_CONFIDENCE: ${confidence}`);
    const entry = { domain, category, confidence, eventId: exposure.eventId ?? null, origin: exposure.origin ?? null, reason: exposure.reason ?? null, file: exposure.file ?? null, startLine: null, endLine: null, attributed: false, grossLines: 0, uniqueLines: 0, grossBytes: 0, uniqueBytes: 0, unknownReason: null };
    if (confidence === 'unknown') {
      if (!exposure.unknownReason) throw new Error('UNKNOWN_REQUIRES_REASON');
      entry.unknownReason = exposure.unknownReason; entry.grossBytes = null;
    } else if (typeof exposure.text === 'string' && exposure.file && Number.isInteger(exposure.startLine)) {
      this.#addAttributed(entry, exposure);
    } else {
      entry.grossBytes = (exposure.sourceBytes ?? 0) + (exposure.metadataBytes ?? 0);
    }
    this.entries.push(entry);
    return entry;
  }

  #addAttributed(entry, exposure) {
    const lines = exposure.text.split('\n');
    const expected = Number.isInteger(exposure.endLine) ? exposure.endLine - exposure.startLine + 1 : lines.length;
    if (lines.length !== expected) throw new Error(`RANGE_TEXT_MISMATCH: ${exposure.file}:${exposure.startLine}-${exposure.endLine ?? '?'} has ${lines.length} lines, expected ${expected}`);
    const strip = exposure.numbered ? NUMBERED[exposure.numbered] : null;
    entry.attributed = true; entry.startLine = exposure.startLine; entry.endLine = exposure.startLine + lines.length - 1;
    lines.forEach((line, index) => {
      const bytes = lineBytes(line), key = `${entry.domain}\0${exposure.file}\0${exposure.startLine + index}`, identity = strip ? line.replace(strip, '') : line;
      entry.grossLines += 1; entry.grossBytes += bytes;
      if (this.identity.get(key) !== identity) { this.identity.set(key, identity); entry.uniqueLines += 1; entry.uniqueBytes += bytes; }
    });
    entry.grossBytes += exposure.metadataBytes ?? 0;
  }

  summary() {
    const result = {};
    for (const domain of DOMAINS) {
      result[domain] = {};
      for (const category of CATEGORIES) result[domain][category] = summarize(this.entries.filter((entry) => entry.domain === domain && entry.category === category), category === 'repository_source');
      if (domain === 'agent_visible') result[domain].totalMeasurablePayload = totalPayload(Object.values(result[domain]));
    }
    return result;
  }
}

function summarize(entries, source) {
  const known = entries.filter((entry) => entry.confidence !== 'unknown');
  const unknownReasons = entries.filter((entry) => entry.confidence === 'unknown').map((entry) => entry.unknownReason);
  const grossBytes = known.length ? known.reduce((sum, entry) => sum + entry.grossBytes, 0) : (unknownReasons.length ? null : 0);
  let confidence = 'exact';
  if (unknownReasons.length && !known.length) confidence = 'unknown';
  else if (unknownReasons.length || known.some((entry) => entry.confidence === 'partial')) confidence = 'partial';
  const base = { events: entries.length, grossBytes, confidence, unknownReasons };
  if (!source) return base;
  const attributed = known.filter((entry) => entry.attributed), unattributed = known.filter((entry) => !entry.attributed);
  const attributedGrossLines = attributed.reduce((sum, entry) => sum + entry.grossLines, 0), uniqueLines = attributed.reduce((sum, entry) => sum + entry.uniqueLines, 0), uniqueBytes = attributed.reduce((sum, entry) => sum + entry.uniqueBytes, 0);
  const unattributedBytes = unattributed.reduce((sum, entry) => sum + entry.grossBytes, 0);
  if (unattributed.length && confidence === 'exact') confidence = 'partial';
  const duplicateBytes = unattributed.length || grossBytes === null ? null : grossBytes - uniqueBytes;
  return { ...base, confidence, grossLines: unattributed.length ? null : attributedGrossLines, attributedGrossLines, uniqueLines, duplicateLines: attributedGrossLines - uniqueLines, uniqueBytes, duplicateBytes, duplicationRatio: duplicateBytes === null || !grossBytes ? null : duplicateBytes / grossBytes, unattributedBytes, unattributedEvents: unattributed.length };
}

function totalPayload(categories) {
  const known = categories.filter((category) => category.grossBytes !== null);
  const anyUnknown = categories.some((category) => category.unknownReasons.length > 0), anyPartial = categories.some((category) => category.confidence === 'partial');
  if (!known.length && anyUnknown) return unknownMeasurement('bytes', 'no measurable agent-visible payload', []);
  const value = known.reduce((sum, category) => sum + category.grossBytes, 0);
  return anyUnknown || anyPartial ? partial(value, 'bytes') : exact(value, 'bytes');
}

export { measurement };
