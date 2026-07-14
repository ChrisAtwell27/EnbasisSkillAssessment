// Request-body validation. Each validator returns a clean object or throws an
// HttpError(400). Kept dependency-free so it can be unit-tested in isolation.

const { HttpError } = require('./errors');

const STATUSES = ['concept', 'prototyping', 'testing', 'shelved', 'published'];
const TAGS = ['fun', 'balance', 'rules', 'components', 'pacing'];

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

// Coerce a value to an integer within [min, max], or throw. Allows null when optional.
function intField(value, label, { min, max, optional } = {}) {
  if (isBlank(value)) {
    if (optional) return null;
    throw new HttpError(400, `${label} is required.`);
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw new HttpError(400, `${label} must be a whole number.`);
  if (min !== undefined && n < min) throw new HttpError(400, `${label} must be at least ${min}.`);
  if (max !== undefined && n > max) throw new HttpError(400, `${label} must be at most ${max}.`);
  return n;
}

function validatePrototype(body) {
  if (isBlank(body.name)) throw new HttpError(400, 'Name is required.');
  const status = isBlank(body.status) ? 'concept' : String(body.status);
  if (!STATUSES.includes(status)) {
    throw new HttpError(400, `Status must be one of: ${STATUSES.join(', ')}.`);
  }
  const player_min = intField(body.player_min, 'Min players', { min: 1, optional: true });
  const player_max = intField(body.player_max, 'Max players', { min: 1, optional: true });
  if (player_min !== null && player_max !== null && player_max < player_min) {
    throw new HttpError(400, 'Max players cannot be less than min players.');
  }
  return {
    name: String(body.name).trim(),
    status,
    player_min,
    player_max,
    target_playtime: intField(body.target_playtime, 'Target playtime', { min: 1, optional: true }),
    notes: isBlank(body.notes) ? null : String(body.notes).trim(),
  };
}

function validateSession(body) {
  if (isBlank(body.played_on)) throw new HttpError(400, 'Play date is required.');
  let tag = null;
  if (!isBlank(body.tag)) {
    tag = String(body.tag);
    if (!TAGS.includes(tag)) throw new HttpError(400, `Tag must be one of: ${TAGS.join(', ')}.`);
  }
  return {
    played_on: String(body.played_on).trim(),
    player_count: intField(body.player_count, 'Player count', { min: 1 }),
    duration_min: intField(body.duration_min, 'Duration', { min: 1, optional: true }),
    rating: intField(body.rating, 'Rating', { min: 1, max: 5, optional: true }),
    tag,
    notes: isBlank(body.notes) ? null : String(body.notes).trim(),
  };
}

function validateCredentials(body) {
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const password = String(body.password || '');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  return { email, password };
}

module.exports = {
  STATUSES, TAGS, isBlank, intField,
  validatePrototype, validateSession, validateCredentials,
};
