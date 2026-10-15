// `inspect-token <token>` prints a one-line verdict. Exposed as a function so tests run it without a child process.
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { AuthService } from '../auth/auth-service.js';
import { validateTokenFormat } from '../auth/token-format.js';

export function inspectToken(argv, authService) {
  const [token] = argv;
  if (!token) return { exitCode: 2, output: 'usage: inspect-token <token>' };
  if (!validateTokenFormat(token)) return { exitCode: 1, output: 'format: invalid' };
  const result = authService.validateToken(token);
  return result.valid ? { exitCode: 0, output: `valid subject=${result.subject}` } : { exitCode: 1, output: `invalid reason=${result.reason}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { exitCode, output } = inspectToken(process.argv.slice(2), new AuthService({ secret: process.env.TOKEN_SECRET ?? 'development-secret' }));
  process.stdout.write(`${output}\n`);
  process.exitCode = exitCode;
}
