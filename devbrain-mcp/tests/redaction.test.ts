import { describe, expect, it } from 'vitest';
import { redact, redactString } from '../src/lib/redaction.js';

describe('redaction', () => {
  it.each([
    'api_key=supersecretvalue', 'Authorization: Bearer abc.def.ghi',
    'postgres://alice:hunter2@localhost/db', 'token=abcdef123456',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
  ])('removes a secret from %s', (input) => expect(redactString(input)).not.toMatch(/supersecretvalue|abc\.def\.ghi|hunter2|abcdef123456|eyJhbGci/));

  it('redacts nested output', () => expect(redact({ nested: ['password=secret123'] })).toEqual({ nested: ['password=[REDACTED]'] }));
});
