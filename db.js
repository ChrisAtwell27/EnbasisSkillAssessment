// SQLite setup, schema, and optional seed.
// Run `node db.js --seed` (or `npm run seed`) to load sample data.

const path = require('path');
const Database = require('better-sqlite3');

// DB_FILE lets tests point at a throwaway database; defaults to playtest.db.
const dbPath = process.env.DB_FILE || path.join(__dirname, 'playtest.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS prototypes (
    id              INTEGER PRIMARY KEY,
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

  CREATE INDEX IF NOT EXISTS idx_sessions_prototype ON sessions(prototype_id);
`);

// Seed (only when invoked directly with --seed)
function seed() {
  const wipe = db.transaction(() => {
    db.exec('DELETE FROM sessions; DELETE FROM prototypes;');

    const insProto = db.prepare(`
      INSERT INTO prototypes (name, status, player_min, player_max, target_playtime, notes)
      VALUES (@name, @status, @player_min, @player_max, @target_playtime, @notes)
    `);
    const insSession = db.prepare(`
      INSERT INTO sessions (prototype_id, played_on, player_count, duration_min, rating, tag, notes)
      VALUES (@prototype_id, @played_on, @player_count, @duration_min, @rating, @tag, @notes)
    `);

    const p1 = insProto.run({
      name: 'Wildflower', status: 'testing',
      player_min: 1, player_max: 4, target_playtime: 40,
      notes: 'Bee-themed engine builder. Draft flowers, attract bees, chain pollination combos.',
    }).lastInsertRowid;

    const p2 = insProto.run({
      name: 'Dirt Ball', status: 'prototyping',
      player_min: 2, player_max: 2, target_playtime: 30,
      notes: 'Chess-like positioning soccer. Move players across the pitch to pass and shoot.',
    }).lastInsertRowid;

    insProto.run({
      name: 'Blunder the Sea', status: 'concept',
      player_min: 1, player_max: 4, target_playtime: 30,
      notes: 'Co-op bullet hell on a chess grid. Dodge cannon patterns and coordinate moves.',
    });

    insSession.run({ prototype_id: p1, played_on: '2026-06-20', player_count: 4, duration_min: 52, rating: 4, tag: 'pacing', notes: 'Engine took too long to spin up. First two rounds felt slow.' });
    insSession.run({ prototype_id: p1, played_on: '2026-06-30', player_count: 3, duration_min: 44, rating: 5, tag: 'fun', notes: 'Sweat Bee chains clicked. Table gasped at a six-card combo.' });
    insSession.run({ prototype_id: p1, played_on: '2026-07-08', player_count: 2, duration_min: 38, rating: 3, tag: 'balance', notes: 'Bumblebee card is a must-buy every game. Needs a nerf.' });
    insSession.run({ prototype_id: p1, played_on: '2026-07-13', player_count: 4, duration_min: 41, rating: 4, tag: 'fun', notes: 'Added an end-game hive bonus. Much tighter finish.' });
    insSession.run({ prototype_id: p2, played_on: '2026-07-03', player_count: 2, duration_min: 35, rating: 3, tag: 'rules', notes: 'Offside-style rule confused testers. Cut it for now.' });
    insSession.run({ prototype_id: p2, played_on: '2026-07-11', player_count: 2, duration_min: 28, rating: 4, tag: 'balance', notes: 'Badger piece too strong on defense. Limit its move range.' });
  });
  wipe();
  console.log('Seeded sample prototypes and sessions.');
}

if (require.main === module && process.argv.includes('--seed')) {
  seed();
}

module.exports = db;
