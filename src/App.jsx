import { useEffect, useMemo, useRef, useState } from 'react';

const apiBase = window.location.origin;

const pieces = {
  wp: '♙',
  wn: '♘',
  wb: '♗',
  wr: '♖',
  wq: '♕',
  wk: '♔',
  bp: '♟',
  bn: '♞',
  bb: '♝',
  br: '♜',
  bq: '♛',
  bk: '♚'
};

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const promotionPieces = [
  { value: 'q', label: 'Queen' },
  { value: 'r', label: 'Rook' },
  { value: 'b', label: 'Bishop' },
  { value: 'n', label: 'Knight' }
];

const iconGlyphs = {
  clipboard: '[]',
  flag: '|>',
  handshake: '<>',
  history: '@',
  message: '#',
  plus: '+',
  rotate: '↻',
  send: '>',
  share: '<',
  swords: 'X',
  users: 'oo'
};

function Icon({ name }) {
  return (
    <span className="ui-icon" aria-hidden="true">
      {iconGlyphs[name]}
    </span>
  );
}

function getStoredIdentity() {
  return {
    clientId: crypto.randomUUID(),
    name: window.localStorage.getItem('chess-player-name') || ''
  };
}

function normalizeRoomInput(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const invite = new URL(trimmed);
    return invite.searchParams.get('room') || '';
  } catch {
    return trimmed;
  }
}

function getInitialRoomId() {
  return new URLSearchParams(window.location.search).get('room') || '';
}

function formatClock(ms) {
  const safe = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function squareName(row, col, flipped) {
  const fileIndex = flipped ? 7 - col : col;
  const rank = flipped ? row + 1 : 8 - row;
  return `${files[fileIndex]}${rank}`;
}

function pieceAt(board, square) {
  if (!board || !square) return null;
  const file = files.indexOf(square[0]);
  const rank = Number(square[1]);
  if (file < 0 || Number.isNaN(rank)) return null;
  return board[8 - rank]?.[file] || null;
}

function isPromotionMove(piece, toSquare) {
  if (!piece || piece.type !== 'p') return false;
  return (piece.color === 'w' && toSquare.endsWith('8')) || (piece.color === 'b' && toSquare.endsWith('1'));
}

function App() {
  const identity = useMemo(getStoredIdentity, []);
  const [clientId] = useState(identity.clientId);
  const [name, setName] = useState(identity.name);
  const [roomId, setRoomId] = useState(getInitialRoomId);
  const [room, setRoom] = useState(null);
  const [roomReceivedAt, setRoomReceivedAt] = useState(Date.now());
  const [selected, setSelected] = useState(null);
  const [pendingPromotion, setPendingPromotion] = useState(null);
  const [joinInput, setJoinInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [notice, setNotice] = useState('');
  const [flipped, setFlipped] = useState(false);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const eventsRef = useRef(null);

  useEffect(() => {
    window.localStorage.setItem('chess-player-name', name);
  }, [name]);

  useEffect(() => {
    if (!roomId) return undefined;

    let cancelled = false;

    async function joinAndSubscribe() {
      try {
        await postRoomAction(roomId, 'join', { clientId, name });
        if (cancelled) return;

        eventsRef.current?.close();
        const stream = new EventSource(`${apiBase}/api/rooms/${roomId}/events?clientId=${encodeURIComponent(clientId)}`);
        eventsRef.current = stream;

        stream.addEventListener('open', () => setConnected(true));
        stream.addEventListener('error', () => setConnected(false));
        stream.addEventListener('room:state', (event) => {
          const nextRoom = JSON.parse(event.data);
          setRoom(nextRoom);
          setRoomReceivedAt(Date.now());
          setSelected(null);
          setPendingPromotion(null);
        });
      } catch {
        if (!cancelled) {
          setConnected(false);
          setNotice('Cannot reach the game server');
        }
      }
    }

    joinAndSubscribe();

    return () => {
      cancelled = true;
      eventsRef.current?.close();
      eventsRef.current = null;
      setConnected(false);
    };
  }, [clientId, name, roomId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const viewerColor = room?.players.white?.clientId === clientId ? 'w' : room?.players.black?.clientId === clientId ? 'b' : null;
  const viewerRole = viewerColor === 'w' ? 'white' : viewerColor === 'b' ? 'black' : room ? 'spectator' : 'guest';
  const hasBothPlayers = Boolean(room?.players.white && room?.players.black);
  const canAct = Boolean(viewerColor && room && hasBothPlayers && !room.result);
  const inviteUrl = room ? `${window.location.origin}${window.location.pathname}?room=${room.id}` : '';

  async function createRoom() {
    try {
      const response = await fetch(`${apiBase}/api/rooms`, { method: 'POST' });
      if (!response.ok) throw new Error('Unable to create room');
      const payload = await response.json();
      enterRoom(payload.room.id);
    } catch {
      setNotice('Cannot reach the game server');
    }
  }

  function enterRoom(nextRoomId) {
    const trimmed = normalizeRoomInput(nextRoomId);
    if (!trimmed) return;

    const url = new URL(window.location.href);
    url.searchParams.set('room', trimmed);
    window.history.replaceState({}, '', url);
    setRoomId(trimmed);
    setRoom(null);
  }

  async function postRoomAction(targetRoomId, action, payload = {}) {
    const response = await fetch(`${apiBase}/api/rooms/${targetRoomId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function emit(eventName, payload = {}) {
    const action = eventName.replace('room:', '');
    try {
      await postRoomAction(roomId, action, { clientId, ...payload });
    } catch (error) {
      setNotice(error.message || 'Something went wrong');
    }
  }

  function handleSquare(square) {
    if (!room || !canAct || room.turn !== viewerColor) return;
    const piece = pieceAt(room.board, square);
    const selectedPiece = pieceAt(room.board, selected);

    if (piece?.color === viewerColor && (!selected || selected === square)) {
      setSelected(square);
      return;
    }

    if (!selected) return;

    const legalTargets = room.legalMoves[selected] || [];
    const legalMove = legalTargets.find((move) => move.to === square);
    if (!legalMove) {
      setSelected(piece?.color === viewerColor ? square : null);
      return;
    }

    if (isPromotionMove(selectedPiece, square)) {
      setPendingPromotion({ from: selected, to: square });
      return;
    }

    emit('room:move', { move: { from: selected, to: square } });
  }

  function choosePromotion(piece) {
    if (!pendingPromotion) return;
    emit('room:move', { move: { ...pendingPromotion, promotion: piece } });
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteUrl);
    setNotice('Invite link copied');
  }

  function sendChat(event) {
    event.preventDefault();
    if (!chatInput.trim()) return;
    emit('room:chat', { text: chatInput });
    setChatInput('');
  }

  return (
    <main className="app-shell">
      <section className="topbar" aria-label="Game navigation">
        <div className="brand">
          <Icon name="swords" />
          <div>
            <strong>Online Chess Arena</strong>
            <span>Realtime rooms with server-side rules</span>
          </div>
        </div>
        <div className="profile">
          <input
            aria-label="Player name"
            maxLength={24}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
          />
          <span className={`connection ${connected ? 'online' : ''}`}>
            {connected ? 'online' : 'connecting'}
          </span>
        </div>
      </section>

      {!room ? (
        <Lobby
          joinInput={joinInput}
          setJoinInput={setJoinInput}
          createRoom={createRoom}
          enterRoom={enterRoom}
          notice={notice}
        />
      ) : (
        <GameRoom
          room={room}
          viewerColor={viewerColor}
          viewerRole={viewerRole}
          roomReceivedAt={roomReceivedAt}
          now={now}
          selected={selected}
          flipped={flipped}
          setFlipped={setFlipped}
          handleSquare={handleSquare}
          inviteUrl={inviteUrl}
          copyInvite={copyInvite}
          emit={emit}
          canAct={canAct}
          notice={notice}
          chatInput={chatInput}
          setChatInput={setChatInput}
          sendChat={sendChat}
        />
      )}

      {pendingPromotion && <PromotionDialog choosePromotion={choosePromotion} />}
    </main>
  );
}

function Lobby({ joinInput, setJoinInput, createRoom, enterRoom, notice }) {
  return (
    <section className="lobby">
      <div className="lobby-panel">
        <div className="lobby-copy">
          <span className="eyebrow">Play online</span>
          <h1>Chess that is ready for real matches.</h1>
          <p>Create a room, send the link, and play with clocks, chat, spectators, draw offers, and rematches.</p>
        </div>
        <div className="join-box">
          <button className="primary-action" onClick={createRoom}>
            <Icon name="plus" />
            Create room
          </button>
          <div className="join-row">
            <input
              value={joinInput}
              onChange={(event) => setJoinInput(event.target.value)}
              placeholder="Room code"
              aria-label="Room code"
            />
            <button onClick={() => enterRoom(joinInput)}>Join</button>
          </div>
          {notice && <p className="notice">{notice}</p>}
        </div>
      </div>
    </section>
  );
}

function GameRoom({
  room,
  viewerColor,
  viewerRole,
  roomReceivedAt,
  now,
  selected,
  flipped,
  setFlipped,
  handleSquare,
  inviteUrl,
  copyInvite,
  emit,
  canAct,
  notice,
  chatInput,
  setChatInput,
  sendChat
}) {
  const boardFlipped = flipped || viewerColor === 'b';
  const activeLabel = room.clock.activeColor;

  return (
    <section className="game-grid">
      <aside className="side-panel players-panel">
        <div className="room-card">
          <span className="label">Room</span>
          <div className="room-code">{room.id}</div>
          <div className="room-actions">
            <button title="Copy invite link" onClick={copyInvite}>
              <Icon name="share" />
              Invite
            </button>
            <button title="Flip board" onClick={() => setFlipped(!flipped)}>
              <Icon name="rotate" />
              Flip
            </button>
          </div>
          <input aria-label="Invite link" value={inviteUrl} readOnly />
        </div>

        <PlayerCard
          side="black"
          player={room.players.black}
          active={activeLabel === 'black'}
          clockMs={clockFor(room, 'black', roomReceivedAt, now)}
          result={room.result}
        />
        <PlayerCard
          side="white"
          player={room.players.white}
          active={activeLabel === 'white'}
          clockMs={clockFor(room, 'white', roomReceivedAt, now)}
          result={room.result}
        />

        <div className="table-line">
          <Icon name="users" />
          <span>{room.spectatorCount} spectators</span>
          <strong>{viewerRole}</strong>
        </div>
      </aside>

      <div className="board-area">
        <StatusStrip room={room} viewerColor={viewerColor} />
        <ChessBoard room={room} selected={selected} flipped={boardFlipped} handleSquare={handleSquare} />
        <ActionBar room={room} canAct={canAct} emit={emit} />
        {notice && <p className="notice inline">{notice}</p>}
      </div>

      <aside className="side-panel activity-panel">
        <MoveList history={room.history} />
        <Chat room={room} chatInput={chatInput} setChatInput={setChatInput} sendChat={sendChat} />
      </aside>
    </section>
  );
}

function clockFor(room, side, receivedAt, now) {
  const base = room.clock[side];
  if (room.result || room.clock.activeColor !== side) return base;
  return base - (now - receivedAt);
}

function PlayerCard({ side, player, active, clockMs, result }) {
  return (
    <div className={`player-card ${side} ${active ? 'active' : ''}`}>
      <div>
        <span className="label">{side}</span>
        <strong>{player?.name || 'Waiting for player'}</strong>
        <small>{player ? (player.connected ? 'connected' : 'reconnecting') : 'open seat'}</small>
      </div>
      <time className={clockMs <= 30000 && !result ? 'low-time' : ''}>{formatClock(clockMs)}</time>
    </div>
  );
}

function StatusStrip({ room, viewerColor }) {
  const turn = room.turn === 'w' ? 'white' : 'black';
  const isYourTurn = viewerColor === room.turn;
  const waitingForPlayer = !room.players.white || !room.players.black;
  let text = `${turn} to move`;

  if (waitingForPlayer) {
    text = 'Waiting for opponent';
  } else if (room.result) {
    text = room.result.reason;
  } else if (room.drawOfferBy) {
    text = `${room.drawOfferBy} offered a draw`;
  } else if (room.inCheck) {
    text = `${turn} to move, king in check`;
  } else if (isYourTurn) {
    text = 'Your move';
  }

  return (
    <div className="status-strip">
      <div>
        <span className="label">Status</span>
        <strong>{text}</strong>
      </div>
      <span className={`turn-dot ${turn}`} />
    </div>
  );
}

function ChessBoard({ room, selected, flipped, handleSquare }) {
  const legalTargets = new Set((room.legalMoves[selected] || []).map((move) => move.to));
  const lastMove = room.lastMove ? new Set([room.lastMove.from, room.lastMove.to]) : new Set();
  const cells = [];

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const square = squareName(row, col, flipped);
      const piece = pieceAt(room.board, square);
      const dark = (row + col) % 2 === 1;
      cells.push(
        <button
          key={square}
          className={[
            'square',
            dark ? 'dark' : 'light',
            selected === square ? 'selected' : '',
            legalTargets.has(square) ? 'legal' : '',
            lastMove.has(square) ? 'last' : ''
          ].join(' ')}
          onClick={() => handleSquare(square)}
          aria-label={piece ? `${piece.color === 'w' ? 'white' : 'black'} ${piece.type} on ${square}` : square}
        >
          <span className="coord file">{row === 7 ? square[0] : ''}</span>
          <span className="coord rank">{col === 0 ? square[1] : ''}</span>
          {piece && <span className={`piece ${piece.color}`}>{pieces[`${piece.color}${piece.type}`]}</span>}
        </button>
      );
    }
  }

  return <div className="board">{cells}</div>;
}

function ActionBar({ room, canAct, emit }) {
  const gameOver = Boolean(room.result);
  return (
    <div className="action-bar">
      <button disabled={!canAct} onClick={() => emit('room:draw-offer')}>
        <Icon name="handshake" />
        {room.drawOfferBy ? 'Accept draw' : 'Offer draw'}
      </button>
      <button disabled={!canAct || !room.drawOfferBy} onClick={() => emit('room:draw-cancel')}>
        <Icon name="clipboard" />
        Cancel draw
      </button>
      <button disabled={!canAct} onClick={() => emit('room:resign')}>
        <Icon name="flag" />
        Resign
      </button>
      <button disabled={!gameOver} onClick={() => emit('room:rematch')}>
        <Icon name="rotate" />
        Rematch
      </button>
    </div>
  );
}

function MoveList({ history }) {
  const rows = [];
  for (let index = 0; index < history.length; index += 2) {
    rows.push({
      number: index / 2 + 1,
      white: history[index]?.san || '',
      black: history[index + 1]?.san || ''
    });
  }

  return (
    <section className="activity-card">
      <h2>
        <Icon name="history" />
        Moves
      </h2>
      <div className="move-list">
        {rows.length ? (
          rows.map((row) => (
            <div className="move-row" key={row.number}>
              <span>{row.number}.</span>
              <strong>{row.white}</strong>
              <strong>{row.black}</strong>
            </div>
          ))
        ) : (
          <p className="empty-state">No moves yet</p>
        )}
      </div>
    </section>
  );
}

function Chat({ room, chatInput, setChatInput, sendChat }) {
  return (
    <section className="activity-card chat-card">
      <h2>
        <Icon name="message" />
        Chat
      </h2>
      <div className="chat-log">
        {room.chat.length ? (
          room.chat.map((message) => (
            <div className="chat-message" key={message.id}>
              <strong>{message.name}</strong>
              <span>{message.body}</span>
            </div>
          ))
        ) : (
          <p className="empty-state">Room messages appear here</p>
        )}
      </div>
      <form className="chat-form" onSubmit={sendChat}>
        <input
          value={chatInput}
          onChange={(event) => setChatInput(event.target.value)}
          placeholder="Message"
          maxLength={240}
        />
        <button aria-label="Send message">
          <Icon name="send" />
        </button>
      </form>
    </section>
  );
}

function PromotionDialog({ choosePromotion }) {
  return (
    <div className="modal-backdrop">
      <div className="promotion-modal" role="dialog" aria-modal="true" aria-label="Choose promotion piece">
        <h2>Promote pawn</h2>
        <div className="promotion-grid">
          {promotionPieces.map((piece) => (
            <button key={piece.value} onClick={() => choosePromotion(piece.value)}>
              {piece.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
