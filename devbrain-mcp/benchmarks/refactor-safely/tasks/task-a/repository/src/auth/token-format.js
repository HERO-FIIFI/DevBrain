// Structural check only: three non-empty base64url segments. Does not verify signatures or expiry.
const SEGMENT = /^[A-Za-z0-9_-]+$/;

export function validateTokenFormat(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => SEGMENT.test(part));
}
