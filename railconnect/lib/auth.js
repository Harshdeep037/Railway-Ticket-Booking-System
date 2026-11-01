'use strict';
// Password hashing (scrypt) and signed tokens (HS256 JWT) using only Node's built-in crypto.
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const secretWarning = () => {
  if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET is not set in .env - using a temporary one (everyone is logged out on restart).');
};

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function createToken(user, days = 7) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: user.id, name: user.name, email: user.email, exp: Math.floor(Date.now() / 1000) + days * 86400 });
  return `${head}.${body}.${sign(`${head}.${body}`)}`;
}

function verifyToken(token) {
  const [head, body, sig] = String(token).split('.');
  if (!head || !body || !sig) return null;
  const good = sign(`${head}.${body}`);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

function requireAuth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const p = m && verifyToken(m[1]);
  if (!p) return next(new HttpError(401, 'Please log in to continue.'));
  req.user = { id: p.sub, name: p.name, email: p.email };
  next();
}

// Tiny in-memory brute-force guard: 8 failed logins / 15 min per ip+email.
const fails = new Map();
const WINDOW = 15 * 60 * 1000;
const loginGuard = {
  check(key) {
    const f = fails.get(key);
    if (f && f.reset > Date.now() && f.count >= 8) throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
  },
  fail(key) {
    const f = fails.get(key);
    if (!f || f.reset < Date.now()) fails.set(key, { count: 1, reset: Date.now() + WINDOW });
    else f.count++;
  },
  clear(key) { fails.delete(key); }
};

module.exports = { secretWarning, HttpError, hashPassword, verifyPassword, createToken, verifyToken, requireAuth, loginGuard };
