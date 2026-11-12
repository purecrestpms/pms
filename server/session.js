import crypto from 'node:crypto';
import { get, run } from './db.js';

export const SESSION_COOKIE = 'pms_session';
export const ROLES = ['admin', 'manager', 'front_desk', 'housekeeping'];
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function parseCookies(header = '') {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

export function publicUser(row) {
  if (!row) return null;
  let roleName = null;
  try {
    const role = get('select name from roles where key = ?', [row.role]);
    roleName = role ? role.name : null;
  } catch {
    roleName = null;
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    role_name: roleName || row.role,
    active: Boolean(row.active),
    created_at: row.created_at,
    last_login: row.last_login
  };
}

/** Custom roles inherit the server permissions of their base role. */
export function baseRoleOf(roleKey) {
  if (!roleKey) return null;
  if (ROLES.includes(roleKey)) return roleKey;
  try {
    const row = get('select base from roles where key = ?', [roleKey]);
    return row ? row.base : roleKey;
  } catch {
    return roleKey;
  }
}

export function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  run('insert into sessions (token, user_id, created_at, expires_at) values (?,?,?,?)', [
    token,
    userId,
    new Date(now).toISOString(),
    new Date(now + TTL_MS).toISOString()
  ]);
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = req.secure || forwarded === 'https';
  res.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}${secure ? '; Secure' : ''}`
  );
  return token;
}

export function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) run('delete from sessions where token = ?', [token]);
  res.append('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

export function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const row = get(
    `select u.*, s.expires_at from sessions s join users u on u.id = s.user_id where s.token = ?`,
    [token]
  );
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    run('delete from sessions where token = ?', [token]);
    return null;
  }
  if (!row.active) return null;
  return row;
}

export function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Please sign in to continue' });
  req.user = user;
  return next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in to continue' });
    const base = baseRoleOf(req.user.role);
    if (!roles.includes(req.user.role) && !roles.includes(base)) {
      return res.status(403).json({ error: 'Your role does not allow this action' });
    }
    return next();
  };
}
