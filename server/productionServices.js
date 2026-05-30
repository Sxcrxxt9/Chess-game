import os from 'node:os';
import { Chess } from 'chess.js';

const bannedWords = ['cheat', 'hack', 'abuse', 'scam'];

function expectedScore(a, b) {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

function scoreFor(result, color) {
  if (!result?.winner) return 0.5;
  return result.winner === color ? 1 : 0;
}

function materialScore(game) {
  const values = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  return game
    .board()
    .flat()
    .filter(Boolean)
    .reduce((score, piece) => score + values[piece.type] * (piece.color === 'w' ? 1 : -1), 0);
}

export class ObservabilityService {
  constructor({ persistence }) {
    this.persistence = persistence;
    this.metrics = persistence.getAppState('observability', {
      startedAt: Date.now(),
      requests: 0,
      errors: 0,
      totalLatencyMs: 0,
      routes: {}
    });
  }

  middleware(request, response) {
    const started = Date.now();
    response.on('finish', () => {
      const route = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
      const key = `${request.method} ${route}`;
      const latency = Date.now() - started;
      this.metrics.requests += 1;
      this.metrics.totalLatencyMs += latency;
      if (response.statusCode >= 400) this.metrics.errors += 1;
      this.metrics.routes[key] ||= { count: 0, errors: 0, totalLatencyMs: 0 };
      this.metrics.routes[key].count += 1;
      this.metrics.routes[key].totalLatencyMs += latency;
      if (response.statusCode >= 400) this.metrics.routes[key].errors += 1;
      if (this.metrics.requests % 10 === 0 || response.statusCode >= 500) this.persist();
    });
  }

  snapshot() {
    const avgLatencyMs = this.metrics.requests ? Math.round(this.metrics.totalLatencyMs / this.metrics.requests) : 0;
    return { ...this.metrics, avgLatencyMs };
  }

  persist() {
    this.persistence.saveAppState('observability', this.metrics);
  }
}

export class ModerationService {
  constructor({ persistence }) {
    this.persistence = persistence;
    this.reports = persistence.getAppState('moderationReports', []);
  }

  reviewText(text) {
    const original = String(text || '').trim();
    const lower = original.toLowerCase();
    const flags = bannedWords.filter((word) => lower.includes(word));
    const cleaned = flags.reduce((body, word) => body.replace(new RegExp(word, 'gi'), '***'), original).slice(0, 240);
    return { allowed: Boolean(cleaned), cleaned, flags };
  }

  report({ reporterId, targetId, roomId, reason }) {
    const report = {
      id: `report-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      reporterId,
      targetId: String(targetId || ''),
      roomId: String(roomId || ''),
      reason: String(reason || '').trim().slice(0, 320),
      status: 'open',
      createdAt: Date.now()
    };
    this.reports.unshift(report);
    this.reports = this.reports.slice(0, 200);
    this.persistence.saveAppState('moderationReports', this.reports);
    return report;
  }
}

export class RatingService {
  constructor({ persistence }) {
    this.persistence = persistence;
    this.ratedRooms = new Set(persistence.getAppState('ratedRooms', []));
  }

  apply(room, { profileFor, saveProfile }) {
    const ratingKey = `${room.id}:${room.gameNumber || 1}`;
    if (!room.result || this.ratedRooms.has(ratingKey) || !room.players.w || !room.players.b) return null;
    const white = profileFor(room.players.w.clientId, room.players.w.name);
    const black = profileFor(room.players.b.clientId, room.players.b.name);
    const expectedWhite = expectedScore(white.rapid, black.rapid);
    const expectedBlack = expectedScore(black.rapid, white.rapid);
    const whiteScore = scoreFor(room.result, 'w');
    const blackScore = scoreFor(room.result, 'b');
    const kWhite = white.games < 30 ? 32 : 20;
    const kBlack = black.games < 30 ? 32 : 20;
    const before = { white: white.rapid, black: black.rapid };

    white.rapid = Math.max(100, Math.round(white.rapid + kWhite * (whiteScore - expectedWhite)));
    black.rapid = Math.max(100, Math.round(black.rapid + kBlack * (blackScore - expectedBlack)));
    white.games += 1;
    black.games += 1;
    if (whiteScore === 1) white.wins += 1;
    if (blackScore === 1) black.wins += 1;
    white.streak = whiteScore === 1 ? white.streak + 1 : whiteScore === 0 ? 0 : white.streak;
    black.streak = blackScore === 1 ? black.streak + 1 : blackScore === 0 ? 0 : black.streak;
    white.accuracy = Math.min(99, Math.round(78 + white.wins * 1.2 + white.puzzlesSolved * 0.2));
    black.accuracy = Math.min(99, Math.round(78 + black.wins * 1.2 + black.puzzlesSolved * 0.2));
    saveProfile(white);
    saveProfile(black);
    this.ratedRooms.add(ratingKey);
    this.persistence.saveAppState('ratedRooms', Array.from(this.ratedRooms));
    return { roomId: room.id, before, after: { white: white.rapid, black: black.rapid } };
  }
}

export class FairPlayService {
  constructor({ persistence }) {
    this.persistence = persistence;
    this.state = persistence.getAppState('fairplay', { players: {}, roomLastMoveAt: {} });
  }

  recordMove({ roomId, clientId, san, moveNumber }) {
    const now = Date.now();
    const last = this.state.roomLastMoveAt[roomId] || now;
    const thinkMs = Math.max(0, now - last);
    this.state.roomLastMoveAt[roomId] = now;
    this.state.players[clientId] ||= { moves: 0, fastMoves: 0, flags: [], lastUpdated: now };
    const player = this.state.players[clientId];
    player.moves += 1;
    if (moveNumber > 8 && thinkMs < 650) player.fastMoves += 1;
    if (player.moves >= 16 && player.fastMoves / player.moves > 0.65 && !player.flags.includes('fast-move-pattern')) {
      player.flags.push('fast-move-pattern');
    }
    player.lastMove = san;
    player.lastThinkMs = thinkMs;
    player.lastUpdated = now;
    this.persistence.saveAppState('fairplay', this.state);
    return player;
  }

  snapshot(clientId) {
    return clientId ? this.state.players[clientId] || null : this.state;
  }
}

export class MatchmakingService {
  constructor({ persistence }) {
    this.persistence = persistence;
    this.queue = persistence.getAppState('matchmakingQueue', []);
  }

  join({ clientId, name, rating, mode = 'rapid', createMatch }) {
    this.queue = this.queue.filter((entry) => entry.clientId !== clientId);
    const entry = { clientId, name, rating, mode, joinedAt: Date.now() };
    const opponent = this.queue.find((candidate) => candidate.mode === mode && Math.abs(candidate.rating - rating) <= 250);
    if (!opponent) {
      this.queue.push(entry);
      this.persist();
      return { status: 'queued', queue: this.queue.length };
    }

    this.queue = this.queue.filter((candidate) => candidate.clientId !== opponent.clientId);
    this.persist();
    const room = createMatch(opponent, entry);
    return { status: 'matched', room, opponent };
  }

  leave(clientId) {
    this.queue = this.queue.filter((entry) => entry.clientId !== clientId);
    this.persist();
    return { status: 'left', queue: this.queue.length };
  }

  persist() {
    this.persistence.saveAppState('matchmakingQueue', this.queue);
  }
}

export class TournamentService {
  constructor({ persistence }) {
    this.persistence = persistence;
    this.tournaments = persistence.getAppState('tournaments', [
      { id: 'daily-cup', title: 'Daily Cup', status: 'registering', size: 4, players: [], rounds: [] }
    ]);
  }

  register({ tournamentId, player, createRoom }) {
    const tournament = this.tournaments.find((item) => item.id === tournamentId);
    if (!tournament) return null;
    if (!tournament.players.some((candidate) => candidate.clientId === player.clientId)) {
      tournament.players.push(player);
    }
    if (tournament.players.length >= tournament.size && !tournament.rounds.length) {
      tournament.status = 'live';
      tournament.rounds.push({
        name: 'Semifinal',
        matches: [
          this.createMatch(tournament.players[0], tournament.players[3], createRoom),
          this.createMatch(tournament.players[1], tournament.players[2], createRoom)
        ]
      });
    }
    this.persist();
    return tournament;
  }

  createMatch(white, black, createRoom) {
    const room = createRoom(white, black);
    return {
      id: `match-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      white,
      black,
      roomId: room.id,
      status: 'playing',
      winner: null
    };
  }

  persist() {
    this.persistence.saveAppState('tournaments', this.tournaments);
  }
}

export class EngineCluster {
  constructor({ persistence, size = Math.max(1, Math.min(4, os.cpus().length - 1)) }) {
    this.persistence = persistence;
    this.size = size;
    this.active = 0;
    this.queue = [];
    this.jobs = persistence.getAppState('engineJobs', {});
  }

  submit({ fen, depth = 12, requestedBy }) {
    const id = `engine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.jobs[id] = { id, fen: String(fen || ''), depth: Math.min(18, Math.max(1, Number(depth) || 12)), requestedBy, status: 'queued', createdAt: Date.now() };
    this.queue.push(id);
    this.persist();
    this.pump();
    return this.jobs[id];
  }

  pump() {
    while (this.active < this.size && this.queue.length) {
      const id = this.queue.shift();
      this.active += 1;
      this.jobs[id].status = 'running';
      setTimeout(() => {
        try {
          this.jobs[id] = { ...this.jobs[id], status: 'complete', completedAt: Date.now(), result: this.evaluate(this.jobs[id].fen) };
        } catch (error) {
          this.jobs[id] = { ...this.jobs[id], status: 'failed', error: error.message };
        } finally {
          this.active -= 1;
          this.persist();
          this.pump();
        }
      }, 25);
    }
  }

  evaluate(fen) {
    const game = new Chess(fen);
    const moves = game.moves({ verbose: true });
    const scored = moves
      .map((move) => {
        const next = new Chess(fen);
        next.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
        const score = materialScore(next) + next.moves().length * (game.turn() === 'w' ? 2 : -2);
        return { san: move.san, from: move.from, to: move.to, score };
      })
      .sort((a, b) => (game.turn() === 'w' ? b.score - a.score : a.score - b.score));
    return {
      sideToMove: game.turn() === 'w' ? 'white' : 'black',
      evaluation: materialScore(game),
      bestMoves: scored.slice(0, 5)
    };
  }

  get(id) {
    return this.jobs[id] || null;
  }

  snapshot() {
    return { size: this.size, active: this.active, queued: this.queue.length };
  }

  persist() {
    this.persistence.saveAppState('engineJobs', this.jobs);
  }
}
