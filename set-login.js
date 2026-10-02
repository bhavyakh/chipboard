'use strict';

// Set (or change) the phone remote's username and password.
//   npm run set-login
// Writes auth.json with a salted scrypt hash — the password itself is never stored.
// Changing the login signs out every phone. Delete auth.json to turn the login off.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const ROOT = __dirname;
const AUTH_PATH = path.join(ROOT, 'auth.json');
const SESSIONS_PATH = path.join(ROOT, 'data', 'sessions.json');

function write(username, password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  fs.writeFileSync(AUTH_PATH, JSON.stringify({ username, salt: salt.toString('hex'), hash: hash.toString('hex') }, null, 2) + '\n', { mode: 0o600 });
  fs.rmSync(SESSIONS_PATH, { force: true });
  console.log(`\n  Login saved for "${username}". Phones need to log in again.\n`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const lines = [];
const prompts = ['Username: ', 'Password: '];
if (process.stdin.isTTY) process.stdout.write(prompts[0]);
rl.on('line', (line) => {
  lines.push(line);
  if (lines.length < 2) {
    if (process.stdin.isTTY) process.stdout.write(prompts[1]);
    return;
  }
  rl.close();
});
rl.on('close', () => {
  const [username = '', password = ''] = lines;
  if (!username.trim() || !password) {
    console.error('Username and password are both required.');
    process.exit(1);
  }
  write(username.trim(), password);
});
