import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { RoomStore } from './roomStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT || 3001);
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : clientOrigin,
    methods: ['GET', 'POST']
  }
});
const rooms = new RoomStore();

app.use(cors({ origin: process.env.NODE_ENV === 'production' ? false : clientOrigin }));
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, uptime: process.uptime() });
});

app.get('/api/rooms', (_request, response) => {
  response.json({ rooms: rooms.listRooms() });
});

app.post('/api/rooms', (_request, response) => {
  const room = rooms.createRoom();
  response.status(201).json({ room: rooms.serialize(room) });
});

app.get('/api/rooms/:roomId', (request, response) => {
  const room = rooms.getRoom(request.params.roomId);
  if (!room) {
    response.status(404).json({ error: 'Room not found' });
    return;
  }

  rooms.updateClock(room);
  response.json({ room: rooms.serialize(room) });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distDir));
  app.get('*', (_request, response) => {
    response.sendFile(path.join(distDir, 'index.html'));
  });
}

async function broadcastRoom(room) {
  const sockets = await io.in(room.id).fetchSockets();
  for (const roomSocket of sockets) {
    roomSocket.emit('room:state', rooms.serialize(room, roomSocket.data.clientId));
  }
}

async function emitAction(socket, eventName, action) {
  try {
    const state = action();
    const room = rooms.requiredRoom(state.id);
    await broadcastRoom(room);
  } catch (error) {
    socket.emit('room:error', { event: eventName, message: error.message });
  }
}

io.on('connection', (socket) => {
  socket.on('room:join', (payload = {}) => {
    emitAction(socket, 'room:join', () => {
      const roomId = String(payload.roomId || '');
      const room = rooms.requiredRoom(roomId);
      socket.data.clientId = String(payload.clientId || socket.id);
      socket.join(room.id);
      return rooms.joinRoom(room.id, socket, payload);
    });
  });

  socket.on('room:move', (payload = {}) => {
    emitAction(socket, 'room:move', () => {
      return rooms.makeMove(payload.roomId, payload.clientId, payload.move);
    });
  });

  socket.on('room:resign', (payload = {}) => {
    emitAction(socket, 'room:resign', () => {
      return rooms.resign(payload.roomId, payload.clientId);
    });
  });

  socket.on('room:draw-offer', (payload = {}) => {
    emitAction(socket, 'room:draw-offer', () => {
      return rooms.offerDraw(payload.roomId, payload.clientId);
    });
  });

  socket.on('room:draw-cancel', (payload = {}) => {
    emitAction(socket, 'room:draw-cancel', () => {
      return rooms.cancelDraw(payload.roomId, payload.clientId);
    });
  });

  socket.on('room:rematch', (payload = {}) => {
    emitAction(socket, 'room:rematch', () => {
      return rooms.requestRematch(payload.roomId, payload.clientId);
    });
  });

  socket.on('room:chat', (payload = {}) => {
    emitAction(socket, 'room:chat', () => {
      return rooms.addChat(payload.roomId, payload.clientId, payload.text);
    });
  });

  socket.on('disconnect', () => {
    for (const room of rooms.disconnect(socket.id)) {
      void broadcastRoom(room);
    }
  });
});

setInterval(() => {
  for (const room of rooms.tickClocks()) {
    void broadcastRoom(room);
  }
}, 1000).unref();

server.listen(port, () => {
  console.log(`Chess server listening on http://localhost:${port}`);
});
