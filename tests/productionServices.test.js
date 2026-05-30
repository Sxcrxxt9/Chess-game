import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPersistenceStore } from '../server/persistenceStore.js';
import {
  EngineCluster,
  FairPlayService,
  MatchmakingService,
  ModerationService,
  RatingService,
  TournamentService
} from '../server/productionServices.js';
import { RoomStore } from '../server/roomStore.js';

function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-prod-'));
  return path.join(dir, 'chess.sqlite');
}

test('matchmaking pairs compatible players into a room', async () => {
  const db = await createPersistenceStore({ filePath: tempDbPath() });
  const rooms = new RoomStore({ persistence: db });
  const matchmaking = new MatchmakingService({ persistence: db });

  const first = matchmaking.join({ clientId: 'a', name: 'A', rating: 1200, mode: 'rapid', createMatch: () => null });
  const second = matchmaking.join({
    clientId: 'b',
    name: 'B',
    rating: 1230,
    mode: 'rapid',
    createMatch: (white, black) => {
      const room = rooms.createRoom();
      rooms.joinRoom(room.id, { id: white.clientId }, white);
      rooms.joinRoom(room.id, { id: black.clientId }, black);
      return rooms.serialize(room);
    }
  });

  assert.equal(first.status, 'queued');
  assert.equal(second.status, 'matched');
  assert.equal(second.room.players.white.name, 'A');
  assert.equal(second.room.players.black.name, 'B');
  db.close();
});

test('rating service applies an elo result once per game number', async () => {
  const db = await createPersistenceStore({ filePath: tempDbPath() });
  const rating = new RatingService({ persistence: db });
  const profiles = new Map([
    ['white', { clientId: 'white', name: 'White', rapid: 1200, games: 0, wins: 0, puzzlesSolved: 0, streak: 0, accuracy: 82 }],
    ['black', { clientId: 'black', name: 'Black', rapid: 1200, games: 0, wins: 0, puzzlesSolved: 0, streak: 0, accuracy: 82 }]
  ]);
  const room = {
    id: 'room-1',
    gameNumber: 1,
    players: { w: { clientId: 'white', name: 'White' }, b: { clientId: 'black', name: 'Black' } },
    result: { winner: 'w' }
  };

  const first = rating.apply(room, {
    profileFor: (id) => profiles.get(id),
    saveProfile: (profile) => profiles.set(profile.clientId, profile)
  });
  const second = rating.apply(room, {
    profileFor: (id) => profiles.get(id),
    saveProfile: (profile) => profiles.set(profile.clientId, profile)
  });

  assert.equal(first.after.white, 1216);
  assert.equal(second, null);
  db.close();
});

test('moderation filters chat text and records reports', async () => {
  const db = await createPersistenceStore({ filePath: tempDbPath() });
  const moderation = new ModerationService({ persistence: db });
  const review = moderation.reviewText('do not hack here');
  const report = moderation.report({ reporterId: 'a', targetId: 'b', roomId: 'room', reason: 'bad chat' });

  assert.equal(review.cleaned.includes('***'), true);
  assert.equal(report.status, 'open');
  db.close();
});

test('tournament service creates semifinal rooms at bracket size', async () => {
  const db = await createPersistenceStore({ filePath: tempDbPath() });
  const rooms = new RoomStore({ persistence: db });
  const tournaments = new TournamentService({ persistence: db });
  const createRoom = (white, black) => {
    const room = rooms.createRoom();
    rooms.joinRoom(room.id, { id: white.clientId }, white);
    rooms.joinRoom(room.id, { id: black.clientId }, black);
    return room;
  };

  for (const index of [1, 2, 3, 4]) {
    tournaments.register({ tournamentId: 'daily-cup', player: { clientId: `p${index}`, name: `P${index}`, rating: 1200 }, createRoom });
  }

  assert.equal(tournaments.tournaments[0].status, 'live');
  assert.equal(tournaments.tournaments[0].rounds[0].matches.length, 2);
  db.close();
});

test('engine cluster completes a material evaluation job', async () => {
  const db = await createPersistenceStore({ filePath: tempDbPath() });
  const engine = new EngineCluster({ persistence: db, size: 1 });
  const job = engine.submit({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', requestedBy: 'qa' });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const completed = engine.get(job.id);

  assert.equal(completed.status, 'complete');
  assert.equal(Array.isArray(completed.result.bestMoves), true);
  db.close();
});
