'use strict';

// End-to-end tests: each suite copies the app into a temp folder, starts the real
// server on a free port, and talks to it over HTTP. Run with `npm test`.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const APP = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startApp({ login } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chipboard-'));
  for (const f of ['server.js', 'set-login.js', 'config.example.json']) fs.copyFileSync(path.join(APP, f), path.join(dir, f));
  fs.cpSync(path.join(APP, 'public'), path.join(dir, 'public'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'media'));
  if (login) execFileSync('node', ['set-login.js'], { cwd: dir, input: `${login.username}\n${login.password}\n` });

  const port = await freePort();
  const proc = spawn('node', ['server.js'], { cwd: dir, env: { ...process.env, PORT: String(port) } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 5000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes('is running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.on('exit', (code) => reject(new Error(`server exited (${code})`)));
  });

  const base = `http://localhost:${port}`;
  let cookie = '';
  const app = {
    dir,
    base,
    async action(action, payload = {}) {
      const res = await fetch(`${base}/api/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ action, ...payload }),
      });
      return { status: res.status, ...(await res.json()) };
    },
    async login(username, password) {
      const res = await fetch(`${base}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, ...(await res.json()) };
    },
    // The first Server-Sent Event carries the full state.
    async state() {
      const ctrl = new AbortController();
      const res = await fetch(`${base}/events`, { signal: ctrl.signal });
      const reader = res.body.getReader();
      let buf = '';
      for (;;) {
        const { value } = await reader.read();
        buf += Buffer.from(value).toString();
        const m = /data: (.+)\n\n/.exec(buf);
        if (m) {
          ctrl.abort();
          return JSON.parse(m[1]);
        }
      }
    },
    get: (p, opts = {}) => fetch(base + p, { redirect: 'manual', headers: { cookie }, ...opts }),
    stop() {
      proc.kill('SIGKILL');
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return app;
}

describe('game', () => {
  let app;
  before(async () => (app = await startApp()));
  after(() => app.stop());

  test('first run creates config.json from the example', () => {
    assert.ok(fs.existsSync(path.join(app.dir, 'config.json')));
  });

  test('players start with one buy-in; names must be unique', async () => {
    assert.equal((await app.action('addPlayer', { name: 'Alex' })).ok, true);
    assert.equal((await app.action('addPlayer', { name: 'alex' })).ok, false);
    const { state } = await app.state();
    assert.deepEqual(state.players.map((p) => [p.name, p.buyins]), [['Alex', 1]]);
  });

  test('buy-ins go up and down, never below zero, and undo restores', async () => {
    await app.action('buyin', { id: 1, delta: 1 });
    await app.action('buyin', { id: 1, delta: 1 });
    assert.equal((await app.state()).state.players[0].buyins, 3);
    await app.action('undo');
    assert.equal((await app.state()).state.players[0].buyins, 2);
    for (let i = 0; i < 4; i++) await app.action('buyin', { id: 1, delta: -1 });
    assert.equal((await app.state()).state.players[0].buyins, 0);
  });

  test('cash out records chips, blocks buy-ins, and can be reversed', async () => {
    await app.action('addPlayer', { name: 'Sam' });
    assert.equal((await app.action('cashOut', { id: 2, chips: '' })).ok, false);
    assert.equal((await app.action('cashOut', { id: 2, chips: -1 })).ok, false);
    assert.equal((await app.action('cashOut', { id: 2, chips: 3150 })).ok, true);
    assert.equal((await app.action('buyin', { id: 2, delta: 1 })).ok, false);
    assert.equal((await app.state()).state.players[1].cashOut.chips, 3150);
    await app.action('undoCashOut', { id: 2 });
    assert.equal((await app.state()).state.players[1].cashOut, undefined);
  });

  test('blinds accept an optional straddle of at least the big blind', async () => {
    assert.equal((await app.action('setBlinds', { sb: 10, bb: 20, straddle: 10 })).ok, false);
    assert.equal((await app.action('setBlinds', { sb: 10, bb: 20, straddle: 40 })).ok, true);
    assert.deepEqual((await app.state()).state.blinds, { sb: 10, bb: 20, straddle: 40 });
  });

  test('saved buttons survive reset night', async () => {
    await app.action('saveButton', { title: 'Chai break', theme: 'gold' });
    await app.action('resetNight');
    const { state, meta } = await app.state();
    assert.equal(state.players.length, 0);
    assert.deepEqual(meta.buttons.map((b) => b.title), ['Chai break']);
  });

  test('uploads accept audio only and stay inside media/sounds', async () => {
    const bad = await fetch(`${app.base}/api/upload?name=run.exe`, { method: 'POST', body: 'x' });
    assert.equal(bad.status, 400);
    const sneaky = await fetch(`${app.base}/api/upload?name=${encodeURIComponent('../../server.mp3')}`, { method: 'POST', body: 'x' });
    assert.equal((await sneaky.json()).file, 'server.mp3');
    assert.ok(fs.existsSync(path.join(app.dir, 'media', 'sounds', 'server.mp3')));
  });

  test('static files cannot escape public/ or media/', async () => {
    assert.notEqual((await app.get('/%2e%2e/server.js')).status, 200);
    assert.notEqual((await app.get('/media/..%2fserver.js')).status, 200);
  });
});

describe('login', () => {
  let app;
  before(async () => (app = await startApp({ login: { username: 'host', password: 'correct horse' } })));
  after(() => app.stop());

  test('auth.json stores a hash, never the password', () => {
    const auth = fs.readFileSync(path.join(app.dir, 'auth.json'), 'utf8');
    assert.ok(!auth.includes('correct horse'));
    assert.deepEqual(Object.keys(JSON.parse(auth)), ['username', 'salt', 'hash']);
  });

  test('remote and actions need a login; the monitor does not', async () => {
    assert.equal((await app.get('/control')).headers.get('location'), '/login');
    assert.equal((await app.action('clearFx')).status, 401);
    assert.equal((await app.get('/display')).status, 200);
  });

  test('wrong details are rejected; right ones open the remote', async () => {
    assert.equal((await app.login('host', 'nope')).status, 401);
    assert.equal((await app.login('HOST', 'correct horse')).ok, true);
    assert.equal((await app.get('/control')).status, 200);
    assert.equal((await app.action('clearFx')).ok, true);
  });
});
