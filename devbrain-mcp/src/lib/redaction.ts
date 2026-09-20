const SENSITIVE = [
  /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
  /\b((?:api[_-]?key|token|secret|password|passwd|pwd)\s*=\s*)[^\s,;]+/gi,
  /\b((?:api[_-]?key|token|secret|password|passwd|pwd)\s*:\s*)(?:"[^"]+"|'[^']+'|[A-Za-z0-9._~+/-]{8,})/gi,
  /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:)[^@\s/]+(?=@)/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
] as const;

export function redactString(value: string): string {
  return SENSITIVE.reduce((text, pattern) => text.replace(pattern, (_match, prefix?: string) => `${prefix ?? ''}[REDACTED]`), value);
}

export function redact<T>(value: T): T {
  if (typeof value === 'string') return redactString(value) as T;
  if (Array.isArray(value)) return value.map(redact) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redact(child)])) as T;
  }
  return value;
}

export function safeError(error: unknown): string {
  return redactString(error instanceof Error ? error.message : String(error));
}
