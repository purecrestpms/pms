import crypto from 'node:crypto';

const KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, KEYLEN).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hash] = parts;
  const known = Buffer.from(hash, 'hex');
  const test = crypto.scryptSync(String(password), salt, KEYLEN);
  if (known.length !== test.length) return false;
  return crypto.timingSafeEqual(known, test);
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}
