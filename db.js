// SQLite setup, schema, and optional seed.
// Run `node db.js --seed` (or `npm run seed`) to load sample data.

const path = require('path');
const Database = require('better-sqlite3');
const { hashPassword } = require('./auth');

// Demo account the sample data belongs to (documented in the README).
const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demo1234';

// DB_FILE lets tests point at a throwaway database; defaults to playtest.db.
const dbPath = process.env.DB_FILE || path.join(__dirname, 'playtest.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS prototypes (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'concept',
    player_min      INTEGER,
    player_max      INTEGER,
    target_playtime INTEGER,               -- target length in minutes
    notes           TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    prototype_id INTEGER NOT NULL REFERENCES prototypes(id) ON DELETE CASCADE,
    played_on    TEXT    NOT NULL,         -- YYYY-MM-DD
    player_count INTEGER NOT NULL,
    duration_min INTEGER,                  -- actual length in minutes
    rating       INTEGER,                  -- 1..5
    tag          TEXT,                     -- fun | balance | rules | components | pacing
    notes        TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Login sessions (cookie tokens) and one-time password-reset tokens.
  CREATE TABLE IF NOT EXISTS user_sessions (
    token      TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    token      TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT    NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_prototype ON sessions(prototype_id);
  CREATE INDEX IF NOT EXISTS idx_prototypes_user ON prototypes(user_id);
`);

// Migration: add prototypes.user_id to databases created before auth existed.
const protoCols = db.prepare('PRAGMA table_info(prototypes)').all();
if (!protoCols.some((c) => c.name === 'user_id')) {
  db.exec('ALTER TABLE prototypes ADD COLUMN user_id INTEGER REFERENCES users(id)');
}

// Sample prototypes given to every new account (and the demo account).
const SAMPLE_PROTOTYPES = [
  {
    name: 'Wildflower', status: 'testing', player_min: 1, player_max: 4, target_playtime: 40,
    notes: 'Bee-themed engine builder. Draft flowers, attract bees, chain pollination combos.',
    sessions: [
      { played_on: '2026-06-20', player_count: 4, duration_min: 52, rating: 4, tag: 'pacing', notes: 'Engine took too long to spin up. First two rounds felt slow.' },
      { played_on: '2026-06-30', player_count: 3, duration_min: 44, rating: 5, tag: 'fun', notes: 'Sweat Bee chains clicked. Table gasped at a six-card combo.' },
      { played_on: '2026-07-08', player_count: 2, duration_min: 38, rating: 3, tag: 'balance', notes: 'Bumblebee card is a must-buy every game. Needs a nerf.' },
      { played_on: '2026-07-13', player_count: 4, duration_min: 41, rating: 4, tag: 'fun', notes: 'Added an end-game hive bonus. Much tighter finish.' },
    ],
  },
  {
    name: 'Dirt Ball', status: 'prototyping', player_min: 2, player_max: 2, target_playtime: 30,
    notes: 'Chess-like positioning soccer. Move players across the pitch to pass and shoot.',
    sessions: [
      { played_on: '2026-07-03', player_count: 2, duration_min: 35, rating: 3, tag: 'rules', notes: 'Offside-style rule confused testers. Cut it for now.' },
      { played_on: '2026-07-11', player_count: 2, duration_min: 28, rating: 4, tag: 'balance', notes: 'Badger piece too strong on defense. Limit its move range.' },
    ],
  },
  {
    name: 'Blunder the Sea', status: 'concept', player_min: 1, player_max: 4, target_playtime: 30,
    notes: 'Co-op bullet hell on a chess grid. Dodge cannon patterns and coordinate moves.',
    sessions: [],
  },
];

// Insert the sample prototypes (and their playtests) for one user.
const seedSampleData = db.transaction((userId) => {
  const insProto = db.prepare(`
    INSERT INTO prototypes (user_id, name, status, player_min, player_max, target_playtime, notes)
    VALUES (@user_id, @name, @status, @player_min, @player_max, @target_playtime, @notes)
  `);
  const insSession = db.prepare(`
    INSERT INTO sessions (prototype_id, played_on, player_count, duration_min, rating, tag, notes)
    VALUES (@prototype_id, @played_on, @player_count, @duration_min, @rating, @tag, @notes)
  `);
  for (const { sessions, ...proto } of SAMPLE_PROTOTYPES) {
    const prototypeId = insProto.run({ ...proto, user_id: userId }).lastInsertRowid;
    for (const s of sessions) insSession.run({ ...s, prototype_id: prototypeId });
  }
});

// Reset the database to the demo account (run with `node db.js --seed`).
function seed() {
  db.exec('DELETE FROM sessions; DELETE FROM prototypes; DELETE FROM users;');
  const userId = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .run(DEMO_EMAIL, hashPassword(DEMO_PASSWORD)).lastInsertRowid;
  seedSampleData(userId);
  console.log(`Seeded demo account (${DEMO_EMAIL} / ${DEMO_PASSWORD}) with sample data.`);
}

if (require.main === module && process.argv.includes('--seed')) {
  seed();
}

module.exports = db;
module.exports.seedSampleData = seedSampleData;
