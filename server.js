// Playtest Tracker API and static frontend.

const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Fetch a prototype or throw 404.
function getPrototypeOr404(id) {
  const proto = db.prepare('SELECT * FROM prototypes WHERE id = ?').get(id);
  if (!proto) throw new HttpError(404, 'Prototype not found.');
  return proto;
}

// Prototype routes

// List all prototypes with rolled-up session stats.
app.get('/api/prototypes', h((req, res) => {
  const rows = db.prepare(`
    SELECT p.*,
           COUNT(s.id)            AS session_count,
           ROUND(AVG(s.rating), 1) AS avg_rating,
           MAX(s.played_on)       AS last_played
    FROM prototypes p
    LEFT JOIN sessions s ON s.prototype_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all();
  res.json(rows);
}));

// Single prototype plus its sessions (newest first).
app.get('/api/prototypes/:id', h((req, res) => {
  const proto = getPrototypeOr404(req.params.id);
  proto.sessions = db.prepare(
    'SELECT * FROM sessions WHERE prototype_id = ? ORDER BY played_on DESC, id DESC'
  ).all(proto.id);
  res.json(proto);
}));

// Export a prototype and its playtests as a download (?format=csv|json).
app.get('/api/prototypes/:id/export', h((req, res) => {
  const proto = getPrototypeOr404(req.params.id);
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
    INSERT INTO prototypes (name, status, player_min, player_max, target_playtime, notes)
    VALUES (@name, @status, @player_min, @player_max, @target_playtime, @notes)
  `).run(data);
  res.status(201).json(getPrototypeOr404(info.lastInsertRowid));
}));

app.put('/api/prototypes/:id', h((req, res) => {
  getPrototypeOr404(req.params.id);
  const data = validatePrototype(req.body);
  db.prepare(`
    UPDATE prototypes
    SET name = @name, status = @status, player_min = @player_min,
        player_max = @player_max, target_playtime = @target_playtime, notes = @notes
    WHERE id = @id
  `).run({ ...data, id: Number(req.params.id) });
  res.json(getPrototypeOr404(req.params.id));
}));

app.delete('/api/prototypes/:id', h((req, res) => {
  getPrototypeOr404(req.params.id);
  db.prepare('DELETE FROM prototypes WHERE id = ?').run(req.params.id);
  res.status(204).end();
}));

// Session routes

app.post('/api/prototypes/:id/sessions', h((req, res) => {
  const proto = getPrototypeOr404(req.params.id);
  const data = validateSession(req.body);
  const info = db.prepare(`
    INSERT INTO sessions (prototype_id, played_on, player_count, duration_min, rating, tag, notes)
    VALUES (@prototype_id, @played_on, @player_count, @duration_min, @rating, @tag, @notes)
  `).run({ ...data, prototype_id: proto.id });
  res.status(201).json(db.prepare('SELECT * FROM sessions WHERE id = ?').get(info.lastInsertRowid));
}));

app.put('/api/sessions/:id', h((req, res) => {
  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!existing) throw new HttpError(404, 'Session not found.');
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
  const info = db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  if (info.changes === 0) throw new HttpError(404, 'Session not found.');
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
