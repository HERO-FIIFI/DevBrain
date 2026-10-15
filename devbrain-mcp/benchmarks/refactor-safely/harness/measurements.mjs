// Measurement records for benchmark evidence. `unknown` is `null` plus a reason; it is never a zero.
export const CONFIDENCE = Object.freeze(['exact', 'reported', 'partial', 'unknown']);

/** @returns {{ value: number | null, unit: string, confidence: string, sources: object[], unknownReason?: string }} */
export function measurement({ value, unit, confidence, sources = [], unknownReason }) {
  if (!CONFIDENCE.includes(confidence)) throw new Error(`INVALID_CONFIDENCE: ${confidence}`);
  if (typeof unit !== 'string' || unit.length === 0) throw new Error('MEASUREMENT_REQUIRES_UNIT');
  if (confidence === 'unknown') {
    if (value !== null && value !== undefined) throw new Error('UNKNOWN_VALUE_MUST_BE_NULL');
    if (typeof unknownReason !== 'string' || unknownReason.length === 0) throw new Error('UNKNOWN_REQUIRES_REASON');
    return { value: null, unit, confidence, sources: [...sources], unknownReason };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('KNOWN_VALUE_MUST_BE_NUMBER');
  return { value, unit, confidence, sources: [...sources] };
}

export const unknownMeasurement = (unit, reason, sources = []) => measurement({ value: null, unit, confidence: 'unknown', sources, unknownReason: reason });

export const exact = (value, unit, sources = []) => measurement({ value, unit, confidence: 'exact', sources });
export const reported = (value, unit, sources = []) => measurement({ value, unit, confidence: 'reported', sources });
export const partial = (value, unit, sources = []) => measurement({ value, unit, confidence: 'partial', sources });
