# token-guard

Dependency-free token utilities for a small service.

- `src/auth/auth-service.js` — `AuthService` issues and validates HMAC-signed tokens.
- `src/auth/token-format.js` — `validateTokenFormat` performs a structural check only.
- `src/http/auth-middleware.js` — bearer-token authorization for request-like objects.
- `src/session/session-restorer.js` — restores a session from a persisted cookie.
- `src/cli/inspect-token.js` — `inspect-token <token>` prints a one-line verdict.

## Scripts

```sh
npm test            # full regression (node:test)
npm run test:targeted
npm run lint        # syntax check every module
npm run build       # load every module to catch broken imports
```
