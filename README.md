# Playtest Tracker

A full-stack app for board game designers to track prototypes and log playtest
sessions. Node.js + Express backend, SQLite database, vanilla HTML/CSS/JS
frontend served by Express.

## Required dependencies

- Node.js 18 or newer (developed on Node 22)
- npm (bundled with Node)

npm packages, installed by the command below:

- `express`
- `better-sqlite3`
- `puppeteer` (dev, for end-to-end tests)

## Environment setup

No environment variables are required. `PORT` is optional and defaults to `3000`:

```bash
PORT=4000 npm start
```

## Install

```bash
npm install
```

## Database setup / seed

The SQLite file (`playtest.db`) is created automatically on first run. To load
sample prototypes and playtests:

```bash
npm run seed
```

Re-running `npm run seed` resets the database to the sample data.

## Start

```bash
npm start
```

Then open http://localhost:3000

For development with auto-restart on file changes:

```bash
npm run dev
```

## Test

End-to-end tests use Puppeteer (installed with `npm install`) to drive the real
UI in a headless browser: create a prototype, log playtests, filter/sort, check
the tag averages, edit, delete, and export.

```bash
npm test
```

The suite boots the server against a throwaway database (via the `DB_FILE`
environment variable), so it never touches `playtest.db`.

## Demo credentials

None. The app has no authentication.

## API reference

| Method | Route                          | Purpose                                |
|--------|--------------------------------|----------------------------------------|
| GET    | `/api/prototypes`              | List prototypes with rolled-up stats   |
| POST   | `/api/prototypes`              | Create a prototype                     |
| GET    | `/api/prototypes/:id`          | One prototype and its sessions         |
| PUT    | `/api/prototypes/:id`          | Update a prototype                     |
| DELETE | `/api/prototypes/:id`          | Delete a prototype (cascades sessions) |
| POST   | `/api/prototypes/:id/sessions` | Log a playtest for a prototype         |
| PUT    | `/api/sessions/:id`            | Update a playtest                      |
| DELETE | `/api/sessions/:id`            | Delete a playtest                      |

## Project layout

```
server.js        Express app: routes, validation, error handling
db.js            SQLite connection, schema, and seed data
public/
  index.html     Markup and dialogs
  styles.css     Styling
  app.js         Frontend logic
```
