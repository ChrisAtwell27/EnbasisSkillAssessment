// Playtest Tracker frontend (vanilla, no build step).

const STATUS_LABELS = {
  concept: 'Concept', prototyping: 'Prototyping', testing: 'Testing',
  shelved: 'Shelved', published: 'Published',
};

const TAG_ORDER = ['fun', 'balance', 'rules', 'components', 'pacing'];

let prototypes = [];
let selectedId = null;
let currentDetail = null;      // last-loaded prototype (with sessions)
let sessionTag = 'all';        // playtest filter
let sessionSort = 'date-desc'; // playtest sort

// API helper: returns parsed JSON, throws Error(message) on failure.
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A dropped/expired session on an app call bounces back to the login view.
    if (res.status === 401 && !url.startsWith('/api/auth')) showAuthView();
    throw new Error(data.error || `Request failed (${res.status}).`);
  }
  return data;
}

// Small DOM utilities
const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

function stars(rating) {
  return rating ? '★'.repeat(rating) + '☆'.repeat(5 - rating) : '-';
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function players(p) {
  if (!p.player_min && !p.player_max) return '';
  if (p.player_min && p.player_max) return `${p.player_min}-${p.player_max}p`;
  return `${p.player_min || p.player_max}p`;
}

// Load list, then refresh stats, picker, and detail
async function loadPrototypes() {
  try {
    prototypes = await api('GET', '/api/prototypes');
    renderStats();
    populateSelect();
  } catch (err) {
    $('#detailContent').innerHTML = `<p class="muted">Could not load: ${esc(err.message)}</p>`;
  }
}

function renderStats() {
  const totalSessions = prototypes.reduce((s, p) => s + p.session_count, 0);
  const rated = prototypes.filter((p) => p.avg_rating != null);
  const avg = rated.length
    ? (rated.reduce((s, p) => s + p.avg_rating, 0) / rated.length).toFixed(1)
    : '-';
  const active = prototypes.filter((p) => !['shelved', 'published'].includes(p.status)).length;
  $('#stats').innerHTML = `
    <div class="stat"><div class="num">${prototypes.length}</div><div class="label">Prototypes</div></div>
    <div class="stat"><div class="num">${active}</div><div class="label">In progress</div></div>
    <div class="stat"><div class="num">${totalSessions}</div><div class="label">Playtests logged</div></div>
    <div class="stat"><div class="num">${avg}</div><div class="label">Avg rating</div></div>
  `;
}

// Build the prototype picker; keep the current selection or default to the first.
function populateSelect() {
  const select = $('#prototypeSelect');
  if (!prototypes.length) {
    select.innerHTML = '';
    select.disabled = true;
    $('#protoActions').hidden = true;
    selectedId = null;
    currentDetail = null;
    $('#detailContent').innerHTML = '<p class="muted">No prototypes yet. Create one to begin.</p>';
    return;
  }
  select.disabled = false;
  if (!prototypes.some((p) => p.id === selectedId)) selectedId = prototypes[0].id;
  select.innerHTML = prototypes.map((p) =>
    `<option value="${p.id}">${esc(p.name)} (${STATUS_LABELS[p.status]})</option>`
  ).join('');
  select.value = String(selectedId);
  $('#protoActions').hidden = false;
  loadDetail(selectedId);
}

async function loadDetail(id) {
  try {
    renderDetail(await api('GET', `/api/prototypes/${id}`));
  } catch (err) {
    toast(err.message, true);
  }
}

function renderDetail(p) {
  // Reset filter/sort when a different prototype is opened.
  if (!currentDetail || currentDetail.id !== p.id) {
    sessionTag = 'all';
    sessionSort = 'date-desc';
  }
  currentDetail = p;

  const specs = [
    players(p),
    p.target_playtime ? `~${p.target_playtime} min` : '',
  ].filter(Boolean).join(' / ');
  const presentTags = TAG_ORDER.filter((t) => p.sessions.some((s) => s.tag === t));

  $('#detailContent').innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${esc(p.name)}</h2>
        <div class="detail-sub">
          <span class="badge ${p.status}">${STATUS_LABELS[p.status]}</span>
          ${specs ? `<span>${specs}</span>` : ''}
        </div>
      </div>
      <div class="export">
        <button class="btn btn-small" data-export="csv">Export CSV</button>
        <button class="btn btn-small" data-export="json">Export JSON</button>
      </div>
    </div>
    ${p.notes ? `<div class="detail-notes">${esc(p.notes)}</div>` : ''}
    <div class="detail-body">
      <div class="sessions-col">
        <div class="sessions-head">
          <h3>Playtests (${p.sessions.length})</h3>
          <div class="toolbar">
            <select id="sessionTag" aria-label="Filter by tag">
              <option value="all">All tags</option>
              ${presentTags.map((t) => `<option value="${t}">${cap(t)}</option>`).join('')}
            </select>
            <select id="sessionSort" aria-label="Sort playtests">
              <option value="date-desc">Newest first</option>
              <option value="date-asc">Oldest first</option>
              <option value="rating-desc">Highest rated</option>
              <option value="rating-asc">Lowest rated</option>
            </select>
            <button class="btn btn-small btn-primary" id="addSessionBtn">Log playtest</button>
          </div>
        </div>
        <div id="sessionList"></div>
      </div>
      <aside class="side-card">
        <h4>Avg rating by tag</h4>
        ${renderTagBreakdown(p.sessions)}
      </aside>
    </div>
  `;

  const tagSel = $('#sessionTag');
  const sortSel = $('#sessionSort');
  tagSel.value = sessionTag;
  sortSel.value = sessionSort;
  tagSel.addEventListener('change', () => { sessionTag = tagSel.value; renderSessions(); });
  sortSel.addEventListener('change', () => { sessionSort = sortSel.value; renderSessions(); });
  $('#addSessionBtn').addEventListener('click', () => openSessionDialog(p.id));
  $('#detailContent').querySelectorAll('[data-export]').forEach((el) =>
    el.addEventListener('click', () => exportPrototype(p.id, el.dataset.export)));

  renderSessions();
}

// Average rating per focus tag, as bars out of 5 (rendered in the side card).
function renderTagBreakdown(sessions) {
  const stat = {}; // tag -> { sum, rated, count }
  sessions.forEach((s) => {
    if (!s.tag) return;
    const t = (stat[s.tag] ||= { sum: 0, rated: 0, count: 0 });
    t.count++;
    if (s.rating != null) { t.sum += s.rating; t.rated++; }
  });
  const present = TAG_ORDER.filter((t) => stat[t]);
  if (!present.length) return '<p class="muted">No tagged feedback yet.</p>';
  return `
    <div class="tagbars">
      ${present.map((t) => {
        const { sum, rated, count } = stat[t];
        const avg = rated ? sum / rated : 0;
        const label = rated ? avg.toFixed(1) : '-';
        return `
        <div class="tagbar">
          <div class="tagbar-top">
            <span class="tagbar-label">${cap(t)}</span>
            <span class="tagbar-count">${label}<span class="tagbar-sub"> (${count})</span></span>
          </div>
          <span class="tagbar-track"><span class="tagbar-fill" style="width:${(avg / 5) * 100}%"></span></span>
        </div>`;
      }).join('')}
    </div>`;
}

// Order playtests by the current sort; unrated entries sort last for rating sorts.
function sessionComparator(a, b) {
  if (sessionSort.startsWith('rating')) {
    if (a.rating == null && b.rating == null) return b.played_on.localeCompare(a.played_on);
    if (a.rating == null) return 1;
    if (b.rating == null) return -1;
    return sessionSort === 'rating-asc' ? a.rating - b.rating : b.rating - a.rating;
  }
  const cmp = a.played_on.localeCompare(b.played_on);
  return sessionSort === 'date-asc' ? (cmp || a.id - b.id) : (-cmp || b.id - a.id);
}

function sessionCard(s) {
  return `
    <div class="session">
      <div class="session-top">
        <div class="session-meta">
          <strong>${esc(s.played_on)}</strong>
          <span>${s.player_count}p</span>
          ${s.duration_min ? `<span>${s.duration_min} min</span>` : ''}
          <span class="stars">${stars(s.rating)}</span>
          ${s.tag ? `<span class="tag">${esc(s.tag)}</span>` : ''}
        </div>
        <div class="session-actions">
          <button class="btn btn-small" data-edit-session="${s.id}">Edit</button>
          <button class="btn btn-small btn-danger" data-del-session="${s.id}">Delete</button>
        </div>
      </div>
      ${s.notes ? `<p class="session-notes">${esc(s.notes)}</p>` : ''}
    </div>`;
}

// Render the playtest list applying the active filter + sort.
function renderSessions() {
  const p = currentDetail;
  if (!p) return;
  let items = p.sessions.slice();
  if (sessionTag !== 'all') items = items.filter((s) => s.tag === sessionTag);
  items.sort(sessionComparator);

  const list = $('#sessionList');
  if (!items.length) {
    list.innerHTML = `<p class="muted">${
      p.sessions.length ? 'No playtests match this filter.' : 'No playtests logged yet.'
    }</p>`;
    return;
  }
  list.innerHTML = items.map(sessionCard).join('');
  list.querySelectorAll('[data-edit-session]').forEach((el) =>
    el.addEventListener('click', () =>
      openSessionDialog(p.id, p.sessions.find((x) => x.id === Number(el.dataset.editSession)))));
  list.querySelectorAll('[data-del-session]').forEach((el) =>
    el.addEventListener('click', () => deleteSession(Number(el.dataset.delSession))));
}

// Trigger a file download of the prototype's playtests.
function exportPrototype(id, format) {
  const a = document.createElement('a');
  a.href = `/api/prototypes/${id}/export?format=${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Prototype dialog
let editingProtoId = null;

function openPrototypeDialog(proto = null) {
  editingProtoId = proto ? proto.id : null;
  const form = $('#prototypeForm');
  form.reset();
  $('#prototypeError').hidden = true;
  $('#prototypeDialogTitle').textContent = proto ? 'Edit prototype' : 'New prototype';
  if (proto) {
    form.name.value = proto.name;
    form.status.value = proto.status;
    form.player_min.value = proto.player_min ?? '';
    form.player_max.value = proto.player_max ?? '';
    form.target_playtime.value = proto.target_playtime ?? '';
    form.notes.value = proto.notes ?? '';
  }
  $('#prototypeDialog').showModal();
}

async function submitPrototype(e) {
  e.preventDefault();
  const form = e.target;
  const body = {
    name: form.name.value,
    status: form.status.value,
    player_min: form.player_min.value,
    player_max: form.player_max.value,
    target_playtime: form.target_playtime.value,
    notes: form.notes.value,
  };
  try {
    if (editingProtoId) {
      await api('PUT', `/api/prototypes/${editingProtoId}`, body);
      toast('Prototype updated.');
    } else {
      const created = await api('POST', '/api/prototypes', body);
      selectedId = created.id;
      toast('Prototype created.');
    }
    $('#prototypeDialog').close();
    await loadPrototypes();
  } catch (err) {
    const el = $('#prototypeError');
    el.textContent = err.message;
    el.hidden = false;
  }
}

async function deletePrototype(p) {
  if (!confirm(`Delete "${p.name}" and all its playtests? This cannot be undone.`)) return;
  try {
    await api('DELETE', `/api/prototypes/${p.id}`);
    if (selectedId === p.id) selectedId = null;
    toast('Prototype deleted.');
    await loadPrototypes();
  } catch (err) {
    toast(err.message, true);
  }
}

// Session dialog
let sessionProtoId = null;
let editingSessionId = null;

function openSessionDialog(protoId, session = null) {
  sessionProtoId = protoId;
  editingSessionId = session ? session.id : null;
  const form = $('#sessionForm');
  form.reset();
  $('#sessionError').hidden = true;
  $('#sessionDialogTitle').textContent = session ? 'Edit playtest' : 'Log playtest';
  if (session) {
    form.played_on.value = session.played_on;
    form.player_count.value = session.player_count;
    form.duration_min.value = session.duration_min ?? '';
    form.rating.value = session.rating ?? '';
    form.tag.value = session.tag ?? '';
    form.notes.value = session.notes ?? '';
  }
  $('#sessionDialog').showModal();
}

async function submitSession(e) {
  e.preventDefault();
  const form = e.target;
  const body = {
    played_on: form.played_on.value,
    player_count: form.player_count.value,
    duration_min: form.duration_min.value,
    rating: form.rating.value,
    tag: form.tag.value,
    notes: form.notes.value,
  };
  try {
    if (editingSessionId) {
      await api('PUT', `/api/sessions/${editingSessionId}`, body);
      toast('Playtest updated.');
    } else {
      await api('POST', `/api/prototypes/${sessionProtoId}/sessions`, body);
      toast('Playtest logged.');
    }
    $('#sessionDialog').close();
    await loadPrototypes();
  } catch (err) {
    const el = $('#sessionError');
    el.textContent = err.message;
    el.hidden = false;
  }
}

async function deleteSession(id) {
  if (!confirm('Delete this playtest entry?')) return;
  try {
    await api('DELETE', `/api/sessions/${id}`);
    toast('Playtest deleted.');
    await loadPrototypes();
  } catch (err) {
    toast(err.message, true);
  }
}

// Authentication

const authError = (msg) => { const e = $('#authError'); e.textContent = msg; e.hidden = false; };
const authNote = (msg) => { const e = $('#authNote'); e.textContent = msg; e.hidden = false; };

const AUTH_MODES = {
  login: {
    title: 'Sign in to your workshop.', submit: 'Sign in', password: true, token: false,
    action: async (f) => enterApp(await api('POST', '/api/auth/login', { email: f.email.value, password: f.password.value })),
  },
  register: {
    title: 'Create your account.', submit: 'Create account', password: true, token: false,
    action: async (f) => enterApp(await api('POST', '/api/auth/register', { email: f.email.value, password: f.password.value })),
  },
  forgot: {
    title: 'Reset your password.', submit: 'Send reset', password: false, token: false,
    action: async (f) => {
      const res = await api('POST', '/api/auth/forgot', { email: f.email.value });
      if (res.token) {
        setAuthMode('reset');
        f.token.value = res.token;
        authNote('Reset ready — token filled in below. Set a new password.');
      } else {
        authNote(res.message);
      }
    },
  },
  reset: {
    title: 'Choose a new password.', submit: 'Update password', password: true, token: true,
    action: async (f) => {
      const res = await api('POST', '/api/auth/reset', { token: f.token.value, password: f.password.value });
      setAuthMode('login');
      authNote(res.message);
    },
  },
};
let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  const cfg = AUTH_MODES[mode];
  $('#authSubtitle').textContent = cfg.title;
  $('#authSubmit').textContent = cfg.submit;
  $('#passwordField').hidden = !cfg.password;
  $('#tokenField').hidden = !cfg.token;
  $('#authError').hidden = true;
  $('#authNote').hidden = true;
}

function showAuthView() {
  $('#appView').hidden = true;
  $('#authView').hidden = false;
  $('#authForm').reset();
  setAuthMode('login');
}

async function enterApp(user) {
  $('#userEmail').textContent = user.email;
  $('#authView').hidden = true;
  $('#appView').hidden = false;
  selectedId = null;
  currentDetail = null;
  await loadPrototypes();
}

async function logout() {
  try { await api('POST', '/api/auth/logout'); } catch { /* ignore */ }
  prototypes = [];
  selectedId = null;
  currentDetail = null;
  showAuthView();
}

async function boot() {
  try {
    await enterApp(await api('GET', '/api/auth/me'));
  } catch {
    showAuthView();
  }
}

// Wire up
$('#newPrototypeBtn').addEventListener('click', () => openPrototypeDialog());
$('#prototypeSelect').addEventListener('change', (e) => {
  selectedId = Number(e.target.value);
  loadDetail(selectedId);
});
$('#editProtoBtn').addEventListener('click', () => {
  const p = prototypes.find((x) => x.id === selectedId);
  if (p) openPrototypeDialog(p);
});
$('#deleteProtoBtn').addEventListener('click', () => {
  const p = prototypes.find((x) => x.id === selectedId);
  if (p) deletePrototype(p);
});
$('#logoutBtn').addEventListener('click', logout);
$('#prototypeForm').addEventListener('submit', submitPrototype);
$('#sessionForm').addEventListener('submit', submitSession);
document.querySelectorAll('[data-close]').forEach((btn) =>
  btn.addEventListener('click', () => btn.closest('dialog').close()));

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#authError').hidden = true;
  try {
    await AUTH_MODES[authMode].action(e.target);
  } catch (err) {
    authError(err.message);
  }
});
document.querySelectorAll('.auth-links a').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const f = $('#authForm');
    f.password.value = '';
    f.token.value = '';
    setAuthMode(a.dataset.mode);
  }));

boot();
