// Password hashing and token helpers, shared by the server and the seed script.
// Uses Node's built-in crypto (scrypt) so there is no extra dependency.

const crypto = require('crypto');

// Store passwords as "salt:hash" (both hex).
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// Constant-time comparison against a stored "salt:hash".
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Random opaque token for session cookies and password resets.
function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { hashPassword, verifyPassword, randomToken };
