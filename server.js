'use strict';

// Poker Night — zero-dependency server.
// The laptop opens /display (full-screen on the monitor); a phone opens /control.
// State changes go phone → POST /api/action → server → Server-Sent Events → every screen.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4242;
const CONFIG_PATH = path.join(ROOT, 'config.json');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const LIBRARY_PATH = path.join(DATA_DIR, 'library.json');
const SOUNDS_DIR = path.join(ROOT, 'media', 'sounds');
const AUDIO_EXT = ['.mp3', '.m4a', '.wav', '.ogg', '.aac'];
const MAX_UPLOAD = 15 * 1024 * 1024;
const UNDO_LIMIT = 200;
const AUTH_PATH = path.join(ROOT, 'auth.json');
const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');
const SESSION_DAYS = 30;

const MIME = {
  '.aac': 'audio/aac',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

// ---------- config & state ----------

const EXAMPLE_CONFIG_PATH = path.join(ROOT, 'config.example.json');

// config.json is yours and git-ignored; config.example.json ships the defaults.
// First run copies the example; afterwards any key missing from config.json falls back to it.
function loadConfig(fallback = {}) {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.copyFileSync(EXAMPLE_CONFIG_PATH, CONFIG_PATH);
      console.log('[config] created config.json from config.example.json — edit it to make the game yours');
    }
    const defaults = JSON.parse(fs.readFileSync(EXAMPLE_CONFIG_PATH, 'utf8'));
    const mine = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      ...defaults,
      ...mine,
      blinds: { ...defaults.blinds, ...mine.blinds },
      scenes: { ...defaults.scenes, ...mine.scenes },
    };
  } catch (err) {
    console.error(`[config] could not read config.json — keeping previous config. ${err.message}`);
    return fallback;
  }
}

let config = loadConfig();

function freshState() {
  return {
    players: [],
    blinds: { sb: 20, bb: 50, ...(config.blinds || {}) },
    mode: 'lobby', // 'lobby' (welcome screen) | 'table'
    startedAt: null,
    nextId: 1,
  };
}

function loadState() {
  try {
    return { ...freshState(), ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) };
  } catch {
    return freshState();
  }
}

let state = loadState();
const history = []; // [{ label, snapshot }]

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 150);
}
function saveNow() {
  clearTimeout(saveTimer);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_PATH);
}

// Saved custom buttons live outside the night's state, so "Reset night" keeps them.
function loadLibrary() {
  try {
    return { buttons: [], ...JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8')) };
  } catch {
    return { buttons: [] };
  }
}
let library = loadLibrary();
function saveLibrary() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LIBRARY_PATH, JSON.stringify(library, null, 2));
}

function customSounds() {
  try {
    return fs
      .readdirSync(SOUNDS_DIR)
      .filter((f) => AUDIO_EXT.includes(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .map((f) => ({ label: path.basename(f, path.extname(f)).replace(/[-_]+/g, ' '), sound: `media/sounds/${f}`, file: f }));
  } catch {
    return [];
  }
}

// Bumped whenever a file in public/ changes, so open remotes reload themselves.
let assetVersion = Date.now();

// ---------- login ----------
// auth.json (git-ignored) holds { username, salt, hash } — create or change it with `npm run set-login`.
// Without auth.json the remote is open, as before.

function loadAuth() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  } catch {
    return null;
  }
}
let auth = loadAuth();

function loadSessions() {
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
  } catch {
    return {};
  }
}
let sessions = loadSessions(); // sha256(token) → expiry ms
function saveSessions() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const now = Date.now();
  for (const [k, exp] of Object.entries(sessions)) if (exp < now) delete sessions[k];
  fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions));
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function checkPassword(username, password) {
  if (!auth) return false;
  const key = crypto.scryptSync(String(password || ''), Buffer.from(auth.salt, 'hex'), 64);
  const passOk = crypto.timingSafeEqual(key, Buffer.from(auth.hash, 'hex'));
  const userOk = String(username || '').trim().toLowerCase() === String(auth.username).toLowerCase();
  return passOk && userOk;
}

function sessionToken(req) {
  const m = /(?:^|;\s*)pn_session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

function isLoggedIn(req) {
  if (!auth) return true;
  const t = sessionToken(req);
  return Boolean(t && sessions[sha256(t)] > Date.now());
}

// Slow down password guessing: 10 misses per address per 10 minutes.
const failures = new Map();
function tooManyFailures(ip) {
  const f = failures.get(ip);
  return Boolean(f && f.count >= 10 && Date.now() - f.since < 10 * 60 * 1000);
}
function noteFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > 10 * 60 * 1000) failures.set(ip, { count: 1, since: Date.now() });
  else f.count++;
}

// ---------- broadcasting ----------

const clients = new Set();

function send(res, msg) {
  res.write(`data: ${JSON.stringify(msg)}\n\n`);
}
function broadcast(msg) {
  for (const res of clients) send(res, msg);
}

function publicMeta() {
  return {
    title: config.title || 'Poker Night',
    currency: config.currency || '₹',
    locale: config.locale || 'en-US',
    buyIn: config.buyIn || 1000,
    chipsPerBuyIn: config.chipsPerBuyIn || 2000,
    playerActions: config.playerActions || [],
    announcements: (config.announcements || []).map((a) => ({ label: a.label || a.title })),
    soundboard: config.soundboard || [],
    customSounds: customSounds(),
    buttons: library.buttons,
    assetVersion,
    loginEnabled: Boolean(auth),
    controlUrls: lanUrls('/control'),
    canUndo: history.length > 0,
  };
}

function stateMessage() {
  return { type: 'state', state, meta: publicMeta() };
}
function broadcastState() {
  broadcast(stateMessage());
}
function fx(payload) {
  broadcast({ type: 'fx', fx: payload });
}

// ---------- scenes ----------

const fmt = (n) => Number(n).toLocaleString(config.locale || 'en-US');

function pick(v) {
  return Array.isArray(v) ? v[Math.floor(Math.random() * v.length)] : v;
}

function fill(value, vars) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function resolveScene(event, player, extra = {}) {
  const base = pick((config.scenes || {})[event]) || {};
  const key = player ? player.name.trim().toLowerCase() : null;
  const custom = key ? pick(((config.playerScenes || {})[key] || {})[event]) : null;
  const scene = { ...base, ...(custom || {}) };
  if (!Object.keys(scene).length) return null;

  const buyIn = config.buyIn || 1000;
  const chips = config.chipsPerBuyIn || 2000;
  const vars = {
    currency: config.currency || '₹',
    buyInFmt: fmt(buyIn),
    chipsPerBuyInFmt: fmt(chips),
    sb: state.blinds.sb,
    bb: state.blinds.bb,
    blinds: blindsText(state.blinds),
    ...(player && {
      name: player.name,
      buyins: player.buyins,
      total: fmt(player.buyins * buyIn),
      chips: fmt(player.buyins * chips),
      allins: (player.counts && player.counts.allin) || 0,
      ...cashVars(player, buyIn, chips),
      count: (player.counts && player.counts[event]) || 0,
    }),
    ...extra,
  };
  const out = {};
  for (const [k, v] of Object.entries(scene)) out[k] = fill(v, vars);
  out.event = event;
  return out;
}

// Final chips → rupee value and result against what they bought in.
function cashVars(player, buyIn, chipsPerBuyIn) {
  if (!player.cashOut) return {};
  const value = Math.round((player.cashOut.chips * buyIn) / chipsPerBuyIn);
  const net = value - player.buyins * buyIn;
  const cur = config.currency || '₹';
  return {
    cashChips: fmt(player.cashOut.chips),
    cashValue: fmt(value),
    net: net > 0 ? `+${cur}${fmt(net)}` : net < 0 ? `−${cur}${fmt(-net)}` : `${cur}0`,
  };
}

function showScene(event, player) {
  const scene = resolveScene(event, player);
  if (scene) fx({ kind: 'scene', scene });
}

// ---------- actions ----------

function findPlayer(id) {
  const p = state.players.find((x) => x.id === Number(id));
  if (!p) throw new Error('Player not found');
  return p;
}

function cleanName(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!n) throw new Error('Name is empty');
  return n;
}

// Each action returns an undo label (string) when it changed state, or nothing.
const actions = {
  addPlayer({ name }) {
    const n = cleanName(name);
    const existing = state.players.find((p) => p.name.toLowerCase() === n.toLowerCase());
    if (existing) throw new Error(`${existing.name} is already at the table`);
    const player = { id: state.nextId++, name: n, buyins: 1, counts: {}, joinedAt: Date.now() };
    state.players.push(player);
    if (!state.startedAt) state.startedAt = Date.now();
    if (config.welcomeOnJoin !== false) showScene('welcome', player);
    return `add ${n}`;
  },

  renamePlayer({ id, name }) {
    const p = findPlayer(id);
    const n = cleanName(name);
    const old = p.name;
    p.name = n;
    return `rename ${old} → ${n}`;
  },

  removePlayer({ id }) {
    const p = findPlayer(id);
    state.players = state.players.filter((x) => x !== p);
    return `remove ${p.name}`;
  },

  buyin({ id, delta }) {
    const p = findPlayer(id);
    if (p.cashOut) throw new Error(`${p.name} has cashed out — tap ⋯ → Back in game first`);
    const d = Number(delta) >= 0 ? 1 : -1;
    const next = Math.max(0, p.buyins + d);
    if (next === p.buyins) return;
    p.buyins = next;
    if (d > 0 && next >= 2) showScene('rebuy', p);
    return `${d > 0 ? '+1' : '−1'} buy-in for ${p.name}`;
  },

  trigger({ id, event }) {
    const p = findPlayer(id);
    const ev = String(event);
    p.counts = p.counts || {};
    p.counts[ev] = (p.counts[ev] || 0) + 1;
    showScene(ev, p);
    return `${ev} for ${p.name}`;
  },

  welcome({ id }) {
    showScene('welcome', findPlayer(id));
  },

  announce({ index }) {
    const a = (config.announcements || [])[Number(index)];
    if (!a) throw new Error('Unknown announcement');
    const { label, ...scene } = a;
    fx({ kind: 'scene', scene: { ...scene, event: 'announcement' } });
  },

  custom(payload) {
    fx({ kind: 'scene', scene: { ...cleanCustom(payload), duration: 7, event: 'custom' } });
  },

  saveButton(payload) {
    const b = { id: Date.now().toString(36), ...cleanCustom(payload) };
    library.buttons.push(b);
    saveLibrary();
    broadcastState();
  },

  deleteButton({ id }) {
    library.buttons = library.buttons.filter((b) => b.id !== id);
    saveLibrary();
    broadcastState();
  },

  playButton({ id }) {
    const b = library.buttons.find((x) => x.id === id);
    if (!b) throw new Error('Button not found');
    fx({ kind: 'scene', scene: { ...b, duration: 7, event: 'custom' } });
  },

  deleteSound({ file }) {
    const f = path.basename(String(file || ''));
    const full = path.join(SOUNDS_DIR, f);
    if (!AUDIO_EXT.includes(path.extname(f).toLowerCase()) || !fs.existsSync(full)) throw new Error('Sound not found');
    fs.unlinkSync(full);
    broadcastState();
  },

  cashOut({ id, chips }) {
    const p = findPlayer(id);
    const c = Math.round(Number(chips));
    if (chips === '' || chips == null || !Number.isFinite(c) || c < 0) throw new Error('Enter the final chip count');
    const changing = Boolean(p.cashOut);
    p.cashOut = { chips: c, at: (p.cashOut && p.cashOut.at) || Date.now() };
    if (!changing) showScene('cashout', p);
    return `${changing ? 'change cash-out for' : 'cash out'} ${p.name} (${c} chips)`;
  },

  undoCashOut({ id }) {
    const p = findPlayer(id);
    if (!p.cashOut) return;
    delete p.cashOut;
    return `${p.name} back in the game`;
  },

  toggleCement({ id }) {
    const p = findPlayer(id);
    p.cemented = !p.cemented;
    if (p.cemented) showScene('cement', p);
    return `${p.cemented ? 'cement' : 'uncement'} ${p.name}`;
  },

  sound({ sound }) {
    fx({ kind: 'sound', sound: String(sound) });
  },

  clock({ id, seconds }) {
    const p = id != null ? findPlayer(id) : null;
    const s = Math.min(300, Math.max(5, Number(seconds) || 30));
    fx({ kind: 'clock', seconds: s, name: p ? p.name : null, endsAt: Date.now() + s * 1000 });
  },

  clearFx() {
    fx({ kind: 'clear' });
  },

  setMode({ mode }) {
    const m = mode === 'lobby' ? 'lobby' : 'table';
    if (m === state.mode) return;
    state.mode = m;
    return `switch to ${m}`;
  },

  setBlinds({ sb, bb, straddle }) {
    const s = Math.round(Number(sb));
    const b = Math.round(Number(bb));
    const st = Math.round(Number(straddle)) || 0;
    if (!(s > 0 && b >= s)) throw new Error('Blinds must be positive and BB ≥ SB');
    if (st && st < b) throw new Error('Straddle must be at least the big blind');
    state.blinds = st ? { sb: s, bb: b, straddle: st } : { sb: s, bb: b };
    const text = blindsText(state.blinds);
    fx({ kind: 'scene', scene: { title: `Blinds ${text}`, subtitle: 'New level', sound: 'ding', theme: 'purple', duration: 5, event: 'blinds' } });
    return `blinds → ${text}`;
  },

  resetNight() {
    const keepBlinds = state.blinds;
    state = { ...freshState(), blinds: keepBlinds };
    return 'reset night';
  },
};

// "10 / 20" or, with a straddle, "10 / 20 / 40".
function blindsText(b) {
  return [b.sb, b.bb, b.straddle].filter(Boolean).join(' / ');
}

function cleanCustom({ title, subtitle, theme, sound }) {
  const t = String(title || '').trim().slice(0, 80);
  if (!t) throw new Error('Type a message first');
  const themes = ['red', 'gold', 'green', 'blue', 'purple', 'black'];
  return {
    title: t,
    subtitle: String(subtitle || '').trim().slice(0, 120),
    theme: themes.includes(theme) ? theme : 'black',
    sound: sound ? String(sound) : '',
  };
}

function runAction(name, payload) {
  if (name === 'undo') {
    const last = history.pop();
    if (!last) throw new Error('Nothing to undo');
    state = last.snapshot;
    return { undone: last.label, changed: true };
  }
  const fn = actions[name];
  if (!fn) throw new Error(`Unknown action: ${name}`);
  const snapshot = JSON.parse(JSON.stringify(state));
  const label = fn(payload || {});
  if (label) {
    history.push({ label, snapshot });
    if (history.length > UNDO_LIMIT) history.shift();
    return { changed: true };
  }
  return { changed: false };
}

// ---------- http ----------

function lanUrls(suffix = '') {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) urls.push(`http://${i.address}:${PORT}${suffix}`);
    }
  }
  return urls;
}

function redirect(res, to) {
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' });
  res.end();
}

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveFile(res, baseDir, relPath) {
  const file = path.normalize(path.join(baseDir, relPath));
  if (!file.startsWith(baseDir + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 16 * 1024) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const PUBLIC = path.join(ROOT, 'public');
const MEDIA = path.join(ROOT, 'media');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);

  if (req.method === 'GET' && p === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    send(res, stateMessage());
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'POST' && p === '/api/login') {
    const ip = req.socket.remoteAddress;
    if (tooManyFailures(ip)) return sendJson(res, 429, { ok: false, error: 'Too many tries — wait 10 minutes' });
    try {
      const { username, password } = await readBody(req);
      if (!checkPassword(username, password)) {
        noteFailure(ip);
        return sendJson(res, 401, { ok: false, error: 'Wrong username or password' });
      }
      failures.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      sessions[sha256(token)] = Date.now() + SESSION_DAYS * 864e5;
      saveSessions();
      res.setHeader('Set-Cookie', `pn_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && p === '/api/logout') {
    const t = sessionToken(req);
    if (t) {
      delete sessions[sha256(t)];
      saveSessions();
    }
    res.setHeader('Set-Cookie', 'pn_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && (p === '/api/action' || p === '/api/upload') && !isLoggedIn(req)) {
    return sendJson(res, 401, { ok: false, login: true, error: 'Please log in again' });
  }

  if (req.method === 'POST' && p === '/api/action') {
    try {
      const body = await readBody(req);
      const result = runAction(String(body.action), body);
      if (result.changed) {
        save();
        broadcastState();
      }
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && p === '/api/upload') {
    const original = path.basename(url.searchParams.get('name') || 'sound.mp3');
    const ext = path.extname(original).toLowerCase();
    if (!AUDIO_EXT.includes(ext)) {
      return sendJson(res, 400, { ok: false, error: `Use ${AUDIO_EXT.join(', ')}` });
    }
    const base = path.basename(original, path.extname(original)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sound';
    fs.mkdirSync(SOUNDS_DIR, { recursive: true });
    let name = base + ext;
    for (let i = 2; fs.existsSync(path.join(SOUNDS_DIR, name)); i++) name = `${base}-${i}${ext}`;

    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_UPLOAD) {
        sendJson(res, 413, { ok: false, error: 'File is over 15 MB' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_UPLOAD || res.writableEnded) return;
      if (!size) return sendJson(res, 400, { ok: false, error: 'Empty file' });
      fs.writeFileSync(path.join(SOUNDS_DIR, name), Buffer.concat(chunks));
      broadcastState();
      sendJson(res, 200, { ok: true, file: name });
    });
    return;
  }

  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  if (p === '/') return redirect(res, '/control');
  if (p === '/display') return serveFile(res, PUBLIC, 'display.html');
  if (p === '/login') {
    if (isLoggedIn(req) && auth) return redirect(res, '/control');
    return serveFile(res, PUBLIC, 'login.html');
  }
  if (p === '/control') {
    if (!isLoggedIn(req)) return redirect(res, '/login');
    return serveFile(res, PUBLIC, 'control.html');
  }
  if (p === '/login.html' || p === '/control.html') return redirect(res, p.replace('.html', ''));
  if (p.startsWith('/media/')) return serveFile(res, MEDIA, p.slice('/media/'.length));
  return serveFile(res, PUBLIC, p.slice(1));
});

// Keep SSE connections alive through idle periods.
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 20000);

// Edit config.json while the server runs — screens pick up the change within a second.
fs.watchFile(CONFIG_PATH, { interval: 1000 }, () => {
  config = loadConfig(config);
  console.log('[config] reloaded');
  broadcastState();
});

// Sounds dropped straight into media/sounds/ show up on the remote without a restart.
let soundsTimer;
fs.mkdirSync(SOUNDS_DIR, { recursive: true });
fs.watch(SOUNDS_DIR, () => {
  clearTimeout(soundsTimer);
  soundsTimer = setTimeout(broadcastState, 300);
});

let assetsTimer;
fs.watch(PUBLIC, () => {
  clearTimeout(assetsTimer);
  assetsTimer = setTimeout(() => {
    assetVersion = Date.now();
    broadcastState();
  }, 300);
});

fs.watchFile(AUTH_PATH, { interval: 1000 }, () => {
  auth = loadAuth();
  console.log(`[login] ${auth ? 'login updated' : 'login removed — remote is open'}`);
});

function shutdown() {
  try {
    saveNow();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, '0.0.0.0', () => {
  const lan = lanUrls();
  console.log('\n  ♠ Poker Night is running\n');
  console.log(`  Monitor (this laptop):  http://localhost:${PORT}/display`);
  if (lan.length) {
    for (const u of lan) console.log(`  Phone (same Wi-Fi):     ${u}/control`);
  } else {
    console.log('  Phone: no Wi-Fi address found — connect the laptop to Wi-Fi.');
  }
  console.log(auth ? `\n  Remote login: on (user "${auth.username}")` : '\n  Remote login: off — run `npm run set-login` to add one');
  console.log(`\n  ${state.players.length} player(s) restored from data/state.json. Ctrl+C to stop.\n`);
});
