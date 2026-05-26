# Online Chess Arena

A production-minded realtime chess project built with React, Express, Socket.IO, and chess.js. The server is authoritative: it owns the board state, validates every move, assigns seats, tracks clocks, handles draw offers, resignations, rematches, spectators, reconnects, and broadcasts synchronized room state.

## Features

- Create or join shareable game rooms
- White/black seat assignment with spectator mode when seats are full
- Legal move validation through `chess.js`
- Click-to-move board with legal move hints and promotion picker
- Server-side chess clocks with increment and flag detection
- Draw offers, resignations, and rematch flow
- Reconnect support by persistent browser client id
- Room chat and copyable invite link
- Responsive desktop/mobile layout

## Local Development

```bash
npm install
npm run dev
```

The React client runs on `http://localhost:5173` and proxies API/socket traffic to the server on `http://localhost:3001`.

## Production

```bash
npm install
npm run build
npm start
```

`npm start` serves the built client from `dist` and the Socket.IO/REST server from the same process.

## Checks

```bash
npm test
npm run build
```
