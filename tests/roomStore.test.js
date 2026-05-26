import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomStore } from '../server/roomStore.js';

function socket(id) {
  return { id };
}

function joinTwoPlayers(store) {
  const room = store.createRoom();
  store.joinRoom(room.id, socket('socket-a'), { clientId: 'alice', name: 'Alice' });
  store.joinRoom(room.id, socket('socket-b'), { clientId: 'bob', name: 'Bob' });
  return room;
}

test('assigns white, black, and spectator seats', () => {
  const store = new RoomStore();
  const room = store.createRoom();

  const whiteState = store.joinRoom(room.id, socket('socket-a'), { clientId: 'alice', name: 'Alice' });
  const blackState = store.joinRoom(room.id, socket('socket-b'), { clientId: 'bob', name: 'Bob' });
  const spectatorState = store.joinRoom(room.id, socket('socket-c'), { clientId: 'casey', name: 'Casey' });

  assert.equal(whiteState.viewer.role, 'white');
  assert.equal(blackState.viewer.role, 'black');
  assert.equal(spectatorState.viewer.role, 'spectator');
  assert.equal(spectatorState.spectatorCount, 1);
});

test('validates moves authoritatively and rejects illegal turns', () => {
  const store = new RoomStore();
  const room = joinTwoPlayers(store);

  assert.throws(() => {
    store.makeMove(room.id, 'bob', { from: 'e7', to: 'e5' });
  }, /not your turn/i);

  const afterMove = store.makeMove(room.id, 'alice', { from: 'e2', to: 'e4' });
  assert.equal(afterMove.fen.startsWith('rnbqkbnr/pppppppp/8/8/4P3'), true);
  assert.equal(afterMove.turn, 'b');

  assert.throws(() => {
    store.makeMove(room.id, 'alice', { from: 'e4', to: 'e5' });
  }, /not your turn/i);
});

test('does not start play until both players are seated', () => {
  const store = new RoomStore();
  const room = store.createRoom();
  store.joinRoom(room.id, socket('socket-a'), { clientId: 'alice', name: 'Alice' });

  assert.throws(() => {
    store.makeMove(room.id, 'alice', { from: 'e2', to: 'e4' });
  }, /waiting for both players/i);
});

test('draw agreement finishes the game', () => {
  const store = new RoomStore();
  const room = joinTwoPlayers(store);

  const offer = store.offerDraw(room.id, 'alice');
  assert.equal(offer.drawOfferBy, 'white');

  const accepted = store.offerDraw(room.id, 'bob');
  assert.equal(accepted.result.type, 'draw-agreement');
  assert.equal(accepted.result.winner, null);
});

test('resignation awards the game to the opponent', () => {
  const store = new RoomStore();
  const room = joinTwoPlayers(store);

  const state = store.resign(room.id, 'alice');
  assert.equal(state.result.type, 'resignation');
  assert.equal(state.result.winner, 'b');
});

test('rematch resets the board and swaps colors when both players vote', () => {
  const store = new RoomStore();
  const room = joinTwoPlayers(store);

  store.resign(room.id, 'alice');
  const firstVote = store.requestRematch(room.id, 'alice');
  assert.deepEqual(firstVote.rematchVotes, ['white']);

  const rematch = store.requestRematch(room.id, 'bob');
  assert.equal(rematch.result, null);
  assert.equal(rematch.history.length, 0);
  assert.equal(rematch.players.white.clientId, 'bob');
  assert.equal(rematch.players.black.clientId, 'alice');
});

test('clock flags the active player on timeout', () => {
  const store = new RoomStore({ clockMs: 100, incrementMs: 0 });
  const room = joinTwoPlayers(store);

  room.activeSince = Date.now() - 250;
  const changed = store.tickClocks();
  const state = store.serialize(room);

  assert.equal(changed.length, 1);
  assert.equal(state.result.type, 'time');
  assert.equal(state.result.winner, 'b');
});

test('serializing state does not mutate clocks', () => {
  const store = new RoomStore();
  const room = joinTwoPlayers(store);
  const before = room.clock.w;

  store.serialize(room, 'alice');
  store.serialize(room, 'bob');

  assert.equal(room.clock.w, before);
});
