// Unit tests for password hashing and token helpers.

const { test } = require('node:test');
const assert = require('node:assert');
const { hashPassword, verifyPassword, randomToken } = require('../auth');

test('hashPassword produces a salted hash that verifies', () => {
  const stored = hashPassword('correct horse battery');
  assert.match(stored, /^[0-9a-f]+:[0-9a-f]+$/);
  assert.strictEqual(verifyPassword('correct horse battery', stored), true);
  assert.strictEqual(verifyPassword('wrong password', stored), false);
});

test('hashPassword salts differ for the same password', () => {
  assert.notStrictEqual(hashPassword('same'), hashPassword('same'));
});

test('verifyPassword handles malformed stored values', () => {
  assert.strictEqual(verifyPassword('x', ''), false);
  assert.strictEqual(verifyPassword('x', 'no-colon'), false);
  assert.strictEqual(verifyPassword('x', undefined), false);
});

test('randomToken is unique and 64 hex chars', () => {
  const a = randomToken();
  const b = randomToken();
  assert.notStrictEqual(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});
