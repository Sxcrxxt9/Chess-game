import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuthStore } from '../server/authStore.js';

function createStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-auth-'));
  return new AuthStore({ filePath: path.join(dir, 'auth.json') });
}

test('registers users with hashed passwords and starts a session', () => {
  const store = createStore();
  const result = store.register({
    username: 'Beam Player',
    email: 'beam@example.com',
    password: 'strongpass123'
  });

  assert.equal(result.user.username, 'Beam Player');
  assert.equal(result.user.email, 'beam@example.com');
  assert.equal(typeof result.token, 'string');
  assert.equal(result.user.passwordHash, undefined);
  assert.equal(store.authenticate(result.token).user.id, result.user.id);
});

test('rejects duplicate accounts and invalid logins', () => {
  const store = createStore();
  store.register({ username: 'Beam', email: 'beam@example.com', password: 'strongpass123' });

  assert.throws(() => {
    store.register({ username: 'beam', email: 'other@example.com', password: 'strongpass123' });
  }, /username is already taken/i);

  assert.throws(() => {
    store.login({ login: 'beam@example.com', password: 'wrongpass' });
  }, /invalid/i);
});

test('logs in, updates profile, and logs out', () => {
  const store = createStore();
  store.register({ username: 'Beam', email: 'beam@example.com', password: 'strongpass123' });

  const login = store.login({ login: 'beam@example.com', password: 'strongpass123' });
  assert.equal(login.user.username, 'Beam');

  const updated = store.updateProfile(login.user.id, { username: 'Beam Master' });
  assert.equal(updated.username, 'Beam Master');

  store.logout(login.token);
  assert.equal(store.authenticate(login.token), null);
});
