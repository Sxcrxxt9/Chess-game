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

const defaultPlatform = {
  profile: {
    rapid: 1248,
    puzzle: 1810,
    games: 0,
    wins: 0,
    botGames: 0,
    puzzlesSolved: 0,
    lessonsCompleted: 0,
    eventsJoined: 0,
    accuracy: 82,
    streak: 0
  },
  puzzles,
  lessons,
  events,
  leaderboard,
  recentGames: [],
  matchmaking: { queued: 0 },
  tournaments: [],
  observability: { requests: 0, errors: 0, avgLatencyMs: 0 },
  engine: { size: 1, active: 0, queued: 0 },
  timeControls
};

function Icon({ name }) {
  return (
    <span className="ui-icon" aria-hidden="true">
      {iconGlyphs[name]}
    </span>
  );
}

function getStoredIdentity() {
  const storedClientId = window.sessionStorage.getItem('chess-client-id');
  const clientId = storedClientId || crypto.randomUUID();
  window.sessionStorage.setItem('chess-client-id', clientId);
  return {
    clientId,
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
  const [authToken, setAuthToken] = useState(() => window.localStorage.getItem('chess-auth-token') || '');
  const [authUser, setAuthUser] = useState(null);
  const [authMode, setAuthMode] = useState(null);
  const [authForm, setAuthForm] = useState({ username: '', email: '', login: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
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
  const [platform, setPlatform] = useState(defaultPlatform);
  const eventsRef = useRef(null);
  const playerClientId = authUser?.id || clientId;
  const playerName = authUser?.username || name || 'Guest';

  useEffect(() => {
    if (!authUser) window.localStorage.setItem('chess-player-name', name);
  }, [authUser, name]);

  useEffect(() => {
    refreshPlatform();
  }, [playerClientId, playerName, authToken]);

  useEffect(() => {
    if (!authToken) {
      setAuthUser(null);
      return undefined;
    }

    let cancelled = false;

    async function restoreSession() {
      try {
        const response = await fetch(`${apiBase}/api/auth/me`, { headers: authHeaders() });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Session expired');
        if (!cancelled) {
          setAuthUser(data.user);
          setName(data.user.username);
        }
      } catch {
        if (!cancelled) {
          window.localStorage.removeItem('chess-auth-token');
          setAuthToken('');
          setAuthUser(null);
        }
      }
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, [authToken]);

  useEffect(() => {
    if (!roomId) return undefined;

    let cancelled = false;

    async function joinAndSubscribe() {
      try {
        await postRoomAction(roomId, 'join', { clientId: playerClientId, name: playerName });
        if (cancelled) return;

        eventsRef.current?.close();
        const streamUrl = new URL(`${apiBase}/api/rooms/${roomId}/events`);
        streamUrl.searchParams.set('clientId', playerClientId);
        streamUrl.searchParams.set('name', playerName);
        if (authToken) streamUrl.searchParams.set('token', authToken);
        const stream = new EventSource(streamUrl);
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
  }, [playerClientId, playerName, authToken, roomId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const viewerColor = room?.players.white?.clientId === playerClientId ? 'w' : room?.players.black?.clientId === playerClientId ? 'b' : null;
  const viewerRole = viewerColor === 'w' ? 'white' : viewerColor === 'b' ? 'black' : room ? 'spectator' : 'guest';
  const hasBothPlayers = Boolean(room?.players.white && room?.players.black);
  const canAct = Boolean(viewerColor && room && hasBothPlayers && !room.result);
  const inviteUrl = room ? `${window.location.origin}${window.location.pathname}?room=${room.id}` : '';

  function authHeaders(headers = {}) {
    return authToken ? { ...headers, Authorization: `Bearer ${authToken}` } : headers;
  }

  function updateAuthForm(field, value) {
    setAuthForm((current) => ({ ...current, [field]: value }));
  }

  function openAuth(nextMode) {
    setAuthMode(nextMode);
    setAuthError('');
    setAuthForm({
      username: authUser?.username || name,
      email: authUser?.email || '',
      login: authUser?.email || '',
      password: ''
    });
  }

  async function submitAuth(event) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError('');

    try {
      const isProfile = authMode === 'profile';
      const endpoint = isProfile ? '/api/auth/profile' : `/api/auth/${authMode}`;
      const method = isProfile ? 'PATCH' : 'POST';
      const payload =
        authMode === 'login'
          ? { login: authForm.login, password: authForm.password }
          : isProfile
            ? { username: authForm.username }
            : { username: authForm.username, email: authForm.email, password: authForm.password };
      const response = await fetch(`${apiBase}${endpoint}`, {
        method,
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Authentication failed');

      if (data.token) {
        window.localStorage.setItem('chess-auth-token', data.token);
        setAuthToken(data.token);
      }
      setAuthUser(data.user);
      setName(data.user.username);
      setAuthMode(null);
      setAuthForm({ username: '', email: '', login: '', password: '' });
    } catch (error) {
      setAuthError(error.message || 'Authentication failed');
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    try {
      await fetch(`${apiBase}/api/auth/logout`, { method: 'POST', headers: authHeaders() });
    } catch {
      // Local logout still clears the browser session if the network is unavailable.
    }
    window.localStorage.removeItem('chess-auth-token');
    setAuthToken('');
    setAuthUser(null);
    setAuthMode(null);
  }

  async function refreshPlatform() {
    try {
      const response = await fetch(
        `${apiBase}/api/platform?clientId=${encodeURIComponent(playerClientId)}&name=${encodeURIComponent(playerName)}`,
        { headers: authHeaders() }
      );
      if (!response.ok) throw new Error('Platform unavailable');
      setPlatform(await response.json());
    } catch {
      setNotice('Online platform data is reconnecting');
    }
  }

  async function postPlatformAction(path, payload = {}) {
    const response = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ clientId: playerClientId, name: playerName, ...payload })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    if (data.profile || data.leaderboard || data.events || data.tournaments || data.matchmaking || data.observability) {
      setPlatform((current) => ({ ...current, ...data }));
    }
    return data;
  }

  async function createRoom(timeControl = 'rapid') {
    const selectedTimeControl = typeof timeControl === 'string' ? timeControl : 'rapid';
    try {
      const response = await fetch(`${apiBase}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeControl: selectedTimeControl })
      });
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
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function emit(eventName, payload = {}) {
    const action = eventName.replace('room:', '');
    try {
      await postRoomAction(roomId, action, { clientId: playerClientId, name: playerName, ...payload });
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

  async function reportRoom() {
    if (!room) return;
    try {
      await postPlatformAction('/api/moderation/report', {
        roomId: room.id,
        targetId: room.players.white?.clientId === playerClientId ? room.players.black?.clientId : room.players.white?.clientId,
        reason: 'In-room player report'
      });
      setNotice('Report sent to moderation');
    } catch (error) {
      setNotice(error.message || 'Could not send report');
    }
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
          <AuthPanel
            authUser={authUser}
            name={name}
            setName={setName}
            connected={connected}
            room={room}
            openAuth={openAuth}
            logout={logout}
          />
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
            reportRoom={reportRoom}
          />
        ) : (
          <SectionRenderer
            section={activeSection}
            setActiveSection={setActiveSection}
            platform={platform}
            clientId={playerClientId}
            name={playerName}
            postPlatformAction={postPlatformAction}
            joinInput={joinInput}
            setJoinInput={setJoinInput}
            createRoom={createRoom}
            enterRoom={enterRoom}
            notice={notice}
          />
        )}

        {pendingPromotion && <PromotionDialog choosePromotion={choosePromotion} />}
        {authMode && (
          <AuthDialog
            mode={authMode}
            form={authForm}
            error={authError}
            busy={authBusy}
            updateForm={updateAuthForm}
            submitAuth={submitAuth}
            close={() => setAuthMode(null)}
            switchMode={openAuth}
          />
        )}
      </main>
    </div>
  );
}

function AuthPanel({ authUser, name, setName, connected, room, openAuth, logout }) {
  const connectionLabel = room ? (connected ? 'online' : 'connecting') : 'offline-ready';

  if (authUser) {
    return (
      <div className="profile auth-profile">
        <div className="account-chip">
          <span className="label">Account</span>
          <strong>{authUser.username}</strong>
        </div>
        <button onClick={() => openAuth('profile')}>Edit</button>
        <button onClick={logout}>Logout</button>
        <span className={`connection ${connected ? 'online' : ''}`}>{connectionLabel}</span>
      </div>
    );
  }

  return (
    <div className="profile auth-profile">
      <input
        aria-label="Player name"
        maxLength={24}
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Guest name"
      />
      <button onClick={() => openAuth('login')}>Login</button>
      <button className="primary-action" onClick={() => openAuth('register')}>Register</button>
      <span className={`connection ${connected ? 'online' : ''}`}>{connectionLabel}</span>
    </div>
  );
}

function AuthDialog({ mode, form, error, busy, updateForm, submitAuth, close, switchMode }) {
  const isLogin = mode === 'login';
  const isRegister = mode === 'register';
  const isProfile = mode === 'profile';
  const title = isProfile ? 'Edit account' : isLogin ? 'Login' : 'Create account';

  return (
    <div className="auth-backdrop" role="presentation">
      <form className="auth-dialog" onSubmit={submitAuth}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Account</span>
            <h2>{title}</h2>
          </div>
          <button type="button" onClick={close}>Close</button>
        </div>

        {(isRegister || isProfile) && (
          <label>
            <span className="label">Username</span>
            <input
              value={form.username}
              onChange={(event) => updateForm('username', event.target.value)}
              minLength={3}
              maxLength={24}
              required
            />
          </label>
        )}

        {isRegister && (
          <label>
            <span className="label">Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => updateForm('email', event.target.value)}
              required
            />
          </label>
        )}

        {isLogin && (
          <label>
            <span className="label">Username or email</span>
            <input value={form.login} onChange={(event) => updateForm('login', event.target.value)} required />
          </label>
        )}

        {!isProfile && (
          <label>
            <span className="label">Password</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => updateForm('password', event.target.value)}
              minLength={8}
              required
            />
          </label>
        )}

        {error && <p className="notice">{error}</p>}
        <button className="primary-action" disabled={busy}>
          {busy ? 'Saving...' : title}
        </button>

        {!isProfile && (
          <button type="button" onClick={() => switchMode(isLogin ? 'register' : 'login')}>
            {isLogin ? 'Need an account?' : 'Already registered?'}
          </button>
        )}
      </form>
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
  if (props.section === 'puzzles') return <PuzzleTrainer platform={props.platform} postPlatformAction={props.postPlatformAction} />;
  if (props.section === 'learn') return <LearnCenter platform={props.platform} postPlatformAction={props.postPlatformAction} />;
  if (props.section === 'analysis') return <AnalysisLab postPlatformAction={props.postPlatformAction} />;
  if (props.section === 'watch') return <WatchCenter platform={props.platform} postPlatformAction={props.postPlatformAction} enterRoom={props.enterRoom} />;
  if (props.section === 'community') return <CommunityCenter platform={props.platform} createRoom={props.createRoom} />;
  return <HomeDashboard setActiveSection={props.setActiveSection} createRoom={props.createRoom} platform={props.platform} />;
}

function HomeDashboard({ setActiveSection, createRoom, platform }) {
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

      <StatsStrip profile={platform.profile} />

      <div className="tile-grid">
        <FeatureTile icon="play" title="Play" text="Online rooms, bot games, time controls, resign, draw offers, and rematches." onClick={() => setActiveSection('play')} />
        <FeatureTile icon="puzzle" title="Puzzles" text="Tactics trainer with hints, solutions, and theme cards." onClick={() => setActiveSection('puzzles')} />
        <FeatureTile icon="analysis" title="Analysis" text="Load FEN, explore legal moves, and inspect move history." onClick={() => setActiveSection('analysis')} />
        <FeatureTile icon="watch" title="Watch" text="Event cards, tournament schedule, and featured games." onClick={() => setActiveSection('watch')} />
      </div>

      <RecentGames games={platform.recentGames || []} />
    </section>
  );
}

function RecentGames({ games }) {
  return (
    <section className="history-card">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Saved games</span>
          <h2>Recent history</h2>
        </div>
        <strong>{games.length}</strong>
      </div>
      <div className="history-list">
        {games.length ? (
          games.map((game) => (
            <div className="history-row" key={game.id}>
              <span>{game.mode}</span>
              <strong>{game.color} vs {game.opponent}</strong>
              <em>{game.result?.reason || `${game.moves} moves`}</em>
            </div>
          ))
        ) : (
          <p className="empty-state">Finished and active online games will appear here after they are saved.</p>
        )}
      </div>
    </section>
  );
}

function StatsStrip({ profile }) {
  const stats = [
    ['Rapid', profile.rapid],
    ['Puzzle', profile.puzzle],
    ['Games', profile.games],
    ['Accuracy', `${profile.accuracy}%`]
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

function PlayCenter({ joinInput, setJoinInput, createRoom, enterRoom, notice, platform, postPlatformAction }) {
  const [matchmakingNotice, setMatchmakingNotice] = useState('');

  async function joinMatchmaking(mode = 'rapid') {
    try {
      const data = await postPlatformAction('/api/matchmaking/join', { mode });
      if (data.room?.id) {
        setMatchmakingNotice('Match found');
        enterRoom(data.room.id);
      } else {
        setMatchmakingNotice(`Queued for ${mode}. Waiting players: ${data.queue || 1}`);
      }
    } catch (error) {
      setMatchmakingNotice(error.message || 'Matchmaking unavailable');
    }
  }

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
          {platform.timeControls.map((control) => (
            <button key={control.id} onClick={() => createRoom(control.id)}>
              <strong>{control.label}</strong>
              <span>{control.meta}</span>
            </button>
          ))}
        </div>
        <section className="join-box play-card">
          <div>
            <span className="eyebrow">Matchmaking</span>
            <h2>Rated queue</h2>
            <p>{matchmakingNotice || `${platform.matchmaking?.queued || 0} players waiting`}</p>
          </div>
          <button className="primary-action" onClick={() => joinMatchmaking('rapid')}>
            <Icon name="users" />
            Find rapid match
          </button>
        </section>
      </div>
      <BotArena postPlatformAction={postPlatformAction} />
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

function BotArena({ postPlatformAction }) {
  const [fen, setFen] = useState(new Chess().fen());
  const [selected, setSelected] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [botLevel, setBotLevel] = useState('balanced');
  const reportedFenRef = useRef('');
  const game = useMemo(() => new Chess(fen), [fen]);
  const playerTurn = game.turn() === 'w' && !game.isGameOver();

  useEffect(() => {
    if (!game.isGameOver() || reportedFenRef.current === fen) return;
    reportedFenRef.current = fen;
    const result = game.isCheckmate() ? (game.turn() === 'b' ? 'win' : 'loss') : 'draw';
    postPlatformAction('/api/platform/bot-result', { result }).catch(() => {});
  }, [fen, game, postPlatformAction]);

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
    reportedFenRef.current = '';
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

function PuzzleTrainer({ platform, postPlatformAction }) {
  const [index, setIndex] = useState(0);
  const puzzleSet = platform.puzzles.length ? platform.puzzles : puzzles;
  const [fen, setFen] = useState(puzzleSet[0].fen);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('Find the best move.');
  const [lastMove, setLastMove] = useState(null);
  const puzzle = puzzleSet[index] || puzzleSet[0];
  const game = useMemo(() => new Chess(fen), [fen]);

  function loadPuzzle(nextIndex) {
    const next = (nextIndex + puzzleSet.length) % puzzleSet.length;
    setIndex(next);
    setFen(puzzleSet[next].fen);
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
      postPlatformAction('/api/platform/puzzle-result', { puzzleId: puzzle.id, solved: true }).catch(() => {});
    } else {
      setStatus(`Try again. Hint: ${puzzle.hint}`);
      postPlatformAction('/api/platform/puzzle-result', { puzzleId: puzzle.id, solved: false }).catch(() => {});
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

function LearnCenter({ platform, postPlatformAction }) {
  return (
    <section className="content-grid">
      {platform.lessons.map((lesson) => (
        <article className="learning-card" key={lesson.title}>
          <span className="eyebrow">Lesson</span>
          <h2>{lesson.title}</h2>
          <p>{lesson.text}</p>
          <div className="progress-track">
            <span style={{ width: `${lesson.progress}%` }} />
          </div>
          <strong>{lesson.progress}% complete</strong>
          <button onClick={() => postPlatformAction('/api/platform/lesson-complete', { lessonId: lesson.id }).catch(() => {})}>
            Mark practiced
          </button>
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

function AnalysisLab({ postPlatformAction }) {
  const [fenInput, setFenInput] = useState(new Chess().fen());
  const [fen, setFen] = useState(fenInput);
  const [selected, setSelected] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [error, setError] = useState('');
  const [savedAnalysis, setSavedAnalysis] = useState('');
  const [engineJob, setEngineJob] = useState(null);
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

  async function saveAnalysis() {
    try {
      const data = await postPlatformAction('/api/platform/analysis', { fen });
      setSavedAnalysis(`${window.location.origin}/api/analysis/${data.analysis.id}`);
      setError('');
    } catch {
      setError('Could not save analysis online');
    }
  }

  async function runEngine() {
    try {
      const data = await postPlatformAction('/api/engine/analyze', { fen, depth: 12 });
      setEngineJob(data.job);
      setError('');
    } catch {
      setError('Could not queue engine analysis');
    }
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
          <button onClick={saveAnalysis}>Save online</button>
          <button onClick={runEngine}>Engine queue</button>
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
        {savedAnalysis && <input aria-label="Saved analysis link" value={savedAnalysis} readOnly />}
        {engineJob && (
          <div className="analysis-readout">
            <span>Engine job</span>
            <strong>{engineJob.status}</strong>
            <span>Depth</span>
            <strong>{engineJob.depth}</strong>
          </div>
        )}
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

function WatchCenter({ platform, postPlatformAction, enterRoom }) {
  const [tournamentNotice, setTournamentNotice] = useState('');

  async function register(eventId) {
    const data = await postPlatformAction(`/api/events/${eventId}/register`);
    if (data.room?.id) enterRoom(data.room.id);
  }

  async function registerTournament(tournamentId) {
    try {
      const data = await postPlatformAction(`/api/tournaments/${tournamentId}/register`);
      setTournamentNotice(`${data.tournament.title}: ${data.tournament.status}`);
    } catch (error) {
      setTournamentNotice(error.message || 'Tournament unavailable');
    }
  }

  return (
    <section className="content-grid">
      {platform.events.map((event) => (
        <article className="event-card" key={event.title}>
          <span className={`event-status ${event.status.toLowerCase()}`}>{event.status}</span>
          <h2>{event.title}</h2>
          <div className="event-meta">
            <span>{event.players} players</span>
            <span>{event.time}</span>
          </div>
          <MiniBoard small />
          <button onClick={() => register(event.id)}>Join event room</button>
        </article>
      ))}
      {(platform.tournaments || []).map((tournament) => (
        <article className="event-card" key={tournament.id}>
          <span className="event-status registering">{tournament.status}</span>
          <h2>{tournament.title}</h2>
          <div className="event-meta">
            <span>{tournament.players.length}/{tournament.size} players</span>
            <span>{tournament.rounds.length ? `${tournament.rounds[0].matches.length} matches` : 'Bracket pending'}</span>
          </div>
          <button className="primary-action" onClick={() => registerTournament(tournament.id)}>Register bracket</button>
          {tournament.rounds.map((round) => (
            <div className="bracket-list" key={round.name}>
              <strong>{round.name}</strong>
              {round.matches.map((match) => (
                <span key={match.id}>{match.white.name} vs {match.black.name} · Room {match.roomId}</span>
              ))}
            </div>
          ))}
        </article>
      ))}
      {tournamentNotice && <p className="notice">{tournamentNotice}</p>}
    </section>
  );
}

function CommunityCenter({ platform, createRoom }) {
  return (
    <section className="community-layout">
      <article className="leaderboard-card">
        <span className="eyebrow">Leaderboard</span>
        <h2>Top club players</h2>
        {platform.leaderboard.map((player, index) => (
          <div className="rank-row" key={player.name}>
            <span>{player.rank || index + 1}</span>
            <strong>{player.name}</strong>
            <em>{player.rating}</em>
            <small>{player.streak}</small>
          </div>
        ))}
      </article>
      <article className="community-card">
        <span className="eyebrow">Operations</span>
        <h2>Production console</h2>
        <p>Live queues, request telemetry, engine workers, and moderation-ready club controls.</p>
        <div className="drill-list">
          <span>Requests {platform.observability?.requests || 0}</span>
          <span>Errors {platform.observability?.errors || 0}</span>
          <span>Engine {platform.engine?.active || 0}/{platform.engine?.size || 1}</span>
          <span>Queue {platform.matchmaking?.queued || 0}</span>
        </div>
        <button className="primary-action" onClick={() => createRoom('rapid')}>
          Create club challenge
        </button>
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
  leaveRoom,
  reportRoom
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
          <div className="room-actions">
            <button onClick={leaveRoom}>Back to hub</button>
            <button onClick={reportRoom}>Report</button>
          </div>
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
