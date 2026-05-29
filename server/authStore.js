import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const USERNAME_RE = /^[a-zA-Z0-9_ -]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function normalizeUsername(username) {
  return String(username || '').trim().replace(/\s+/g, ' ');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  const candidate = Buffer.from(hashPassword(password, user.salt).hash, 'hex');
  const expected = Buffer.from(user.passwordHash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export class AuthStore {
  constructor({ filePath } = {}) {
    this.filePath = filePath || path.join(process.cwd(), 'data', 'auth.json');
    this.users = new Map();
    this.sessions = new Map();
    this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.save();
      return;
    }

    const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8') || '{}');
    this.users = new Map((data.users || []).map((user) => [user.id, user]));
    this.sessions = new Map((data.sessions || []).map((session) => [session.token, session]));
    this.pruneSessions();
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(
      this.filePath,
      JSON.stringify(
        {
          users: Array.from(this.users.values()),
          sessions: Array.from(this.sessions.values())
        },
        null,
        2
      )
    );
  }

  register({ username, email, password }) {
    const now = Date.now();
    const cleanUsername = normalizeUsername(username);
    const cleanEmail = normalizeEmail(email);

    this.validateUsername(cleanUsername);
    this.validateEmail(cleanEmail);
    this.validatePassword(password);
    this.assertUnique(cleanUsername, cleanEmail);

    const passwordData = hashPassword(password);
    const user = {
      id: `user_${randomBytes(10).toString('hex')}`,
      username: cleanUsername,
      email: cleanEmail,
      salt: passwordData.salt,
      passwordHash: passwordData.hash,
      createdAt: now,
      updatedAt: now
    };
    this.users.set(user.id, user);
    const session = this.createSession(user.id);
    this.save();
    return { user: publicUser(user), token: session.token };
  }

  login({ login, password }) {
    const identifier = String(login || '').trim().toLowerCase();
    const user = Array.from(this.users.values()).find(
      (candidate) => candidate.email === identifier || candidate.username.toLowerCase() === identifier
    );

    if (!user || !verifyPassword(String(password || ''), user)) {
      throw new AuthError('Invalid username/email or password', 401);
    }

    const session = this.createSession(user.id);
    this.save();
    return { user: publicUser(user), token: session.token };
  }

  logout(token) {
    if (token) this.sessions.delete(token);
    this.save();
  }

  updateProfile(userId, { username }) {
    const user = this.users.get(userId);
    if (!user) throw new AuthError('Account not found', 404);

    const cleanUsername = normalizeUsername(username);
    this.validateUsername(cleanUsername);
    const duplicate = Array.from(this.users.values()).find(
      (candidate) => candidate.id !== user.id && candidate.username.toLowerCase() === cleanUsername.toLowerCase()
    );
    if (duplicate) throw new AuthError('Username is already taken', 409);

    user.username = cleanUsername;
    user.updatedAt = Date.now();
    this.save();
    return publicUser(user);
  }

  authenticate(token) {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;

    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      this.save();
      return null;
    }

    const user = this.users.get(session.userId);
    if (!user) {
      this.sessions.delete(token);
      this.save();
      return null;
    }

    session.lastSeen = Date.now();
    this.save();
    return { token, user: publicUser(user) };
  }

  createSession(userId) {
    const now = Date.now();
    const session = {
      token: randomBytes(32).toString('hex'),
      userId,
      createdAt: now,
      lastSeen: now,
      expiresAt: now + SESSION_TTL_MS
    };
    this.sessions.set(session.token, session);
    return session;
  }

  pruneSessions() {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now || !this.users.has(session.userId)) {
        this.sessions.delete(token);
      }
    }
    this.save();
  }

  assertUnique(username, email) {
    const lowerUsername = username.toLowerCase();
    for (const user of this.users.values()) {
      if (user.username.toLowerCase() === lowerUsername) throw new AuthError('Username is already taken', 409);
      if (user.email === email) throw new AuthError('Email is already registered', 409);
    }
  }

  validateUsername(username) {
    if (!USERNAME_RE.test(username)) {
      throw new AuthError('Username must be 3-24 characters and use letters, numbers, spaces, _ or -');
    }
  }

  validateEmail(email) {
    if (!EMAIL_RE.test(email)) throw new AuthError('Enter a valid email address');
  }

  validatePassword(password) {
    if (String(password || '').length < 8) throw new AuthError('Password must be at least 8 characters');
  }
}
