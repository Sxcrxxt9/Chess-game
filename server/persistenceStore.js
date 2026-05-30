import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';

const DEFAULT_DB_NAME = 'chess.sqlite';

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function createPersistenceStore({ filePath } = {}) {
  const SQL = await initSqlJs();
  return new PersistenceStore(SQL, { filePath });
}

export class PersistenceStore {
  constructor(SQL, { filePath } = {}) {
    this.filePath = filePath || path.join(process.cwd(), 'data', DEFAULT_DB_NAME);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const bytes = fs.existsSync(this.filePath) ? fs.readFileSync(this.filePath) : null;
    this.db = bytes?.length ? new SQL.Database(bytes) : new SQL.Database();
    this.migrate();
    this.save();
  }

  migrate() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        salt TEXT NOT NULL,
        passwordHash TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        lastSeen INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profiles (
        clientId TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        resultType TEXT,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        fen TEXT NOT NULL,
        name TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (userId);
      CREATE INDEX IF NOT EXISTS idx_rooms_updated ON rooms (updatedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_profiles_updated ON profiles (updatedAt DESC);
    `);
  }

  all(sql, params = []) {
    const statement = this.db.prepare(sql);
    const rows = [];
    try {
      statement.bind(params);
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }

  get(sql, params = []) {
    return this.all(sql, params)[0] || null;
  }

  run(sql, params = [], { persist = true } = {}) {
    this.db.run(sql, params);
    if (persist) this.save();
  }

  transaction(callback) {
    this.db.run('BEGIN');
    try {
      const result = callback();
      this.db.run('COMMIT');
      this.save();
      return result;
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  save() {
    fs.writeFileSync(this.filePath, Buffer.from(this.db.export()));
  }

  close() {
    this.save();
    this.db.close();
  }

  listUsers() {
    return this.all('SELECT * FROM users ORDER BY createdAt ASC');
  }

  listSessions() {
    return this.all('SELECT * FROM sessions ORDER BY createdAt ASC');
  }

  saveAuthState(users, sessions) {
    this.transaction(() => {
      this.run('DELETE FROM users', [], { persist: false });
      this.run('DELETE FROM sessions', [], { persist: false });
      for (const user of users) {
        this.run(
          `INSERT INTO users (id, username, email, salt, passwordHash, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [user.id, user.username, user.email, user.salt, user.passwordHash, user.createdAt, user.updatedAt],
          { persist: false }
        );
      }
      for (const session of sessions) {
        this.run(
          `INSERT INTO sessions (token, userId, createdAt, lastSeen, expiresAt)
           VALUES (?, ?, ?, ?, ?)`,
          [session.token, session.userId, session.createdAt, session.lastSeen, session.expiresAt],
          { persist: false }
        );
      }
    });
  }

  listProfiles() {
    return this.all('SELECT data FROM profiles').map((row) => parseJson(row.data)).filter(Boolean);
  }

  saveProfile(profile) {
    this.run(
      `INSERT INTO profiles (clientId, data, updatedAt)
       VALUES (?, ?, ?)
       ON CONFLICT(clientId) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt`,
      [profile.clientId, JSON.stringify(profile), Date.now()]
    );
  }

  getAppState(key, fallback = null) {
    const row = this.get('SELECT data FROM app_state WHERE key = ?', [key]);
    return parseJson(row?.data, fallback);
  }

  saveAppState(key, data) {
    this.run(
      `INSERT INTO app_state (key, data, updatedAt)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt`,
      [key, JSON.stringify(data), Date.now()]
    );
  }

  listRoomStates() {
    return this.all('SELECT state FROM rooms ORDER BY updatedAt DESC').map((row) => parseJson(row.state)).filter(Boolean);
  }

  saveRoomState(state) {
    this.run(
      `INSERT INTO rooms (id, state, resultType, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state = excluded.state, resultType = excluded.resultType, updatedAt = excluded.updatedAt`,
      [state.id, JSON.stringify(state), state.result?.type || null, state.updatedAt || Date.now()]
    );
  }

  saveAnalysis(analysis) {
    this.run(
      `INSERT INTO analyses (id, fen, name, createdAt, data)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET fen = excluded.fen, name = excluded.name, data = excluded.data`,
      [analysis.id, analysis.fen, analysis.name, analysis.createdAt, JSON.stringify(analysis)]
    );
  }

  getAnalysis(id) {
    const row = this.get('SELECT data FROM analyses WHERE id = ?', [id]);
    return parseJson(row?.data);
  }

  stats() {
    return {
      users: this.get('SELECT COUNT(*) AS count FROM users')?.count || 0,
      profiles: this.get('SELECT COUNT(*) AS count FROM profiles')?.count || 0,
      rooms: this.get('SELECT COUNT(*) AS count FROM rooms')?.count || 0,
      analyses: this.get('SELECT COUNT(*) AS count FROM analyses')?.count || 0
    };
  }
}
