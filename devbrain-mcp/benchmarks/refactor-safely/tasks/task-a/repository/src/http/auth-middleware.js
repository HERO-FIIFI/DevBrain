// Framework-free middleware: reads the bearer token from a request-like object and returns an authorization decision.
const BEARER = 'Bearer ';

export function createAuthMiddleware(authService) {
  return function authorize(request) {
    const header = request.headers?.authorization ?? '';
    if (!header.startsWith(BEARER)) return { status: 401, error: 'missing_token' };
    const result = authService.validateToken(header.slice(BEARER.length));
    if (!result.valid) return { status: 401, error: result.reason };
    return { status: 200, subject: result.subject };
  };
}
