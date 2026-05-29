import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { RoomStore } from './roomStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT || 3001);
const rooms = new RoomStore();
const streams = new Map();
const timeControls = {
  bullet: { mode: 'bullet', clockMs: 60_000, incrementMs: 0 },
  blitz: { mode: 'blitz', clockMs: 3 * 60_000, incrementMs: 2_000 },
  rapid: { mode: 'rapid', clockMs: 10 * 60_000, incrementMs: 5_000 },
  daily: { mode: 'daily', clockMs: 24 * 60 * 60_000, incrementMs: 0 }
};
const platform = createPlatformState();

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function createPlatformState() {
  return {
    profiles: new Map(),
    puzzles: [
      {
        id: 'back-rank-1',
        title: 'Back rank tactic',
        theme: 'Mate in 1',
        fen: '6k1/5ppp/8/8/8/8/5PPP/6RK w - - 0 1',
        solution: ['Re8#'],
        hint: 'Use the open file and the trapped king.'
      },
      {
        id: 'fork-1',
        title: 'Fork the queen',
        theme: 'Knight fork',
        fen: 'r3k2r/ppp2ppp/2n5/3q4/3P4/2N2N2/PPP2PPP/R2QKB1R w KQkq - 0 1',
        solution: ['Nxd5'],
        hint: 'A central knight captures with tempo.'
      },
      {
        id: 'skewer-1',
        title: 'Win the rook',
        theme: 'Skewer',
        fen: '4r1k1/5ppp/8/8/8/5Q2/5PPP/6K1 w - - 0 1',
        solution: ['Qd5'],
        hint: 'Check first, then collect the heavy piece.'
      }
    ],
    lessons: [
      { id: 'opening', title: 'Opening principles', progress: 86, text: 'Control the center, develop minor pieces, castle before launching attacks.' },
      { id: 'tactics', title: 'Tactical vision', progress: 58, text: 'Train pins, forks, skewers, discovered attacks, and forcing move checks.' },
      { id: 'endgames', title: 'Endgame basics', progress: 42, text: 'Convert king and pawn endings with opposition, outside passers, and activity.' }
    ],
    events: [
      { id: 'rapid-arena', title: 'Rapid Arena', status: 'Live', players: 128, time: '10|5', mode: 'rapid' },
      { id: 'weekend-swiss', title: 'Weekend Swiss', status: 'Registering', players: 64, time: '15|10', mode: 'rapid' },
      { id: 'puzzle-storm', title: 'Puzzle Storm', status: 'Open', players: 420, time: '3 min', mode: 'blitz' }
    ],
    analyses: new Map()
  };
}

function cleanName(name) {
  const trimmed = String(name || 'Guest').trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 24) : 'Guest';
}

function profileFor(clientId, name = 'Guest') {
  const id = String(clientId || 'guest');
  if (!platform.profiles.has(id)) {
    platform.profiles.set(id, {
      clientId: id,
      name: cleanName(name),
      rapid: 1248,
      puzzle: 1810,
      games: 0,
      wins: 0,
      botGames: 0,
      puzzlesSolved: 0,
      lessonsCompleted: 0,
      eventsJoined: 0,
      accuracy: 82,
      streak: 0,
      lastSeen: Date.now()
    });
  }
  const profile = platform.profiles.get(id);
  profile.name = cleanName(name || profile.name);
  profile.lastSeen = Date.now();
  return profile;
}

function publicProfile(profile) {
  return { ...profile };
}

function leaderboard() {
  const seeded = [
    { name: 'NakamuraFan', rapid: 2681, puzzle: 2760, streak: 18 },
    { name: 'BangkokBishop', rapid: 2440, puzzle: 2325, streak: 11 },
    { name: 'EndgameLab', rapid: 2312, puzzle: 2410, streak: 7 },
    { name: 'KnightShift', rapid: 2204, puzzle: 2252, streak: 5 }
  ];
  return [...Array.from(platform.profiles.values()), ...seeded]
    .sort((a, b) => b.rapid - a.rapid)
    .slice(0, 10)
    .map((player, index) => ({
      rank: index + 1,
      name: player.name,
      rating: player.rapid,
      puzzle: player.puzzle,
      streak: `+${player.streak || 0}`
    }));
}

function platformPayload(clientId = 'guest', name = 'Guest') {
  const profile = profileFor(clientId, name);
  return {
    profile: publicProfile(profile),
    puzzles: platform.puzzles,
    lessons: platform.lessons,
    events: platform.events,
    leaderboard: leaderboard(),
    timeControls: [
      { id: 'bullet', label: '1 min', meta: 'Bullet' },
      { id: 'blitz', label: '3|2', meta: 'Blitz' },
      { id: 'rapid', label: '10|5', meta: 'Rapid' },
      { id: 'daily', label: 'Daily', meta: 'Correspondence' }
    ]
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error('Payload too large'));
      }
    });
    request.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    request.on('error', reject);
  });
}

function streamSet(roomId) {
  if (!streams.has(roomId)) streams.set(roomId, new Set());
  return streams.get(roomId);
}

function sendEvent(client, state) {
  client.response.write(`event: room:state\ndata: ${JSON.stringify(state)}\n\n`);
}

function broadcastRoom(room) {
  const clients = streams.get(room.id);
  if (!clients) return;

  for (const client of clients) {
    sendEvent(client, rooms.serialize(room, client.clientId));
  }
}

function serveStatic(request, response, url) {
  if (process.env.NODE_ENV !== 'production') {
    sendError(response, 404, 'Not found');
    return;
  }

  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(distDir, requestedPath));
  if (!filePath.startsWith(distDir)) {
    sendError(response, 403, 'Forbidden');
    return;
  }

  const fallbackPath = path.join(distDir, 'index.html');
  const finalPath = fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? filePath : fallbackPath;
  response.writeHead(200, {
    'Content-Type': contentTypes[path.extname(finalPath)] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(finalPath).pipe(response);
}

async function handleRoomAction(request, response, roomId, action) {
  try {
    const body = await readBody(request);
    const clientId = String(body.clientId || '');
    let state;

    if (action === 'join') {
      state = rooms.joinRoom(roomId, { id: clientId }, body);
    } else if (action === 'move') {
      state = rooms.makeMove(roomId, clientId, body.move);
    } else if (action === 'resign') {
      state = rooms.resign(roomId, clientId);
    } else if (action === 'draw-offer') {
      state = rooms.offerDraw(roomId, clientId);
    } else if (action === 'draw-cancel') {
      state = rooms.cancelDraw(roomId, clientId);
    } else if (action === 'rematch') {
      state = rooms.requestRematch(roomId, clientId);
    } else if (action === 'chat') {
      state = rooms.addChat(roomId, clientId, body.text);
    } else {
      sendError(response, 404, 'Not found');
      return;
    }

    broadcastRoom(rooms.requiredRoom(roomId));
    sendJson(response, 200, { room: state });
  } catch (error) {
    sendError(response, error.message === 'Room not found' ? 404 : 400, error.message);
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] !== 'api') {
    serveStatic(request, response, url);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, uptime: process.uptime() });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/rooms') {
    sendJson(response, 200, { rooms: rooms.listRooms() });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/rooms') {
    const body = await readBody(request);
    const control = timeControls[String(body.timeControl || 'rapid')] || timeControls.rapid;
    const room = rooms.createRoom(control);
    sendJson(response, 201, { room: rooms.serialize(room) });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/platform') {
    sendJson(response, 200, platformPayload(url.searchParams.get('clientId'), url.searchParams.get('name')));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/platform/puzzle-result') {
    const body = await readBody(request);
    const profile = profileFor(body.clientId, body.name);
    if (body.solved) {
      profile.puzzlesSolved += 1;
      profile.puzzle += 8;
      profile.streak += 1;
    } else {
      profile.streak = 0;
      profile.puzzle = Math.max(100, profile.puzzle - 2);
    }
    sendJson(response, 200, platformPayload(body.clientId, body.name));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/platform/bot-result') {
    const body = await readBody(request);
    const profile = profileFor(body.clientId, body.name);
    profile.botGames += 1;
    profile.games += 1;
    if (body.result === 'win') {
      profile.wins += 1;
      profile.rapid += 6;
      profile.streak += 1;
    } else if (body.result === 'loss') {
      profile.rapid = Math.max(100, profile.rapid - 4);
      profile.streak = 0;
    }
    profile.accuracy = Math.min(99, Math.round(78 + profile.wins * 1.2 + profile.puzzlesSolved * 0.2));
    sendJson(response, 200, platformPayload(body.clientId, body.name));
    return;
  }

  if (request.method === 'POST' && parts[1] === 'events' && parts[3] === 'register') {
    const body = await readBody(request);
    const event = platform.events.find((candidate) => candidate.id === parts[2]);
    if (!event) {
      sendError(response, 404, 'Event not found');
      return;
    }
    const profile = profileFor(body.clientId, body.name);
    profile.eventsJoined += 1;
    event.players += 1;
    const room = rooms.createRoom(timeControls[event.mode] || timeControls.rapid);
    sendJson(response, 200, { ...platformPayload(body.clientId, body.name), room: rooms.serialize(room) });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/platform/lesson-complete') {
    const body = await readBody(request);
    const profile = profileFor(body.clientId, body.name);
    const lesson = platform.lessons.find((candidate) => candidate.id === body.lessonId);
    profile.lessonsCompleted += 1;
    profile.rapid += 1;
    if (lesson) lesson.progress = Math.min(100, lesson.progress + 7);
    sendJson(response, 200, platformPayload(body.clientId, body.name));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/platform/analysis') {
    const body = await readBody(request);
    const id = `ana-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    platform.analyses.set(id, {
      id,
      fen: String(body.fen || ''),
      name: cleanName(body.name),
      createdAt: Date.now()
    });
    sendJson(response, 201, { analysis: platform.analyses.get(id) });
    return;
  }

  if (request.method === 'GET' && parts[1] === 'analysis' && parts[2]) {
    const analysis = platform.analyses.get(parts[2]);
    if (!analysis) {
      sendError(response, 404, 'Analysis not found');
      return;
    }
    sendJson(response, 200, { analysis });
    return;
  }

  const roomId = parts[2];
  if (parts[0] === 'api' && parts[1] === 'rooms' && roomId) {
    const room = rooms.getRoom(roomId);

    if (request.method === 'GET' && parts.length === 3) {
      if (!room) {
        sendError(response, 404, 'Room not found');
        return;
      }

      rooms.updateClock(room);
      sendJson(response, 200, { room: rooms.serialize(room) });
      return;
    }

    if (request.method === 'GET' && parts[3] === 'events') {
      if (!room) {
        sendError(response, 404, 'Room not found');
        return;
      }

      const clientId = String(url.searchParams.get('clientId') || '');
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      response.write('\n');

      const client = { clientId, response };
      streamSet(roomId).add(client);
      sendEvent(client, rooms.serialize(room, clientId));

      request.on('close', () => {
        streamSet(roomId).delete(client);
        for (const changedRoom of rooms.disconnect(clientId)) {
          broadcastRoom(changedRoom);
        }
      });
      return;
    }

    if (request.method === 'POST' && parts[3]) {
      await handleRoomAction(request, response, roomId, parts[3]);
      return;
    }
  }

  sendError(response, 404, 'Not found');
});

setInterval(() => {
  for (const room of rooms.tickClocks()) {
    broadcastRoom(room);
  }
}, 1000).unref();

server.listen(port, () => {
  console.log(`Chess server listening on http://localhost:${port}`);
});
