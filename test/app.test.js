// End-to-end tests: boot the server against a throwaway DB and drive the real
// UI with Puppeteer, including the auth flow. Run with `npm test`.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const puppeteer = require('puppeteer');

const PORT = 3311;
const BASE = `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), `playtest-test-${process.pid}.db`);

const EMAIL = 'dev@example.com';
const PASS_A = 'testpass123';
const PASS_B = 'newpass4567';

let server;
let browser;
let page;
let createdId; // id of the prototype created during the run

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/auth/me`);
      if (r.status === 401 || r.ok) return; // responding
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start in time');
}

const sessionCount = () => page.$$eval('#sessionList .session', (els) => els.length);
const appVisible = () => page.waitForFunction(() => !document.querySelector('#appView').hidden);
const authVisible = () => page.waitForFunction(() => !document.querySelector('#authView').hidden);

// Clear an input, then type into it.
async function typeInto(selector, value) {
  await page.$eval(selector, (el) => { el.value = ''; });
  await page.type(selector, value);
}

async function submitAuth(mode, { email, password } = {}) {
  await page.click(`.auth-links a[data-mode="${mode}"]`);
  if (email !== undefined) await typeInto('#authForm input[name="email"]', email);
  if (password !== undefined) await typeInto('#authForm input[name="password"]', password);
  await page.click('#authSubmit');
}

// Open the session dialog, fill it, submit, and wait for the list to grow.
async function logPlaytest({ date, players, rating, tag }) {
  await page.click('#addSessionBtn');
  await page.waitForSelector('#sessionDialog[open]');
  await page.$eval('#sessionForm input[name="played_on"]', (el, v) => { el.value = v; }, date);
  await page.type('#sessionForm input[name="player_count"]', String(players));
  if (rating) await page.select('#sessionForm select[name="rating"]', String(rating));
  if (tag) await page.select('#sessionForm select[name="tag"]', tag);

  const before = await sessionCount();
  await page.click('#sessionForm button[type="submit"]');
  await page.waitForFunction(
    (n) => document.querySelectorAll('#sessionList .session').length === n,
    {}, before + 1
  );
}

before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_FILE },
    stdio: 'ignore',
  });
  await waitForServer();

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage();
  page.on('dialog', (d) => d.accept()); // auto-accept confirm() on deletes
  await page.goto(BASE, { waitUntil: 'networkidle0' });
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
  await new Promise((r) => setTimeout(r, 300));
  for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) {
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
});

test('shows the login screen when signed out', async () => {
  await authVisible();
  const appHidden = await page.$eval('#appView', (el) => el.hidden);
  assert.strictEqual(appHidden, true);
  // The reset-token field must be hidden outside the reset flow.
  const tokenDisplay = await page.$eval('#tokenField', (el) => getComputedStyle(el).display);
  assert.strictEqual(tokenDisplay, 'none');
});

test('registers a new account', async () => {
  await submitAuth('register', { email: EMAIL, password: PASS_A });
  await appVisible();
  const shown = await page.$eval('#userEmail', (el) => el.textContent);
  assert.strictEqual(shown, EMAIL);
  // The auth overlay must be fully gone, not just flagged hidden.
  const authDisplay = await page.$eval('#authView', (el) => getComputedStyle(el).display);
  assert.strictEqual(authDisplay, 'none');
  // New accounts start with the three sample prototypes.
  const protoCount = await page.$eval('#stats .stat .num', (el) => el.textContent);
  assert.strictEqual(protoCount, '3');
  const options = await page.$$eval('#prototypeSelect option', (els) => els.map((o) => o.textContent));
  assert.ok(options.some((o) => o.includes('Wildflower')));
});

test('creates a prototype', async () => {
  await page.click('#newPrototypeBtn');
  await page.waitForSelector('#prototypeDialog[open]');
  await page.type('#prototypeForm input[name="name"]', 'Playtest Sandbox');
  await page.click('#prototypeForm button[type="submit"]');

  await page.waitForFunction(() => {
    const h2 = document.querySelector('#detailContent h2');
    return h2 && h2.textContent === 'Playtest Sandbox';
  });
  const protoCount = await page.$eval('#stats .stat .num', (el) => el.textContent);
  assert.strictEqual(protoCount, '4');
  createdId = await page.$eval('#prototypeSelect', (el) => el.value);
});

test('logs playtests and averages ratings by tag', async () => {
  await logPlaytest({ date: '2026-06-20', players: 4, rating: 5, tag: 'fun' });
  await logPlaytest({ date: '2026-06-30', players: 3, rating: 3, tag: 'balance' });
  await logPlaytest({ date: '2026-07-08', players: 2, rating: 4, tag: 'fun' });

  assert.strictEqual(await sessionCount(), 3);
  const tags = await page.$$eval('.tagbars .tagbar', (els) => els.map((e) => ({
    label: e.querySelector('.tagbar-label').textContent,
    count: e.querySelector('.tagbar-count').textContent.trim(),
  })));
  assert.match(tags.find((t) => t.label === 'Fun').count, /4\.5/);
  assert.match(tags.find((t) => t.label === 'Balance').count, /3\.0/);
});

test('filters playtests by tag', async () => {
  await page.select('#sessionTag', 'fun');
  await page.waitForFunction(() => document.querySelectorAll('#sessionList .session').length === 2);
  await page.select('#sessionTag', 'all');
  await page.waitForFunction(() => document.querySelectorAll('#sessionList .session').length === 3);
});

test('sorts playtests by rating', async () => {
  await page.select('#sessionSort', 'rating-desc');
  await page.waitForFunction(() => {
    const s = document.querySelector('#sessionList .session .stars');
    return s && (s.textContent.match(/★/g) || []).length === 5;
  });
  await page.select('#sessionSort', 'rating-asc');
  await page.waitForFunction(() => {
    const s = document.querySelector('#sessionList .session .stars');
    return s && (s.textContent.match(/★/g) || []).length === 3;
  });
  await page.select('#sessionSort', 'date-desc');
});

test('edits the prototype name', async () => {
  await page.click('#editProtoBtn');
  await page.waitForSelector('#prototypeDialog[open]');
  await page.$eval('#prototypeForm input[name="name"]', (el) => { el.value = ''; });
  await page.type('#prototypeForm input[name="name"]', 'Playtest Sandbox v2');
  await page.click('#prototypeForm button[type="submit"]');
  await page.waitForFunction(() => {
    const h2 = document.querySelector('#detailContent h2');
    return h2 && h2.textContent === 'Playtest Sandbox v2';
  });
});

test('deletes a playtest', async () => {
  const before = await sessionCount();
  await page.click('#sessionList .session [data-del-session]');
  await page.waitForFunction((n) =>
    document.querySelectorAll('#sessionList .session').length === n, {}, before - 1);
  assert.strictEqual(await sessionCount(), before - 1);
});

test('exports the prototype as CSV and JSON', async () => {
  // Run in-page so the session cookie is sent.
  const csv = await page.evaluate(async (id) => {
    const r = await fetch(`/api/prototypes/${id}/export`);
    return { status: r.status, ct: r.headers.get('content-type'), body: await r.text() };
  }, createdId);
  assert.strictEqual(csv.status, 200);
  assert.match(csv.ct, /text\/csv/);
  assert.match(csv.body, /^played_on,player_count,duration_min,rating,tag,notes/);

  const json = await page.evaluate(async (id) => {
    const r = await fetch(`/api/prototypes/${id}/export?format=json`);
    return r.json();
  }, createdId);
  assert.strictEqual(json.name, 'Playtest Sandbox v2');
  assert.ok(Array.isArray(json.sessions));
});

test('signs out and back in, keeping data', async () => {
  await page.click('#logoutBtn');
  await authVisible();

  await submitAuth('login', { email: EMAIL, password: PASS_A });
  await appVisible();
  // Three sample prototypes plus the one created during the run.
  await page.waitForFunction(() => document.querySelector('#prototypeSelect').options.length === 4);
  const protoCount = await page.$eval('#stats .stat .num', (el) => el.textContent);
  assert.strictEqual(protoCount, '4');
});

test('resets the password via the forgot flow', async () => {
  await page.click('#logoutBtn');
  await authVisible();

  // Request a reset; the dev flow fills the token into the reset form.
  await submitAuth('forgot', { email: EMAIL });
  await page.waitForFunction(() =>
    !document.querySelector('#tokenField').hidden
    && document.querySelector('#authForm').token.value.length > 0);

  await typeInto('#authForm input[name="password"]', PASS_B);
  await page.click('#authSubmit');
  await page.waitForFunction(() => !document.querySelector('#authNote').hidden);

  // Old password now fails, new one works.
  await typeInto('#authForm input[name="email"]', EMAIL);
  await typeInto('#authForm input[name="password"]', PASS_A);
  await page.click('#authSubmit');
  await page.waitForFunction(() => !document.querySelector('#authError').hidden);

  await typeInto('#authForm input[name="password"]', PASS_B);
  await page.click('#authSubmit');
  await appVisible();
});

test('deletes the created prototype, leaving the samples', async () => {
  await page.select('#prototypeSelect', String(createdId));
  await page.waitForFunction((id) =>
    document.querySelector('#prototypeSelect').value === String(id), {}, createdId);
  await page.click('#deleteProtoBtn');
  await page.waitForFunction(() =>
    document.querySelector('#stats .stat .num').textContent === '3');
  const disabled = await page.$eval('#prototypeSelect', (el) => el.disabled);
  assert.strictEqual(disabled, false);
});
