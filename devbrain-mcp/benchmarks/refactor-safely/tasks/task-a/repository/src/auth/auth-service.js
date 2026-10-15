import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { validateTokenFormat } from './token-format.js';

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = (segment) => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));

/** Issues and validates HMAC-SHA256 signed tokens of the form `header.payload.signature`. */
export class AuthService {
  /** @param {{ secret: string, now?: () => number }} options `now` returns whole seconds since the epoch */
  constructor({ secret, now = () => Math.floor(Date.now() / 1000) }) {
    if (!secret) throw new Error('secret is required');
    this.secret = secret;
    this.now = now;
  }

  sign(header, payload) {
    return createHmac('sha256', this.secret).update(`${header}.${payload}`).digest('base64url');
  }

  issueToken(subject, ttlSeconds) {
    const header = encode({ alg: 'HS256' });
    const payload = encode({ sub: subject, exp: this.now() + ttlSeconds });
    return `${header}.${payload}.${this.sign(header, payload)}`;
  }

  /**
   * Checks structure, signature, and expiry in that order.
   * @returns {{ valid: true, subject: string } | { valid: false, reason: 'malformed' | 'invalid_signature' | 'expired' }}
   */
  validateToken(token) {
    if (!validateTokenFormat(token)) return { valid: false, reason: 'malformed' };
    const [header, payload, signature] = token.split('.');
    const expected = this.sign(header, payload);
    if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return { valid: false, reason: 'invalid_signature' };
    let claims;
    try { claims = decode(payload); } catch { return { valid: false, reason: 'malformed' }; }
    if (typeof claims.exp !== 'number' || claims.exp <= this.now()) return { valid: false, reason: 'expired' };
    return { valid: true, subject: claims.sub };
  }
}
