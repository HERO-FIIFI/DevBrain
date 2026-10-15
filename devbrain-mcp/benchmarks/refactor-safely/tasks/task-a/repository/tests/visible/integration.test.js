import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthService } from '../../src/auth/auth-service.js';
import { validateTokenFormat } from '../../src/auth/token-format.js';
import { inspectToken } from '../../src/cli/inspect-token.js';
import { createAuthMiddleware } from '../../src/http/auth-middleware.js';
import { SessionRestorer } from '../../src/session/session-restorer.js';

const auth = new AuthService({ secret: 'test-secret', now: () => 1_000_000 });
const good = auth.issueToken('alice', 60);
const expired = auth.issueToken('bob', -5);
const tampered = `${good.split('.')[0]}.${good.split('.')[1]}.AAAA`;

test('middleware authorizes bearer tokens', () => {
  const authorize = createAuthMiddleware(auth);
  assert.deepEqual(authorize({ headers: { authorization: `Bearer ${good}` } }), { status: 200, subject: 'alice' });
  assert.deepEqual(authorize({ headers: { authorization: `Bearer ${expired}` } }), { status: 401, error: 'expired' });
  assert.deepEqual(authorize({ headers: { authorization: `Bearer ${tampered}` } }), { status: 401, error: 'invalid_signature' });
  assert.deepEqual(authorize({ headers: {} }), { status: 401, error: 'missing_token' });
});

test('session restorer distinguishes missing, invalid, and valid cookies', () => {
  const restorer = new SessionRestorer(auth);
  assert.deepEqual(restorer.restore({ session: good }), { authenticated: true, subject: 'alice' });
  assert.deepEqual(restorer.restore({ session: tampered }), { authenticated: false, reason: 'invalid_signature' });
  assert.deepEqual(restorer.restore({}), { authenticated: false, reason: 'no_session' });
});

test('inspect-token CLI reports verdicts', () => {
  assert.deepEqual(inspectToken([good], auth), { exitCode: 0, output: 'valid subject=alice' });
  assert.deepEqual(inspectToken([expired], auth), { exitCode: 1, output: 'invalid reason=expired' });
  assert.deepEqual(inspectToken(['nope'], auth), { exitCode: 1, output: 'format: invalid' });
  assert.deepEqual(inspectToken([], auth), { exitCode: 2, output: 'usage: inspect-token <token>' });
});

test('validateTokenFormat is structural only', () => {
  assert.equal(validateTokenFormat(good), true);
  assert.equal(validateTokenFormat('x.y.z'), true);
  assert.equal(validateTokenFormat('a.b'), false);
  assert.equal(validateTokenFormat(''), false);
});
