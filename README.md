# Playtest Tracker

A full-stack app for board game designers to track prototypes and log playtest sessions. Node.js + Express backend, SQLite database, vanilla HTML/CSS/JS frontend served by Express. Each account has its own prototypes, behind a simple email/password login (register, sign in, and a password-reset flow).

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

The SQLite file (`playtest.db`) is created automatically on first run. To load sample prototypes and playtests:

```bash
npm run seed
```

Re-running `npm run seed` resets the database to the sample data.

## Start

```bash
npm start
```

Then open http://localhost:3000 and sign in with the demo account below, or create a new one.

For development with auto-restart on file changes:

```bash
npm run dev
```

## Test

Two layers:

- **Unit tests** (`test:unit`) — the request validators and password hashing, in isolation. Fast, no server or browser.
- **End-to-end tests** (`test:e2e`) — Puppeteer drives the real UI in a headless browser: register, create a prototype, log playtests, filter/sort, check the tag averages, edit, delete, export, sign out/in, and reset a password.

```bash
npm test        # run everything
npm run test:unit
npm run test:e2e
```

The e2e suite boots the server against a throwaway database (via the `DB_FILE` environment variable), so it never touches `playtest.db`.

## Demo credentials

After `npm run seed`, a demo account owns the sample games:

- Email: `demo@example.com`
- Password: `demo1234`

You can also create your own account from the login screen. Every new account starts with its own copy of the sample games, and sees only its own prototypes.

## Authentication notes

- Passwords are hashed with scrypt (Node's built-in `crypto`); login state is a random session token stored in an HttpOnly, SameSite=Lax cookie.
- Auth endpoints are rate-limited (30 requests / 15 min / IP) to bound brute-force attempts.
- Expired login sessions and used/expired reset tokens are pruned on startup and hourly.

### Known simplifications

Deliberate trade-offs for a local, time-boxed build:

- **Password reset shows the token in the browser.** No mail server runs locally, so the reset flow surfaces the token directly instead of emailing a link.
- **Rate limiting is in-memory.** It is per-process and resets on restart; a real deployment would use a shared store (e.g. Redis).
- **No CSRF token.** State-changing requests rely on the SameSite=Lax cookie; a production app would add CSRF tokens and serve over HTTPS with `Secure`.
- **No email verification** on registration.

## API reference

The `/api/prototypes` and `/api/sessions` routes require a signed-in session cookie; requests without one return `401`.

| Method | Route                          | Purpose                                |
|--------|--------------------------------|----------------------------------------|
| POST   | `/api/auth/register`           | Create an account and sign in          |
| POST   | `/api/auth/login`              | Sign in                                |
| POST   | `/api/auth/logout`             | Sign out                               |
| GET    | `/api/auth/me`                 | Current signed-in user                 |
| POST   | `/api/auth/forgot`             | Start a password reset (returns token) |
| POST   | `/api/auth/reset`              | Set a new password with a reset token  |
| GET    | `/api/prototypes`              | List your prototypes with stats        |
| POST   | `/api/prototypes`              | Create a prototype                     |
| GET    | `/api/prototypes/:id`          | One prototype and its sessions         |
| PUT    | `/api/prototypes/:id`          | Update a prototype                     |
| DELETE | `/api/prototypes/:id`          | Delete a prototype (cascades sessions) |
| POST   | `/api/prototypes/:id/sessions` | Log a playtest for a prototype         |
| PUT    | `/api/sessions/:id`            | Update a playtest                      |
| DELETE | `/api/sessions/:id`            | Delete a playtest                      |

## Project layout

```
server.js            Express app: routes, auth, rate limiting, error handling
db.js                SQLite connection, schema, and seed data
validators.js        Request-body validation
errors.js            Shared HttpError type
auth.js              Password hashing and token helpers
public/
  index.html         Markup and dialogs
  styles.css         Styling
  app.js             Frontend logic
test/
  validators.test.js Unit tests (validators)
  auth.test.js       Unit tests (hashing)
  app.test.js        End-to-end tests (Puppeteer)
```
