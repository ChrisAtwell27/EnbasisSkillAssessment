// Playtest Tracker API and static frontend.

const path = require('path');
const express = require('express');
const db = require('./db');
const { hashPassword, verifyPassword, randomToken } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_DAYS = 7;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Domain constants
const STATUSES = ['concept', 'prototyping', 'testing', 'shelved', 'published'];
const TAGS = ['fun', 'balance', 'rules', 'components', 'pacing'];

// Helpers
// Thrown by validators; caught by the error handler and returned as JSON.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wrap a handler so any thrown error lands in the central error handler.
const h = (fn) => (req, res, next) => {
  try {
    fn(req, res, next);
  } catch (err) {
    next(err);
  }
};

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

// Serialize rows to CSV, quoting cells that contain commas, quotes, or newlines.
function toCsv(rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

// Fetch a prototype owned by the user, or throw 404 (hides others' ids).
function getPrototypeOr404(id, userId) {
  const proto = db.prepare('SELECT * FROM prototypes WHERE id = ? AND user_id = ?').get(id, userId);
  if (!proto) throw new HttpError(404, 'Prototype not found.');
  return proto;
}

// Fetch a session that belongs to one of the user's prototypes, or throw 404.
function getSessionOr404(id, userId) {
  const row = db.prepare(`
    SELECT s.* FROM sessions s
    JOIN prototypes p ON p.id = s.prototype_id
    WHERE s.id = ? AND p.user_id = ?
  `).get(id, userId);
  if (!row) throw new HttpError(404, 'Session not found.');
  return row;
}

// Auth helpers

// Parse the Cookie header into a plain object.
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token, maxAgeSec) {
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`);
}

// Create a login session and set its cookie.
function startSession(res, userId) {
  const token = randomToken();
  db.prepare(
    `INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`
  ).run(token, userId);
  setSessionCookie(res, token, SESSION_DAYS * 86400);
}

function validateCredentials(body) {
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const password = String(body.password || '');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  return { email, password };
}

// Gate: require a valid session cookie; attaches req.userId / req.userEmail.
function requireAuth(req, res, next) {
  const token = parseCookies(req).sid;
  const row = token && db.prepare(`
    SELECT us.user_id, u.email FROM user_sessions us
    JOIN users u ON u.id = us.user_id
    WHERE us.token = ? AND us.expires_at > datetime('now')
  `).get(token);
  if (!row) return next(new HttpError(401, 'Not signed in.'));
  req.userId = row.user_id;
  req.userEmail = row.email;
  next();
}

// Auth routes

app.post('/api/auth/register', h((req, res) => {
  const { email, password } = validateCredentials(req.body);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new HttpError(409, 'An account with that email already exists.');
  }
  const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .run(email, hashPassword(password));
  db.seedSampleData(info.lastInsertRowid); // new accounts start with the sample games
  startSession(res, info.lastInsertRowid);
  res.status(201).json({ email });
}));

app.post('/api/auth/login', h((req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, 'Incorrect email or password.');
  }
  startSession(res, user.id);
  res.json({ email: user.email });
}));

app.post('/api/auth/logout', h((req, res) => {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
}));

app.get('/api/auth/me', requireAuth, h((req, res) => res.json({ email: req.userEmail })));

// Start a password reset. With no mail server, the token is returned directly
// so the flow is usable locally; in production this would be emailed instead.
app.post('/api/auth/forgot', h((req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) return res.json({ message: 'If that account exists, a reset link was created.' });
  const token = randomToken();
  db.prepare(
    `INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))`
  ).run(token, user.id);
  res.json({ token, message: 'Reset created. In production this link would be emailed.' });
}));

app.post('/api/auth/reset', h((req, res) => {
  const token = String(req.body.token || '').trim();
  const password = String(req.body.password || '');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  const row = db.prepare(
    `SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > datetime('now')`
  ).get(token);
  if (!row) throw new HttpError(400, 'This reset link is invalid or has expired.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE token = ?').run(token);
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(row.user_id); // sign out everywhere
  res.json({ message: 'Password updated. You can sign in now.' });
}));

// Everything below requires a signed-in user.
app.use('/api/prototypes', requireAuth);
app.use('/api/sessions', requireAuth);

// Prototype routes

// List the user's prototypes with rolled-up session stats.
app.get('/api/prototypes', h((req, res) => {
  const rows = db.prepare(`
    SELECT p.*,
           COUNT(s.id)            AS session_count,
           ROUND(AVG(s.rating), 1) AS avg_rating,
           MAX(s.played_on)       AS last_played
    FROM prototypes p
    LEFT JOIN sessions s ON s.prototype_id = p.id
    WHERE p.user_id = ?
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all(req.userId);
  res.json(rows);
}));

// Single prototype plus its sessions (newest first).
app.get('/api/prototypes/:id', h((req, res) => {
  const proto = getPrototypeOr404(req.params.id, req.userId);
  proto.sessions = db.prepare(
    'SELECT * FROM sessions WHERE prototype_id = ? ORDER BY played_on DESC, id DESC'
  ).all(proto.id);
  res.json(proto);
}));

// Export a prototype and its playtests as a download (?format=csv|json).
app.get('/api/prototypes/:id/export', h((req, res) => {
  const proto = getPrototypeOr404(req.params.id, req.userId);
  const sessions = db.prepare(
    'SELECT * FROM sessions WHERE prototype_id = ? ORDER BY played_on, id'
  ).all(proto.id);
  const slug = proto.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'prototype';

  if (req.query.format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-playtests.json"`);
    return res.json({ ...proto, sessions });
  }
  const columns = ['played_on', 'player_count', 'duration_min', 'rating', 'tag', 'notes'];
  const rows = [columns, ...sessions.map((s) => columns.map((c) => s[c]))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}-playtests.csv"`);
  res.send(toCsv(rows));
}));

app.post('/api/prototypes', h((req, res) => {
  const data = validatePrototype(req.body);
  const info = db.prepare(`
    INSERT INTO prototypes (user_id, name, status, player_min, player_max, target_playtime, notes)
    VALUES (@user_id, @name, @status, @player_min, @player_max, @target_playtime, @notes)
  `).run({ ...data, user_id: req.userId });
  res.status(201).json(getPrototypeOr404(info.lastInsertRowid, req.userId));
}));

app.put('/api/prototypes/:id', h((req, res) => {
  getPrototypeOr404(req.params.id, req.userId);
  const data = validatePrototype(req.body);
  db.prepare(`
    UPDATE prototypes
    SET name = @name, status = @status, player_min = @player_min,
        player_max = @player_max, target_playtime = @target_playtime, notes = @notes
    WHERE id = @id
  `).run({ ...data, id: Number(req.params.id) });
  res.json(getPrototypeOr404(req.params.id, req.userId));
}));

app.delete('/api/prototypes/:id', h((req, res) => {
  getPrototypeOr404(req.params.id, req.userId);
  db.prepare('DELETE FROM prototypes WHERE id = ?').run(req.params.id);
  res.status(204).end();
}));

// Session routes

app.post('/api/prototypes/:id/sessions', h((req, res) => {
  const proto = getPrototypeOr404(req.params.id, req.userId);
  const data = validateSession(req.body);
  const info = db.prepare(`
    INSERT INTO sessions (prototype_id, played_on, player_count, duration_min, rating, tag, notes)
    VALUES (@prototype_id, @played_on, @player_count, @duration_min, @rating, @tag, @notes)
  `).run({ ...data, prototype_id: proto.id });
  res.status(201).json(db.prepare('SELECT * FROM sessions WHERE id = ?').get(info.lastInsertRowid));
}));

app.put('/api/sessions/:id', h((req, res) => {
  getSessionOr404(req.params.id, req.userId);
  const data = validateSession(req.body);
  db.prepare(`
    UPDATE sessions
    SET played_on = @played_on, player_count = @player_count, duration_min = @duration_min,
        rating = @rating, tag = @tag, notes = @notes
    WHERE id = @id
  `).run({ ...data, id: Number(req.params.id) });
  res.json(db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id));
}));

app.delete('/api/sessions/:id', h((req, res) => {
  getSessionOr404(req.params.id, req.userId);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  res.status(204).end();
}));

// Error handling

// Unknown API route returns JSON 404 (frontend routes fall through to static).
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Central error handler: known HttpErrors keep their status; everything else is 500.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`Playtest Tracker running at http://localhost:${PORT}`);
});
