import { Chess } from 'chess.js';
import { nanoid } from 'nanoid';

const DEFAULT_CLOCK_MS = 10 * 60 * 1000;
const DEFAULT_INCREMENT_MS = 5 * 1000;
const MAX_CHAT_MESSAGES = 60;

const colorName = {
  w: 'white',
  b: 'black'
};

const opposite = {
  w: 'b',
  b: 'w'
};

function cleanName(name) {
  const fallback = 'Guest';
  if (typeof name !== 'string') return fallback;
  const trimmed = name.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 24) : fallback;
}

function publicPlayer(player) {
  if (!player) return null;
  return {
    clientId: player.clientId,
    name: player.name,
    connected: player.connected
  };
}

function winnerFromGame(game) {
  if (game.isCheckmate()) return opposite[game.turn()];
  return null;
}

function gameResult(game) {
  if (game.isCheckmate()) {
    const winner = winnerFromGame(game);
    return {
      type: 'checkmate',
      winner,
      reason: `${colorName[winner]} wins by checkmate`
    };
  }

  if (game.isStalemate()) {
    return { type: 'draw', winner: null, reason: 'Draw by stalemate' };
  }

  if (game.isThreefoldRepetition()) {
    return { type: 'draw', winner: null, reason: 'Draw by threefold repetition' };
  }

  if (game.isInsufficientMaterial()) {
    return { type: 'draw', winner: null, reason: 'Draw by insufficient material' };
  }

  if (game.isDraw()) {
    return { type: 'draw', winner: null, reason: 'Draw by rule' };
  }

  return null;
}

export class RoomStore {
  constructor({ clockMs = DEFAULT_CLOCK_MS, incrementMs = DEFAULT_INCREMENT_MS, persistence = null } = {}) {
    this.rooms = new Map();
    this.clockMs = clockMs;
    this.incrementMs = incrementMs;
    this.persistence = persistence;
    this.restoreRooms();
  }

  createRoom(options = {}) {
    const id = nanoid(8);
    const now = Date.now();
    const clockMs = Number.isFinite(options.clockMs) ? options.clockMs : this.clockMs;
    const incrementMs = Number.isFinite(options.incrementMs) ? options.incrementMs : this.incrementMs;
    const room = {
      id,
      createdAt: now,
      updatedAt: now,
      game: new Chess(),
      players: { w: null, b: null },
      spectators: new Map(),
      clock: { w: clockMs, b: clockMs },
      clockMs,
      incrementMs,
      mode: options.mode || 'rapid',
      activeSince: null,
      result: null,
      drawOfferBy: null,
      rematchVotes: new Set(),
      chat: [],
      lastMove: null
    };

    this.rooms.set(id, room);
    this.persistRoom(room);
    return room;
  }

  getRoom(id) {
    return this.rooms.get(id);
  }

  listRooms() {
    return Array.from(this.rooms.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20)
      .map((room) => {
        this.updateClock(room);
        return this.serialize(room);
      });
  }

  joinRoom(roomId, socket, payload = {}) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Room not found');

    const clientId = String(payload.clientId || socket.id);
    const name = cleanName(payload.name);
    const existingColor = this.getPlayerColor(room, clientId);
    const now = Date.now();

    if (existingColor) {
      room.players[existingColor] = {
        ...room.players[existingColor],
        name,
        socketId: socket.id,
        connected: true
      };
    } else if (!room.players.w) {
      room.players.w = { clientId, name, socketId: socket.id, connected: true };
    } else if (!room.players.b) {
      room.players.b = { clientId, name, socketId: socket.id, connected: true };
    } else {
      room.spectators.set(clientId, { clientId, name, socketId: socket.id, connected: true });
    }

    if (room.players.w && room.players.b && !room.result && !room.activeSince) {
      room.activeSince = now;
    }

    room.updatedAt = now;
    this.persistRoom(room);
    return this.serialize(room, clientId);
  }

  disconnect(socketId) {
    const changedRooms = [];

    for (const room of this.rooms.values()) {
      let changed = false;

      for (const color of ['w', 'b']) {
        const player = room.players[color];
        if (player?.socketId === socketId) {
          room.players[color] = { ...player, socketId: null, connected: false };
          changed = true;
        }
      }

      for (const [clientId, spectator] of room.spectators) {
        if (spectator.socketId === socketId) {
          room.spectators.delete(clientId);
          changed = true;
        }
      }

      if (changed) {
        room.updatedAt = Date.now();
        this.persistRoom(room);
        changedRooms.push(room);
      }
    }

    return changedRooms;
  }

  getPlayerColor(room, clientId) {
    if (room.players.w?.clientId === clientId) return 'w';
    if (room.players.b?.clientId === clientId) return 'b';
    return null;
  }

  updateClock(room, now = Date.now()) {
    if (room.result || !room.players.w || !room.players.b) return room.result;

    const turn = room.game.turn();
    if (!room.activeSince) {
      room.activeSince = now;
      return null;
    }

    const elapsed = Math.max(0, now - room.activeSince);
    room.clock[turn] = Math.max(0, room.clock[turn] - elapsed);
    room.activeSince = now;

    if (room.clock[turn] <= 0) {
      const winner = opposite[turn];
      room.result = {
        type: 'time',
        winner,
        reason: `${colorName[winner]} wins on time`
      };
      room.activeSince = null;
    }

    return room.result;
  }

  makeMove(roomId, clientId, move) {
    const room = this.requiredRoom(roomId);
    const color = this.getPlayerColor(room, clientId);

    if (!color) throw new Error('Spectators cannot move');
    if (!room.players.w || !room.players.b) throw new Error('Waiting for both players');
    if (room.result) throw new Error('This game is already finished');
    if (room.game.turn() !== color) throw new Error('It is not your turn');

    this.updateClock(room);
    if (room.result) return this.serialize(room, clientId);

    const normalizedMove = {
      from: String(move?.from || ''),
      to: String(move?.to || ''),
      promotion: String(move?.promotion || 'q').toLowerCase()
    };

    let played;
    try {
      played = room.game.move(normalizedMove);
    } catch {
      played = null;
    }

    if (!played) throw new Error('Illegal move');

    room.clock[color] += room.incrementMs;
    room.result = gameResult(room.game);
    room.activeSince = room.result ? null : Date.now();
    room.lastMove = {
      from: played.from,
      to: played.to,
      san: played.san,
      color,
      piece: played.piece,
      captured: played.captured || null,
      promotion: played.promotion || null
    };
    room.drawOfferBy = null;
    room.rematchVotes.clear();
    room.updatedAt = Date.now();
    this.persistRoom(room);

    return this.serialize(room, clientId);
  }

  resign(roomId, clientId) {
    const room = this.requiredRoom(roomId);
    const color = this.getPlayerColor(room, clientId);
    if (!color) throw new Error('Only players can resign');
    if (room.result) return this.serialize(room, clientId);

    const winner = opposite[color];
    room.result = {
      type: 'resignation',
      winner,
      reason: `${colorName[winner]} wins by resignation`
    };
    room.activeSince = null;
    room.updatedAt = Date.now();
    this.persistRoom(room);
    return this.serialize(room, clientId);
  }

  offerDraw(roomId, clientId) {
    const room = this.requiredRoom(roomId);
    const color = this.getPlayerColor(room, clientId);
    if (!color) throw new Error('Only players can offer a draw');
    if (room.result) return this.serialize(room, clientId);

    if (room.drawOfferBy && room.drawOfferBy !== color) {
      room.result = { type: 'draw-agreement', winner: null, reason: 'Draw by agreement' };
      room.activeSince = null;
    } else {
      room.drawOfferBy = color;
    }

    room.updatedAt = Date.now();
    this.persistRoom(room);
    return this.serialize(room, clientId);
  }

  cancelDraw(roomId, clientId) {
    const room = this.requiredRoom(roomId);
    const color = this.getPlayerColor(room, clientId);
    if (room.drawOfferBy === color) room.drawOfferBy = null;
    room.updatedAt = Date.now();
    this.persistRoom(room);
    return this.serialize(room, clientId);
  }

  requestRematch(roomId, clientId) {
    const room = this.requiredRoom(roomId);
    const color = this.getPlayerColor(room, clientId);
    if (!color) throw new Error('Only players can request a rematch');
    if (!room.result) throw new Error('Rematch is available after the game finishes');

    room.rematchVotes.add(color);

    if (room.rematchVotes.has('w') && room.rematchVotes.has('b')) {
      const previousWhite = room.players.w;
      room.players.w = room.players.b;
      room.players.b = previousWhite;
      room.game = new Chess();
      room.clock = { w: room.clockMs, b: room.clockMs };
      room.activeSince = room.players.w && room.players.b ? Date.now() : null;
      room.result = null;
      room.drawOfferBy = null;
      room.rematchVotes.clear();
      room.lastMove = null;
    }

    room.updatedAt = Date.now();
    this.persistRoom(room);
    return this.serialize(room, clientId);
  }

  addChat(roomId, clientId, text) {
    const room = this.requiredRoom(roomId);
    const playerColor = this.getPlayerColor(room, clientId);
    const spectator = room.spectators.get(clientId);
    const participant = playerColor ? room.players[playerColor] : spectator;
    const body = String(text || '').trim().slice(0, 240);

    if (!participant) throw new Error('Join the room before chatting');
    if (!body) return this.serialize(room, clientId);

    room.chat.push({
      id: nanoid(10),
      clientId,
      name: participant.name,
      role: playerColor ? colorName[playerColor] : 'spectator',
      body,
      createdAt: Date.now()
    });
    room.chat = room.chat.slice(-MAX_CHAT_MESSAGES);
    room.updatedAt = Date.now();
    this.persistRoom(room);

    return this.serialize(room, clientId);
  }

  tickClocks() {
    const changed = [];
    for (const room of this.rooms.values()) {
      const previousResult = room.result;
      this.updateClock(room);
      if (room.result !== previousResult) {
        room.updatedAt = Date.now();
        this.persistRoom(room);
        changed.push(room);
      }
    }
    return changed;
  }

  legalMoves(roomId, square) {
    const room = this.requiredRoom(roomId);
    if (!square) return [];
    return room.game.moves({ square, verbose: true }).map((move) => ({
      from: move.from,
      to: move.to,
      san: move.san,
      flags: move.flags,
      promotion: move.promotion || null
    }));
  }

  requiredRoom(roomId) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Room not found');
    return room;
  }

  restoreRooms() {
    if (!this.persistence) return;
    for (const state of this.persistence.listRoomStates()) {
      try {
        const room = this.hydrateRoom(state);
        this.rooms.set(room.id, room);
      } catch {
        // Ignore corrupted room records instead of blocking server boot.
      }
    }
  }

  hydrateRoom(state) {
    const game = new Chess();
    for (const move of state.moves || []) {
      game.move({ from: move.from, to: move.to, promotion: move.promotion || undefined });
    }

    const players = {
      w: state.players?.w ? { ...state.players.w, socketId: null, connected: false } : null,
      b: state.players?.b ? { ...state.players.b, socketId: null, connected: false } : null
    };

    const room = {
      id: state.id,
      createdAt: state.createdAt || Date.now(),
      updatedAt: state.updatedAt || Date.now(),
      game,
      players,
      spectators: new Map(),
      clock: state.clock || { w: this.clockMs, b: this.clockMs },
      clockMs: state.clockMs || this.clockMs,
      incrementMs: state.incrementMs || this.incrementMs,
      mode: state.mode || 'rapid',
      activeSince: state.result || !players.w || !players.b ? null : Date.now(),
      result: state.result || null,
      drawOfferBy: state.drawOfferBy || null,
      rematchVotes: new Set(state.rematchVotes || []),
      chat: state.chat || [],
      lastMove: state.lastMove || null
    };

    return room;
  }

  snapshotRoom(room) {
    return {
      id: room.id,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      moves: room.game.history({ verbose: true }).map((move) => ({
        from: move.from,
        to: move.to,
        promotion: move.promotion || null
      })),
      players: {
        w: room.players.w
          ? { clientId: room.players.w.clientId, name: room.players.w.name, connected: false }
          : null,
        b: room.players.b
          ? { clientId: room.players.b.clientId, name: room.players.b.name, connected: false }
          : null
      },
      clock: room.clock,
      clockMs: room.clockMs,
      incrementMs: room.incrementMs,
      mode: room.mode,
      result: room.result,
      drawOfferBy: room.drawOfferBy,
      rematchVotes: Array.from(room.rematchVotes),
      chat: room.chat,
      lastMove: room.lastMove,
      pgn: room.game.pgn(),
      fen: room.game.fen()
    };
  }

  persistRoom(room) {
    this.persistence?.saveRoomState(this.snapshotRoom(room));
  }

  historyForClient(clientId, limit = 12) {
    return Array.from(this.rooms.values())
      .filter((room) => room.players.w?.clientId === clientId || room.players.b?.clientId === clientId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((room) => {
        const color = room.players.w?.clientId === clientId ? 'white' : 'black';
        const opponent = color === 'white' ? room.players.b : room.players.w;
        return {
          id: room.id,
          color,
          opponent: opponent?.name || 'Waiting',
          result: room.result,
          moves: room.game.history().length,
          mode: room.mode,
          updatedAt: room.updatedAt
        };
      });
  }

  serialize(room, viewerClientId = null) {
    const viewerColor = viewerClientId ? this.getPlayerColor(room, viewerClientId) : null;
    const spectator = viewerClientId ? room.spectators.get(viewerClientId) : null;
    const legalMoves = {};

    if (!room.result) {
      for (const move of room.game.moves({ verbose: true })) {
        legalMoves[move.from] ||= [];
        legalMoves[move.from].push({
          from: move.from,
          to: move.to,
          san: move.san,
          flags: move.flags,
          promotion: move.promotion || null
        });
      }
    }

    return {
      id: room.id,
      fen: room.game.fen(),
      pgn: room.game.pgn(),
      board: room.game.board(),
      turn: room.game.turn(),
      inCheck: room.game.inCheck(),
      history: room.game.history({ verbose: true }).map((move) => ({
        from: move.from,
        to: move.to,
        san: move.san,
        color: move.color,
        piece: move.piece,
        captured: move.captured || null,
        promotion: move.promotion || null
      })),
      legalMoves,
      lastMove: room.lastMove,
      players: {
        white: publicPlayer(room.players.w),
        black: publicPlayer(room.players.b)
      },
      spectatorCount: room.spectators.size,
      viewer: {
        clientId: viewerClientId,
        role: viewerColor ? colorName[viewerColor] : spectator ? 'spectator' : 'guest',
        color: viewerColor
      },
      clock: {
        white: room.clock.w,
        black: room.clock.b,
        incrementMs: room.incrementMs,
        mode: room.mode,
        activeColor: room.result || !room.players.w || !room.players.b ? null : colorName[room.game.turn()]
      },
      result: room.result,
      drawOfferBy: room.drawOfferBy ? colorName[room.drawOfferBy] : null,
      rematchVotes: Array.from(room.rematchVotes).map((color) => colorName[color]),
      chat: room.chat,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt
    };
  }
}
