// Hidden evaluator for Task A: rename AuthService.validateToken -> verifyToken. Behavioral invariants dominate;
// implementation shape is never prescribed.
import { InstrumentedReader, changedFiles, check, expectCases, finishEvaluation, harnessCheck, loaded, runHarnessVerification, scopeChecks } from './common.mjs';

export async function evaluateTaskA(root, manifest) {
  const reader = new InstrumentedReader(root);
  const changed = await changedFiles(root);
  const changedPaths = changed.map((entry) => entry.path);
  const verification = await runHarnessVerification(root, manifest);
  const checks = [];

  let AuthService = null, validateTokenFormat = null, createAuthMiddleware = null, SessionRestorer = null, inspectToken = null;
  checks.push(await check('transformation.new_method_defined', 'transformation', true, async () => {
    ({ AuthService } = await reader.load('src/auth/auth-service.js'));
    return { pass: typeof AuthService?.prototype?.verifyToken === 'function', evidence: { verifyToken: typeof AuthService?.prototype?.verifyToken } };
  }));
  checks.push(await check('transformation.old_method_absent', 'transformation', true, () => ({ pass: loaded(AuthService, 'AuthService').prototype.validateToken === undefined, evidence: { validateToken: typeof AuthService?.prototype?.validateToken } })));

  const auth = () => new (loaded(AuthService, 'AuthService'))({ secret: 'evaluator-secret', now: () => 1_000_000 });
  const fixtures = () => { const service = auth(); const good = service.issueToken('alice', 60), expired = service.issueToken('bob', -5), [header, payload] = good.split('.'); return { service, good, expired, tampered: `${header}.${payload}.AAAA`, foreign: new (loaded(AuthService, 'AuthService'))({ secret: 'other', now: () => 1_000_000 }).issueToken('alice', 60) }; };

  checks.push(await check('behavior.token_verification', 'behavior', true, () => {
    const { service, good, expired, tampered, foreign } = fixtures();
    return expectCases([
      { name: 'valid token', actual: () => service.verifyToken(good), expected: { valid: true, subject: 'alice' } },
      { name: 'expired token', actual: () => service.verifyToken(expired), expected: { valid: false, reason: 'expired' } },
      { name: 'token expiring exactly now', actual: () => service.verifyToken(service.issueToken('carol', 0)), expected: { valid: false, reason: 'expired' } },
      { name: 'tampered signature', actual: () => service.verifyToken(tampered), expected: { valid: false, reason: 'invalid_signature' } },
      { name: 'foreign secret', actual: () => service.verifyToken(foreign), expected: { valid: false, reason: 'invalid_signature' } },
      { name: 'malformed string', actual: () => service.verifyToken('not-a-token'), expected: { valid: false, reason: 'malformed' } },
      { name: 'non-string', actual: () => service.verifyToken(42), expected: { valid: false, reason: 'malformed' } },
      { name: 'empty', actual: () => service.verifyToken(''), expected: { valid: false, reason: 'malformed' } },
    ]);
  }));
  checks.push(await check('behavior.auth_middleware', 'behavior', true, async () => {
    ({ createAuthMiddleware } = await reader.load('src/http/auth-middleware.js'));
    const { service, good, expired, tampered } = fixtures(), authorize = loaded(createAuthMiddleware, 'createAuthMiddleware')(service);
    return expectCases([
      { name: 'bearer valid', actual: () => authorize({ headers: { authorization: `Bearer ${good}` } }), expected: { status: 200, subject: 'alice' } },
      { name: 'bearer expired', actual: () => authorize({ headers: { authorization: `Bearer ${expired}` } }), expected: { status: 401, error: 'expired' } },
      { name: 'bearer tampered', actual: () => authorize({ headers: { authorization: `Bearer ${tampered}` } }), expected: { status: 401, error: 'invalid_signature' } },
      { name: 'missing header', actual: () => authorize({ headers: {} }), expected: { status: 401, error: 'missing_token' } },
      { name: 'wrong scheme', actual: () => authorize({ headers: { authorization: `Basic ${good}` } }), expected: { status: 401, error: 'missing_token' } },
    ]);
  }));
  checks.push(await check('behavior.session_restorer', 'behavior', true, async () => {
    ({ SessionRestorer } = await reader.load('src/session/session-restorer.js'));
    const { service, good, tampered, expired } = fixtures(), restorer = new (loaded(SessionRestorer, 'SessionRestorer'))(service);
    return expectCases([
      { name: 'valid cookie', actual: () => restorer.restore({ session: good }), expected: { authenticated: true, subject: 'alice' } },
      { name: 'tampered cookie', actual: () => restorer.restore({ session: tampered }), expected: { authenticated: false, reason: 'invalid_signature' } },
      { name: 'expired cookie', actual: () => restorer.restore({ session: expired }), expected: { authenticated: false, reason: 'expired' } },
      { name: 'no cookie', actual: () => restorer.restore({}), expected: { authenticated: false, reason: 'no_session' } },
    ]);
  }));
  checks.push(await check('behavior.cli_inspector', 'behavior', true, async () => {
    ({ inspectToken } = await reader.load('src/cli/inspect-token.js'));
    const { service, good, expired } = fixtures();
    loaded(inspectToken, 'inspectToken');
    return expectCases([
      { name: 'valid', actual: () => inspectToken([good], service), expected: { exitCode: 0, output: 'valid subject=alice' } },
      { name: 'expired', actual: () => inspectToken([expired], service), expected: { exitCode: 1, output: 'invalid reason=expired' } },
      { name: 'bad format', actual: () => inspectToken(['nope'], service), expected: { exitCode: 1, output: 'format: invalid' } },
      { name: 'usage', actual: () => inspectToken([], service), expected: { exitCode: 2, output: 'usage: inspect-token <token>' } },
    ]);
  }));
  checks.push(await check('behavior.format_helper_unchanged', 'behavior', true, async () => {
    const module = await reader.load('src/auth/token-format.js');
    validateTokenFormat = module.validateTokenFormat;
    if (typeof validateTokenFormat !== 'function') return { pass: false, evidence: { reason: 'validateTokenFormat export missing', exports: Object.keys(module) } };
    if (changedPaths.includes('src/auth/token-format.js')) return { pass: false, evidence: { reason: 'src/auth/token-format.js was modified' } };
    const { good } = fixtures();
    return expectCases([
      { name: 'well-formed', actual: () => validateTokenFormat(good), expected: true },
      { name: 'three segments', actual: () => validateTokenFormat('x.y.z'), expected: true },
      { name: 'two segments', actual: () => validateTokenFormat('a.b'), expected: false },
      { name: 'empty', actual: () => validateTokenFormat(''), expected: false },
      { name: 'non-string', actual: () => validateTokenFormat(null), expected: false },
    ]);
  }));
  checks.push(...await scopeChecks(root, manifest, changed, reader));
  checks.push(await harnessCheck(verification));
  return finishEvaluation({ taskId: 'task-a', root, manifest, reader, checks, changed, verification });
}
