// Unit tests for the request validators. Fast, no server or browser.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  validatePrototype, validateSession, validateCredentials,
} = require('../validators');

test('validatePrototype trims and coerces valid input', () => {
  const r = validatePrototype({
    name: '  Wildflower  ', status: 'testing',
    player_min: '1', player_max: '4', target_playtime: '40', notes: '  hi  ',
  });
  assert.deepStrictEqual(r, {
    name: 'Wildflower', status: 'testing',
    player_min: 1, player_max: 4, target_playtime: 40, notes: 'hi',
  });
});

test('validatePrototype defaults status to concept and nulls optionals', () => {
  const r = validatePrototype({ name: 'X' });
  assert.strictEqual(r.status, 'concept');
  assert.strictEqual(r.player_min, null);
  assert.strictEqual(r.target_playtime, null);
  assert.strictEqual(r.notes, null);
});

test('validatePrototype requires a name', () => {
  assert.throws(() => validatePrototype({ name: '   ' }), /Name is required/);
});

test('validatePrototype rejects an unknown status', () => {
  assert.throws(() => validatePrototype({ name: 'X', status: 'nope' }), /Status must be/);
});

test('validatePrototype rejects max players below min', () => {
  assert.throws(() => validatePrototype({ name: 'X', player_min: 5, player_max: 2 }), /Max players/);
});

test('validatePrototype rejects non-integer players', () => {
  assert.throws(() => validatePrototype({ name: 'X', player_min: 'two' }), /whole number/);
});

test('validateSession requires date and player count', () => {
  assert.throws(() => validateSession({ player_count: 2 }), /date is required/i);
  assert.throws(() => validateSession({ played_on: '2026-01-01' }), /Player count is required/);
});

test('validateSession enforces rating range and known tags', () => {
  assert.throws(() => validateSession({ played_on: '2026-01-01', player_count: 2, rating: 9 }), /at most 5/);
  assert.throws(() => validateSession({ played_on: '2026-01-01', player_count: 2, tag: 'weird' }), /Tag must be/);
});

test('validateSession leaves optional fields null', () => {
  const r = validateSession({ played_on: '2026-01-01', player_count: '3' });
  assert.strictEqual(r.player_count, 3);
  assert.strictEqual(r.rating, null);
  assert.strictEqual(r.tag, null);
  assert.strictEqual(r.duration_min, null);
});

test('validateCredentials normalizes email and checks password length', () => {
  const r = validateCredentials({ email: '  ME@Example.COM ', password: 'abcd1234' });
  assert.strictEqual(r.email, 'me@example.com');
  assert.throws(() => validateCredentials({ email: 'not-an-email', password: 'abcd1234' }), /valid email/);
  assert.throws(() => validateCredentials({ email: 'a@b.co', password: 'short' }), /at least 8/);
});
