import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthService } from '../../src/auth/auth-service.js';

const service = (secret = 'test-secret') => new AuthService({ secret, now: () => 1_000_000 });

test('validateToken accepts a freshly issued token', () => {
  const auth = service();
  assert.deepEqual(auth.validateToken(auth.issueToken('alice', 60)), { valid: true, subject: 'alice' });
});

test('validateToken rejects an expired token', () => {
  const auth = service();
  assert.deepEqual(auth.validateToken(auth.issueToken('alice', -1)), { valid: false, reason: 'expired' });
});

test('validateToken rejects a tampered signature', () => {
  const auth = service();
  const [header, payload] = auth.issueToken('alice', 60).split('.');
  assert.deepEqual(auth.validateToken(`${header}.${payload}.AAAA`), { valid: false, reason: 'invalid_signature' });
});

test('validateToken rejects a token issued with another secret', () => {
  const token = service('other-secret').issueToken('alice', 60);
  assert.deepEqual(service().validateToken(token), { valid: false, reason: 'invalid_signature' });
});

test('validateToken rejects malformed input', () => {
  const auth = service();
  for (const bad of ['', 'not-a-token', 'a.b', 42, null, undefined]) assert.deepEqual(auth.validateToken(bad), { valid: false, reason: 'malformed' });
});

test('constructor requires a secret', () => {
  assert.throws(() => new AuthService({ secret: '' }), /secret is required/);
});
