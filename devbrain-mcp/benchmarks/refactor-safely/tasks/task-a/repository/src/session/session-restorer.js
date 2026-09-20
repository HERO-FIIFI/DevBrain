// Restores a session from a persisted cookie value; expired or tampered cookies yield an anonymous session.
export class SessionRestorer {
  constructor(authService) {
    this.authService = authService;
  }

  restore(cookies) {
    const token = cookies.session;
    if (!token) return { authenticated: false, reason: 'no_session' };
    const result = this.authService.validateToken(token);
    return result.valid ? { authenticated: true, subject: result.subject } : { authenticated: false, reason: result.reason };
  }
}
