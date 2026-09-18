export const HARD_CONTEXT_LIMITS = {
  maxFiles: 20,
  maxLines: 3_000,
  maxBytes: 200_000,
  maxSearchResults: 200,
  maxReferences: 200,
  maxDiffBytes: 150_000,
} as const;

export function boundedInteger(value: number | undefined, fallback: number, ceiling: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1 || result > ceiling) throw new Error(`INVALID_${name.toUpperCase()}`);
  return result;
}
