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
    const room = rooms.createRoom();
    sendJson(response, 201, { room: rooms.serialize(room) });
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
