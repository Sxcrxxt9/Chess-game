import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuthStore } from '../server/authStore.js';
import { createPersistenceStore } from '../server/persistenceStore.js';
import { RoomStore } from '../server/roomStore.js';

function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-db-'));
  return path.join(dir, 'chess.sqlite');
}

function socket(id) {
  return { id };
}

test('persists auth sessions across store restarts', async () => {
  const filePath = tempDbPath();
  const firstDb = await createPersistenceStore({ filePath });
  const firstAuth = new AuthStore({ persistence: firstDb });
  const registered = firstAuth.register({
    username: 'Persisted Player',
    email: 'persisted@example.com',
    password: 'strongpass123'
  });
  firstDb.close();

  const secondDb = await createPersistenceStore({ filePath });
  const secondAuth = new AuthStore({ persistence: secondDb });
  const session = secondAuth.authenticate(registered.token);

  assert.equal(session.user.username, 'Persisted Player');
  secondDb.close();
});

test('persists rooms, moves, chat, and history across restarts', async () => {
  const filePath = tempDbPath();
  const firstDb = await createPersistenceStore({ filePath });
  const firstRooms = new RoomStore({ persistence: firstDb });
  const room = firstRooms.createRoom({ clockMs: 180000, incrementMs: 2000, mode: 'blitz' });

  firstRooms.joinRoom(room.id, socket('white-socket'), { clientId: 'white', name: 'White' });
  firstRooms.joinRoom(room.id, socket('black-socket'), { clientId: 'black', name: 'Black' });
  firstRooms.makeMove(room.id, 'white', { from: 'e2', to: 'e4' });
  firstRooms.addChat(room.id, 'black', 'gg');
  firstDb.close();

  const secondDb = await createPersistenceStore({ filePath });
  const secondRooms = new RoomStore({ persistence: secondDb });
  const restored = secondRooms.serialize(secondRooms.requiredRoom(room.id), 'white');

  assert.equal(restored.clock.mode, 'blitz');
  assert.equal(restored.history[0].san, 'e4');
  assert.equal(restored.chat[0].body, 'gg');
  assert.equal(restored.players.white.connected, false);
  assert.equal(secondRooms.historyForClient('white')[0].id, room.id);
  secondDb.close();
});

test('persists profile and analysis records', async () => {
  const filePath = tempDbPath();
  const db = await createPersistenceStore({ filePath });

  db.saveProfile({ clientId: 'player-1', name: 'Player', rapid: 1500 });
  db.saveAnalysis({ id: 'analysis-1', fen: '8/8/8/8/8/8/8/4K3 w - - 0 1', name: 'Player', createdAt: Date.now() });

  assert.equal(db.listProfiles()[0].rapid, 1500);
  assert.equal(db.getAnalysis('analysis-1').name, 'Player');
  assert.equal(db.stats().analyses, 1);
  db.close();
});
