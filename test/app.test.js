// End-to-end tests: boot the server against a throwaway DB and drive the real
// UI with Puppeteer. Run with `npm test`.

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

let server;
let browser;
let page;

// Poll the API until the server answers or we give up.
async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/prototypes`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start in time');
}

const sessionCount = () => page.$$eval('#sessionList .session', (els) => els.length);

// Open the session dialog, fill it, submit, and wait for the list to grow.
async function logPlaytest({ date, players, rating, tag, notes }) {
  await page.click('#addSessionBtn');
  await page.waitForSelector('#sessionDialog[open]');
  await page.$eval('#sessionForm input[name="played_on"]', (el, v) => { el.value = v; }, date);
  await page.type('#sessionForm input[name="player_count"]', String(players));
  if (rating) await page.select('#sessionForm select[name="rating"]', String(rating));
  if (tag) await page.select('#sessionForm select[name="tag"]', tag);
  if (notes) await page.type('#sessionForm textarea[name="notes"]', notes);

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
  // Auto-accept the confirm() dialogs used by delete actions.
  page.on('dialog', (d) => d.accept());
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

test('starts on an empty state', async () => {
  await page.waitForSelector('#detailContent');
  const text = await page.$eval('#detailContent', (el) => el.textContent);
  assert.match(text, /No prototypes yet/);
  const count = await page.$eval('#stats .stat .num', (el) => el.textContent);
  assert.strictEqual(count, '0');
});

test('creates a prototype', async () => {
  await page.click('#newPrototypeBtn');
  await page.waitForSelector('#prototypeDialog[open]');
  await page.type('#prototypeForm input[name="name"]', 'Wildflower');
  await page.select('#prototypeForm select[name="status"]', 'testing');
  await page.type('#prototypeForm input[name="player_min"]', '1');
  await page.type('#prototypeForm input[name="player_max"]', '4');
  await page.click('#prototypeForm button[type="submit"]');

  await page.waitForFunction(() => {
    const h2 = document.querySelector('#detailContent h2');
    return h2 && h2.textContent === 'Wildflower';
  });
  const protoCount = await page.$eval('#stats .stat .num', (el) => el.textContent);
  assert.strictEqual(protoCount, '1');
});

test('logs playtests and averages ratings by tag', async () => {
  await logPlaytest({ date: '2026-06-20', players: 4, rating: 5, tag: 'fun' });
  await logPlaytest({ date: '2026-06-30', players: 3, rating: 3, tag: 'balance' });
  await logPlaytest({ date: '2026-07-08', players: 2, rating: 4, tag: 'fun' });

  assert.strictEqual(await sessionCount(), 3);
  const head = await page.$eval('.sessions-head h3', (el) => el.textContent);
  assert.match(head, /Playtests \(3\)/);

  // Tag card: fun = (5+4)/2 = 4.5, balance = 3.0
  const tags = await page.$$eval('.tagbars .tagbar', (els) => els.map((e) => ({
    label: e.querySelector('.tagbar-label').textContent,
    count: e.querySelector('.tagbar-count').textContent.trim(),
  })));
  const fun = tags.find((t) => t.label === 'Fun');
  const balance = tags.find((t) => t.label === 'Balance');
  assert.match(fun.count, /4\.5/);
  assert.match(balance.count, /3\.0/);
});

test('filters playtests by tag', async () => {
  await page.select('#sessionTag', 'fun');
  await page.waitForFunction(() => document.querySelectorAll('#sessionList .session').length === 2);
  assert.strictEqual(await sessionCount(), 2);

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
  await page.type('#prototypeForm input[name="name"]', 'Wildflower v2');
  await page.click('#prototypeForm button[type="submit"]');

  await page.waitForFunction(() => {
    const h2 = document.querySelector('#detailContent h2');
    return h2 && h2.textContent === 'Wildflower v2';
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
  const csv = await fetch(`${BASE}/api/prototypes/1/export`);
  assert.strictEqual(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const body = await csv.text();
  assert.match(body, /^played_on,player_count,duration_min,rating,tag,notes/);

  const json = await fetch(`${BASE}/api/prototypes/1/export?format=json`);
  assert.strictEqual(json.status, 200);
  const data = await json.json();
  assert.strictEqual(data.name, 'Wildflower v2');
  assert.ok(Array.isArray(data.sessions));
});

test('deletes the prototype and returns to the empty state', async () => {
  await page.click('#deleteProtoBtn');
  await page.waitForFunction(() =>
    /No prototypes yet/.test(document.querySelector('#detailContent').textContent));
  const disabled = await page.$eval('#prototypeSelect', (el) => el.disabled);
  assert.strictEqual(disabled, true);
});
