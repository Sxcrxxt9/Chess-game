import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';

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
  analysis: 'A',
  bot: 'CPU',
  book: 'B',
  bolt: '!',
  chart: '↑',
  clipboard: '[]',
  flag: '|>',
  handshake: '<>',
  history: '@',
  home: 'H',
  message: '#',
  play: '▶',
  plus: '+',
  puzzle: '?',
  rotate: '↻',
  send: '>',
  share: '<',
  shield: '◆',
  swords: 'X',
  trophy: 'T',
  users: 'oo',
  watch: '◉'
};

const navItems = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'play', label: 'Play', icon: 'play' },
  { id: 'puzzles', label: 'Puzzles', icon: 'puzzle' },
  { id: 'learn', label: 'Learn', icon: 'book' },
  { id: 'analysis', label: 'Analysis', icon: 'analysis' },
  { id: 'watch', label: 'Watch', icon: 'watch' },
  { id: 'community', label: 'Community', icon: 'users' }
];

const timeControls = [
  { id: 'bullet', label: '1 min', meta: 'Bullet' },
  { id: 'blitz', label: '3|2', meta: 'Blitz' },
  { id: 'rapid', label: '10|5', meta: 'Rapid' },
  { id: 'daily', label: 'Daily', meta: 'Correspondence' }
];

const puzzles = [
  {
    title: 'Back rank tactic',
    theme: 'Mate in 1',
    fen: '6k1/5ppp/8/8/8/8/5PPP/6RK w - - 0 1',
    solution: ['Re8#'],
    hint: 'Use the open file and the trapped king.'
  },
  {
    title: 'Fork the queen',
    theme: 'Knight fork',
    fen: 'r3k2r/ppp2ppp/2n5/3q4/3P4/2N2N2/PPP2PPP/R2QKB1R w KQkq - 0 1',
    solution: ['Nxd5'],
    hint: 'A central knight captures with tempo.'
  },
  {
    title: 'Win the rook',
    theme: 'Skewer',
    fen: '4r1k1/5ppp/8/8/8/5Q2/5PPP/6K1 w - - 0 1',
    solution: ['Qd5'],
    hint: 'Check first, then collect the heavy piece.'
  }
];

const lessons = [
  { title: 'Opening principles', progress: 86, text: 'Control the center, develop minor pieces, castle before launching attacks.' },
  { title: 'Tactical vision', progress: 58, text: 'Train pins, forks, skewers, discovered attacks, and forcing move checks.' },
  { title: 'Endgame basics', progress: 42, text: 'Convert king and pawn endings with opposition, outside passers, and activity.' }
];

const events = [
  { title: 'Rapid Arena', status: 'Live', players: 128, time: '10|5' },
  { title: 'Weekend Swiss', status: 'Registering', players: 64, time: '15|10' },
  { title: 'Puzzle Storm', status: 'Open', players: 420, time: '3 min' }
];

const leaderboard = [
  { name: 'NakamuraFan', rating: 2681, streak: '+18' },
  { name: 'BangkokBishop', rating: 2440, streak: '+11' },
  { name: 'EndgameLab', rating: 2312, streak: '+7' },
  { name: 'KnightShift', rating: 2204, streak: '+5' }
];

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

function legalMovesBySquare(game) {
  const moves = {};
  for (const move of game.moves({ verbose: true })) {
    moves[move.from] ||= [];
    moves[move.from].push({
      from: move.from,
      to: move.to,
      san: move.san,
      flags: move.flags,
      promotion: move.promotion || null
    });
  }
  return moves;
}

function roomFromGame(game, lastMove = null) {
  return {
    board: game.board(),
    legalMoves: legalMovesBySquare(game),
    lastMove
  };
}

function App() {
  const identity = useMemo(getStoredIdentity, []);
  const [clientId] = useState(identity.clientId);
  const [name, setName] = useState(identity.name);
  const [activeSection, setActiveSection] = useState(getInitialRoomId() ? 'play' : 'home');
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

  function leaveRoom() {
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url);
    setRoomId('');
    setRoom(null);
    setConnected(false);
  }

  function enterRoom(nextRoomId) {
    const trimmed = normalizeRoomInput(nextRoomId);
    if (!trimmed) return;

    const url = new URL(window.location.href);
    url.searchParams.set('room', trimmed);
    window.history.replaceState({}, '', url);
    setActiveSection('play');
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

  function navigate(sectionId) {
    setActiveSection(sectionId);
    if (sectionId !== 'play' && roomId) leaveRoom();
  }

  return (
    <div className="platform-shell">
      <aside className="app-sidebar" aria-label="Main navigation">
        <div className="brand sidebar-brand">
          <Icon name="swords" />
          <div>
            <strong>Chess Arena</strong>
            <span>Play · Train · Watch</span>
          </div>
        </div>
        <nav className="main-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={activeSection === item.id ? 'active' : ''}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <span className={connected ? 'status-dot live' : 'status-dot'} />
          <span>{room ? (connected ? 'Live room' : 'Connecting') : 'Ready'}</span>
        </div>
      </aside>

      <main className="app-shell">
        <section className="topbar" aria-label="Game navigation">
          <div>
            <span className="eyebrow">{activeSection}</span>
            <h1 className="page-title">{room ? `Room ${room.id}` : sectionTitle(activeSection)}</h1>
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
              {room ? (connected ? 'online' : 'connecting') : 'offline-ready'}
            </span>
          </div>
        </section>

        {room ? (
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
            leaveRoom={leaveRoom}
          />
        ) : (
          <SectionRenderer
            section={activeSection}
            setActiveSection={setActiveSection}
            joinInput={joinInput}
            setJoinInput={setJoinInput}
            createRoom={createRoom}
            enterRoom={enterRoom}
            notice={notice}
          />
        )}

        {pendingPromotion && <PromotionDialog choosePromotion={choosePromotion} />}
      </main>
    </div>
  );
}

function sectionTitle(section) {
  const titles = {
    home: 'Command center',
    play: 'Play chess',
    puzzles: 'Puzzle trainer',
    learn: 'Training academy',
    analysis: 'Analysis board',
    watch: 'Live events',
    community: 'Community hub'
  };
  return titles[section] || 'Chess Arena';
}

function SectionRenderer(props) {
  if (props.section === 'play') return <PlayCenter {...props} />;
  if (props.section === 'puzzles') return <PuzzleTrainer />;
  if (props.section === 'learn') return <LearnCenter />;
  if (props.section === 'analysis') return <AnalysisLab />;
  if (props.section === 'watch') return <WatchCenter />;
  if (props.section === 'community') return <CommunityCenter />;
  return <HomeDashboard setActiveSection={props.setActiveSection} createRoom={props.createRoom} />;
}

function HomeDashboard({ setActiveSection, createRoom }) {
  return (
    <section className="dashboard-grid">
      <div className="hero-board">
        <MiniBoard />
        <div className="hero-actions">
          <span className="eyebrow">Today</span>
          <h2>One place to play, solve, study, analyze, and follow chess.</h2>
          <div className="hero-buttons">
            <button className="primary-action" onClick={createRoom}>
              <Icon name="bolt" />
              New online game
            </button>
            <button onClick={() => setActiveSection('puzzles')}>
              <Icon name="puzzle" />
              Solve puzzles
            </button>
          </div>
        </div>
      </div>

      <StatsStrip />

      <div className="tile-grid">
        <FeatureTile icon="play" title="Play" text="Online rooms, bot games, time controls, resign, draw offers, and rematches." onClick={() => setActiveSection('play')} />
        <FeatureTile icon="puzzle" title="Puzzles" text="Tactics trainer with hints, solutions, and theme cards." onClick={() => setActiveSection('puzzles')} />
        <FeatureTile icon="analysis" title="Analysis" text="Load FEN, explore legal moves, and inspect move history." onClick={() => setActiveSection('analysis')} />
        <FeatureTile icon="watch" title="Watch" text="Event cards, tournament schedule, and featured games." onClick={() => setActiveSection('watch')} />
      </div>
    </section>
  );
}

function StatsStrip() {
  const stats = [
    ['Rapid', '1248'],
    ['Puzzle', '1810'],
    ['Games', '37'],
    ['Accuracy', '82%']
  ];
  return (
    <div className="stats-strip">
      {stats.map(([label, value]) => (
        <div key={label}>
          <span className="label">{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function FeatureTile({ icon, title, text, onClick }) {
  return (
    <button className="feature-tile" onClick={onClick}>
      <Icon name={icon} />
      <strong>{title}</strong>
      <span>{text}</span>
    </button>
  );
}

function PlayCenter({ joinInput, setJoinInput, createRoom, enterRoom, notice }) {
  return (
    <section className="play-layout">
      <div className="mode-panel">
        <OnlineLobby
          joinInput={joinInput}
          setJoinInput={setJoinInput}
          createRoom={createRoom}
          enterRoom={enterRoom}
          notice={notice}
        />
        <div className="time-grid">
          {timeControls.map((control) => (
            <button key={control.id} onClick={createRoom}>
              <strong>{control.label}</strong>
              <span>{control.meta}</span>
            </button>
          ))}
        </div>
      </div>
      <BotArena />
    </section>
  );
}

function OnlineLobby({ joinInput, setJoinInput, createRoom, enterRoom, notice }) {
  return (
    <section className="join-box play-card">
      <div>
        <span className="eyebrow">Online</span>
        <h2>Challenge a friend</h2>
        <p>Create a room, share the link, or paste an invite URL.</p>
      </div>
      <button className="primary-action" onClick={createRoom}>
        <Icon name="plus" />
        Create room
      </button>
      <div className="join-row">
        <input
          value={joinInput}
          onChange={(event) => setJoinInput(event.target.value)}
          placeholder="Room code or invite link"
          aria-label="Room code"
        />
        <button onClick={() => enterRoom(joinInput)}>Join</button>
      </div>
      {notice && <p className="notice">{notice}</p>}
    </section>
  );
}

function BotArena() {
  const [fen, setFen] = useState(new Chess().fen());
  const [selected, setSelected] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [botLevel, setBotLevel] = useState('balanced');
  const game = useMemo(() => new Chess(fen), [fen]);
  const playerTurn = game.turn() === 'w' && !game.isGameOver();

  function makeBotMove(nextGame) {
    if (nextGame.isGameOver()) return;
    const legal = nextGame.moves({ verbose: true });
    const captures = legal.filter((move) => move.captured);
    const checks = legal.filter((move) => move.san.includes('+') || move.san.includes('#'));
    const pool = botLevel === 'sharp' && (checks.length || captures.length) ? [...checks, ...captures] : legal;
    const move = pool[Math.floor(Math.random() * pool.length)];
    const played = nextGame.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    setLastMove({ from: played.from, to: played.to });
    setFen(nextGame.fen());
  }

  function handleBotSquare(square) {
    if (!playerTurn) return;
    const piece = pieceAt(game.board(), square);
    const selectedPiece = pieceAt(game.board(), selected);

    if (piece?.color === 'w' && (!selected || selected === square)) {
      setSelected(square);
      return;
    }

    if (!selected) return;
    const move = (legalMovesBySquare(game)[selected] || []).find((candidate) => candidate.to === square);
    if (!move) {
      setSelected(piece?.color === 'w' ? square : null);
      return;
    }

    const nextGame = new Chess(fen);
    const promotion = isPromotionMove(selectedPiece, square) ? 'q' : undefined;
    const played = nextGame.move({ from: selected, to: square, promotion });
    setSelected(null);
    setLastMove({ from: played.from, to: played.to });
    setFen(nextGame.fen());
    window.setTimeout(() => makeBotMove(nextGame), 450);
  }

  function reset() {
    setFen(new Chess().fen());
    setSelected(null);
    setLastMove(null);
  }

  return (
    <section className="bot-arena">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Computer</span>
          <h2>Play the bot</h2>
        </div>
        <select value={botLevel} onChange={(event) => setBotLevel(event.target.value)}>
          <option value="balanced">Balanced</option>
          <option value="sharp">Sharp</option>
        </select>
      </div>
      <ChessBoard room={roomFromGame(game, lastMove)} selected={selected} flipped={false} handleSquare={handleBotSquare} compact />
      <div className="bot-footer">
        <strong>{game.isGameOver() ? 'Game over' : playerTurn ? 'Your move' : 'Bot thinking'}</strong>
        <button onClick={reset}>
          <Icon name="rotate" />
          New bot game
        </button>
      </div>
    </section>
  );
}

function PuzzleTrainer() {
  const [index, setIndex] = useState(0);
  const [fen, setFen] = useState(puzzles[0].fen);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('Find the best move.');
  const [lastMove, setLastMove] = useState(null);
  const puzzle = puzzles[index];
  const game = useMemo(() => new Chess(fen), [fen]);

  function loadPuzzle(nextIndex) {
    const next = (nextIndex + puzzles.length) % puzzles.length;
    setIndex(next);
    setFen(puzzles[next].fen);
    setSelected(null);
    setLastMove(null);
    setStatus('Find the best move.');
  }

  function handlePuzzleSquare(square) {
    const piece = pieceAt(game.board(), square);
    if (piece?.color === game.turn() && (!selected || selected === square)) {
      setSelected(square);
      return;
    }
    if (!selected) return;

    const move = (legalMovesBySquare(game)[selected] || []).find((candidate) => candidate.to === square);
    if (!move) {
      setSelected(piece ? square : null);
      return;
    }

    const nextGame = new Chess(fen);
    const played = nextGame.move({ from: selected, to: square, promotion: move.promotion || 'q' });
    setLastMove({ from: played.from, to: played.to });
    setSelected(null);

    if (played.san === puzzle.solution[0]) {
      setStatus(`Correct: ${played.san}`);
      setFen(nextGame.fen());
    } else {
      setStatus(`Try again. Hint: ${puzzle.hint}`);
    }
  }

  return (
    <section className="training-layout">
      <div className="trainer-board">
        <ChessBoard room={roomFromGame(game, lastMove)} selected={selected} flipped={false} handleSquare={handlePuzzleSquare} compact />
      </div>
      <aside className="training-panel">
        <span className="eyebrow">{puzzle.theme}</span>
        <h2>{puzzle.title}</h2>
        <p>{status}</p>
        <div className="solution-box">
          <span className="label">Solution</span>
          <strong>{puzzle.solution.join(' ')}</strong>
        </div>
        <button onClick={() => setStatus(`Hint: ${puzzle.hint}`)}>Hint</button>
        <button className="primary-action" onClick={() => loadPuzzle(index + 1)}>Next puzzle</button>
      </aside>
    </section>
  );
}

function LearnCenter() {
  return (
    <section className="content-grid">
      {lessons.map((lesson) => (
        <article className="learning-card" key={lesson.title}>
          <span className="eyebrow">Lesson</span>
          <h2>{lesson.title}</h2>
          <p>{lesson.text}</p>
          <div className="progress-track">
            <span style={{ width: `${lesson.progress}%` }} />
          </div>
          <strong>{lesson.progress}% complete</strong>
        </article>
      ))}
      <article className="learning-card wide-card">
        <span className="eyebrow">Drills</span>
        <h2>Training plan</h2>
        <div className="drill-list">
          <span>10 tactics</span>
          <span>1 rapid game</span>
          <span>Review 3 mistakes</span>
          <span>Endgame repetition</span>
        </div>
      </article>
    </section>
  );
}

function AnalysisLab() {
  const [fenInput, setFenInput] = useState(new Chess().fen());
  const [fen, setFen] = useState(fenInput);
  const [selected, setSelected] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [error, setError] = useState('');
  const game = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);

  function loadFen() {
    try {
      const next = new Chess(fenInput);
      setFen(next.fen());
      setError('');
      setSelected(null);
      setLastMove(null);
    } catch {
      setError('Invalid FEN');
    }
  }

  function handleAnalysisSquare(square) {
    const piece = pieceAt(game.board(), square);
    if (piece?.color === game.turn() && (!selected || selected === square)) {
      setSelected(square);
      return;
    }
    if (!selected) return;

    const move = (legalMovesBySquare(game)[selected] || []).find((candidate) => candidate.to === square);
    if (!move) {
      setSelected(piece ? square : null);
      return;
    }

    const nextGame = new Chess(fen);
    const played = nextGame.move({ from: selected, to: square, promotion: move.promotion || 'q' });
    setFen(nextGame.fen());
    setFenInput(nextGame.fen());
    setLastMove({ from: played.from, to: played.to });
    setSelected(null);
  }

  return (
    <section className="analysis-layout">
      <div>
        <ChessBoard room={roomFromGame(game, lastMove)} selected={selected} flipped={false} handleSquare={handleAnalysisSquare} compact />
      </div>
      <aside className="analysis-panel">
        <span className="eyebrow">Engine room</span>
        <h2>Analysis board</h2>
        <textarea value={fenInput} onChange={(event) => setFenInput(event.target.value)} aria-label="FEN input" />
        <div className="room-actions">
          <button onClick={loadFen}>Load FEN</button>
          <button onClick={() => {
            const start = new Chess().fen();
            setFen(start);
            setFenInput(start);
            setLastMove(null);
            setSelected(null);
            setError('');
          }}>
            Reset
          </button>
        </div>
        {error && <p className="notice">{error}</p>}
        <div className="analysis-readout">
          <span>Turn</span>
          <strong>{game.turn() === 'w' ? 'White' : 'Black'}</strong>
          <span>Legal moves</span>
          <strong>{game.moves().length}</strong>
          <span>Status</span>
          <strong>{game.isGameOver() ? 'Game over' : game.inCheck() ? 'Check' : 'Playable'}</strong>
        </div>
      </aside>
    </section>
  );
}

function WatchCenter() {
  return (
    <section className="content-grid">
      {events.map((event) => (
        <article className="event-card" key={event.title}>
          <span className={`event-status ${event.status.toLowerCase()}`}>{event.status}</span>
          <h2>{event.title}</h2>
          <div className="event-meta">
            <span>{event.players} players</span>
            <span>{event.time}</span>
          </div>
          <MiniBoard small />
          <button>Open event</button>
        </article>
      ))}
    </section>
  );
}

function CommunityCenter() {
  return (
    <section className="community-layout">
      <article className="leaderboard-card">
        <span className="eyebrow">Leaderboard</span>
        <h2>Top club players</h2>
        {leaderboard.map((player, index) => (
          <div className="rank-row" key={player.name}>
            <span>{index + 1}</span>
            <strong>{player.name}</strong>
            <em>{player.rating}</em>
            <small>{player.streak}</small>
          </div>
        ))}
      </article>
      <article className="community-card">
        <span className="eyebrow">Club</span>
        <h2>Daily agenda</h2>
        <p>Post-game reviews, challenge rooms, weekly swiss events, and puzzle ladders live here.</p>
        <div className="drill-list">
          <span>Club chat</span>
          <span>Member challenges</span>
          <span>Study groups</span>
          <span>Announcements</span>
        </div>
      </article>
    </section>
  );
}

function MiniBoard({ small = false }) {
  const pattern = [
    'rnbqkbnr',
    'pppppppp',
    '........',
    '....P...',
    '........',
    '.....N..',
    'PPPP.PPP',
    'RNBQKB.R'
  ];
  return (
    <div className={small ? 'mini-board small' : 'mini-board'}>
      {pattern.flatMap((rank, row) =>
        rank.split('').map((piece, col) => (
          <span className={(row + col) % 2 ? 'dark' : 'light'} key={`${row}-${col}`}>
            {piece !== '.' ? piece : ''}
          </span>
        ))
      )}
    </div>
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
  sendChat,
  leaveRoom
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
          <button onClick={leaveRoom}>Back to hub</button>
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

function ChessBoard({ room, selected, flipped, handleSquare, compact = false }) {
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

  return <div className={compact ? 'board compact-board' : 'board'}>{cells}</div>;
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
