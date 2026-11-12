import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, run, tx } from './db.js';
import { hashPassword, verifyPassword, randomToken } from './password.js';
import {
  createSession,
  destroySession,
  publicUser,
  requireAuth,
  requireRole,
  ROLES,
  userFromRequest
} from './session.js';
import { todayISO, addDays, isISODate, nights, eachDate, money, code, weekdayShort } from './util.js';
import { parseIcalEvents, buildIcal, fetchIcal } from './ical.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESERVATION_STATUSES = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'];
const ROOM_STATUSES = ['clean', 'dirty', 'inspected', 'out_of_order'];
const ACTIVE_STATUSES = ['pending', 'confirmed', 'checked_in'];

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function logActivity(userId, action, detail) {
  run('insert into activity_log (user_id, action, detail, created_at) values (?,?,?,?)', [
    userId ?? null,
    action,
    detail ?? null,
    new Date().toISOString()
  ]);
}

function readSettings() {
  const out = {};
  for (const row of all('select key, value from settings')) out[row.key] = row.value;
  return out;
}

function baseUrl(req) {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

const RES_SELECT = `select r.*, g.first_name, g.last_name, g.email as guest_email, g.phone as guest_phone,
    g.country as guest_country, g.notes as guest_notes,
    rt.name as room_type_name, rt.base_rate as room_type_rate,
    rm.number as room_number, ch.name as channel_name, ch.color as channel_color,
    (select coalesce(sum(amount * quantity), 0) from charges where reservation_id = r.id) as charges_total,
    (select coalesce(sum(amount), 0) from payments where reservation_id = r.id) as payments_total
  from reservations r
  join guests g on g.id = r.guest_id
  join room_types rt on rt.id = r.room_type_id
  left join rooms rm on rm.id = r.room_id
  left join channels ch on ch.id = r.channel_id`;

function reservationRow(row) {
  if (!row) return null;
  return {
    ...row,
    guest_name: `${row.first_name} ${row.last_name}`.trim(),
    charges_total: money(row.charges_total),
    payments_total: money(row.payments_total),
    balance: money(row.charges_total - row.payments_total),
    nights: nights(row.check_in, row.check_out)
  };
}

/* ---------------------------- availability ---------------------------- */

function blockedRoomIds({ roomTypeId = null, from, to, excludeReservationId = null }) {
  const ids = new Set();
  const typeFilter = roomTypeId ? 'and rm.room_type_id = ?' : '';
  const typeParams = roomTypeId ? [roomTypeId] : [];

  for (const row of all(`select rm.id from rooms rm where rm.active = 1 and rm.status = 'out_of_order' ${typeFilter}`, typeParams)) {
    ids.add(row.id);
  }
  for (const row of all(
    `select r.room_id from reservations r join rooms rm on rm.id = r.room_id
     where r.status in ('pending','confirmed','checked_in') and r.room_id is not null
       and r.check_in < ? and r.check_out > ? and (? is null or r.id <> ?) ${typeFilter}`,
    [to, from, excludeReservationId, excludeReservationId, ...typeParams]
  )) {
    ids.add(row.room_id);
  }
  for (const row of all(
    `select b.room_id from calendar_blocks b join rooms rm on rm.id = b.room_id
     where b.start_date < ? and b.end_date > ? ${typeFilter}`,
    [to, from, ...typeParams]
  )) {
    ids.add(row.room_id);
  }

  let unassigned = 0;
  if (roomTypeId) {
    const row = get(
      `select count(*) as c from reservations
       where room_type_id = ? and status in ('pending','confirmed','checked_in') and room_id is null
         and check_in < ? and check_out > ? and (? is null or id <> ?)`,
      [roomTypeId, to, from, excludeReservationId, excludeReservationId]
    );
    unassigned = row ? row.c : 0;
  }
  return { ids, unassigned };
}

function availableCount(roomTypeId, from, to, excludeReservationId = null) {
  const total = get('select count(*) as c from rooms where active = 1 and room_type_id = ?', [roomTypeId]);
  const { ids, unassigned } = blockedRoomIds({ roomTypeId, from, to, excludeReservationId });
  return Math.max(0, (total ? total.c : 0) - ids.size - unassigned);
}

function freeRooms(roomTypeId, from, to, excludeReservationId = null) {
  const { ids } = blockedRoomIds({ roomTypeId, from, to, excludeReservationId });
  return all('select id, number, floor, status from rooms where active = 1 and room_type_id = ? order by number', [roomTypeId])
    .filter((room) => !ids.has(room.id));
}

function pickRoomForBlock({ roomTypeId, start, end, feedId, uid }) {
  const existing = get('select room_id from calendar_blocks where feed_id = ? and external_uid = ?', [feedId, uid]);
  const rooms = all('select id from rooms where active = 1 and room_type_id = ? order by number', [roomTypeId]);
  if (!rooms.length) return null;

  const used = new Set();
  for (const row of all(
    `select room_id from reservations where status in ('pending','confirmed','checked_in') and room_id is not null
       and check_in < ? and check_out > ?`,
    [end, start]
  )) {
    used.add(row.room_id);
  }
  for (const row of all(
    `select room_id from calendar_blocks where start_date < ? and end_date > ? and not (feed_id = ? and external_uid = ?)`,
    [end, start, feedId, uid]
  )) {
    used.add(row.room_id);
  }
  for (const row of all(`select id from rooms where active = 1 and status = 'out_of_order'`)) used.add(row.id);

  if (existing && existing.room_id && rooms.some((room) => room.id === existing.room_id) && !used.has(existing.room_id)) {
    return existing.room_id;
  }
  const free = rooms.find((room) => !used.has(room.id));
  return free ? free.id : existing?.room_id || rooms[0].id;
}

/* ------------------------------ channels ------------------------------ */

async function syncFeed(feed) {
  const now = new Date().toISOString();
  const result = { feed_id: feed.id, name: feed.name, ok: true, imported: 0, updated: 0, removed: 0, conflicts: [], events: 0 };

  let text;
  try {
    text = await fetchIcal(feed.url);
  } catch (error) {
    run('update ical_feeds set last_sync_at = ?, last_status = ?, last_message = ? where id = ?', [
      now,
      'error',
      error.message,
      feed.id
    ]);
    return { ...result, ok: false, error: error.message };
  }

  const events = parseIcalEvents(text);
  result.events = events.length;
  const seen = new Set();

  tx(() => {
    for (const event of events) {
      const uid = event.uid || `${event.start}|${event.end}|${event.summary}`;
      seen.add(uid);
      const roomId = feed.room_id || pickRoomForBlock({
        roomTypeId: feed.room_type_id,
        start: event.start,
        end: event.end,
        feedId: feed.id,
        uid
      });
      if (!roomId) {
        result.conflicts.push({
          type: 'no_inventory',
          block_start: event.start,
          block_end: event.end,
          summary: event.summary,
          message: 'No room available to hold this channel block'
        });
        continue;
      }
      const existing = get('select * from calendar_blocks where feed_id = ? and external_uid = ?', [feed.id, uid]);
      if (existing) {
        run('update calendar_blocks set room_id = ?, start_date = ?, end_date = ?, summary = ?, channel_id = ? where id = ?', [
          roomId,
          event.start,
          event.end,
          event.summary,
          feed.channel_id,
          existing.id
        ]);
        result.updated += 1;
      } else {
        run(
          `insert into calendar_blocks (room_id, start_date, end_date, source, channel_id, feed_id, external_uid, summary, created_at)
           values (?,?,?,?,?,?,?,?,?)`,
          [roomId, event.start, event.end, 'ical', feed.channel_id, feed.id, uid, event.summary, now]
        );
        result.imported += 1;
      }

      for (const clash of all(
        `select r.id, r.code, r.check_in, r.check_out, g.first_name, g.last_name
         from reservations r join guests g on g.id = r.guest_id
         where r.room_id = ? and r.status in ('pending','confirmed','checked_in')
           and r.check_in < ? and r.check_out > ?`,
        [roomId, event.end, event.start]
      )) {
        result.conflicts.push({
          type: 'overlap',
          reservation_id: clash.id,
          reservation_code: clash.code,
          guest_name: `${clash.first_name} ${clash.last_name}`.trim(),
          check_in: clash.check_in,
          check_out: clash.check_out,
          block_start: event.start,
          block_end: event.end,
          room_id: roomId,
          message: 'Channel block overlaps an existing reservation'
        });
      }
    }

    for (const row of all('select id, external_uid from calendar_blocks where feed_id = ?', [feed.id])) {
      if (!seen.has(row.external_uid)) {
        run('delete from calendar_blocks where id = ?', [row.id]);
        result.removed += 1;
      }
    }
  });

  const message = `${events.length} event(s) · ${result.imported} new · ${result.updated} updated · ${result.removed} removed${
    result.conflicts.length ? ` · ${result.conflicts.length} conflict(s)` : ''
  }`;
  run('update ical_feeds set last_sync_at = ?, last_status = ?, last_message = ?, last_event_count = ? where id = ?', [
    now,
    'ok',
    message,
    events.length,
    feed.id
  ]);
  result.message = message;
  return result;
}

function feedRow(row, req) {
  if (!row) return null;
  return {
    ...row,
    active: Boolean(row.active),
    scope: row.room_id ? `Room ${row.room_number}` : `All ${row.room_type_name} rooms`
  };
}

/* -------------------------------- app -------------------------------- */

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  const loginAttempts = new Map();
  function throttleKey(req, email) {
    return `${req.ip}|${String(email || '').toLowerCase()}`;
  }
  function checkThrottle(key) {
    const entry = loginAttempts.get(key);
    if (!entry) return;
    if (Date.now() - entry.first > 10 * 60 * 1000) {
      loginAttempts.delete(key);
      return;
    }
    if (entry.count >= 8) throw httpError(429, 'Too many sign-in attempts. Try again in a few minutes.');
  }
  function noteFailure(key) {
    const entry = loginAttempts.get(key);
    if (!entry || Date.now() - entry.first > 10 * 60 * 1000) loginAttempts.set(key, { count: 1, first: Date.now() });
    else entry.count += 1;
  }

  /* ------------------------------ health ------------------------------ */
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'appjet-hotel-pms', time: new Date().toISOString() });
  });

  /* ------------------------------- auth ------------------------------- */
  app.post(
    '/api/auth/login',
    wrap(async (req, res) => {
      const { email, password } = req.body || {};
      if (!email || !password) throw httpError(400, 'Email and password are required');
      const key = throttleKey(req, email);
      checkThrottle(key);

      const user = get('select * from users where lower(email) = lower(?)', [String(email).trim()]);
      if (!user || !verifyPassword(String(password), user.password_hash)) {
        noteFailure(key);
        throw httpError(401, 'Invalid email or password');
      }
      if (!user.active) throw httpError(403, 'This account has been deactivated. Ask an administrator.');

      loginAttempts.delete(key);
      run('update users set last_login = ? where id = ?', [new Date().toISOString(), user.id]);
      createSession(req, res, user.id);
      logActivity(user.id, 'sign_in', `${user.email} signed in`);
      res.json({ user: publicUser(user), property: readSettings() });
    })
  );

  app.post('/api/auth/logout', (req, res) => {
    const user = userFromRequest(req);
    destroySession(req, res);
    if (user) logActivity(user.id, 'sign_out', `${user.email} signed out`);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    res.json({ user: publicUser(user), property: readSettings(), roles: ROLES });
  });

  app.post(
    '/api/auth/password',
    requireAuth,
    wrap(async (req, res) => {
      const { current_password: currentPassword, new_password: newPassword } = req.body || {};
      if (!verifyPassword(String(currentPassword || ''), req.user.password_hash)) {
        throw httpError(400, 'Current password is incorrect');
      }
      if (String(newPassword || '').length < 8) throw httpError(400, 'New password must be at least 8 characters');
      run('update users set password_hash = ? where id = ?', [hashPassword(newPassword), req.user.id]);
      logActivity(req.user.id, 'password', 'Changed own password');
      res.json({ ok: true });
    })
  );

  /* --------------------------- staff accounts --------------------------- */
  app.get('/api/users', requireAuth, requireRole('admin', 'manager'), (req, res) => {
    const rows = all('select * from users order by active desc, name');
    res.json({ users: rows.map(publicUser), roles: ROLES });
  });

  app.post(
    '/api/users',
    requireAuth,
    requireRole('admin'),
    wrap(async (req, res) => {
      const { name, email, password, role } = req.body || {};
      const cleanName = String(name || '').trim();
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (cleanName.length < 2) throw httpError(400, 'Full name is required');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw httpError(400, 'A valid email address is required');
      if (String(password || '').length < 8) throw httpError(400, 'Password must be at least 8 characters');
      if (!ROLES.includes(role)) throw httpError(400, 'Choose a valid role');
      if (get('select id from users where lower(email) = ?', [cleanEmail])) {
        throw httpError(409, 'An account with that email already exists');
      }
      const created = run(
        'insert into users (name, email, password_hash, role, active, created_at) values (?,?,?,?,1,?)',
        [cleanName, cleanEmail, hashPassword(password), role, new Date().toISOString()]
      );
      logActivity(req.user.id, 'user_create', `Created ${role} account for ${cleanEmail}`);
      res.status(201).json({ user: publicUser(get('select * from users where id = ?', [created.id])) });
    })
  );

  app.patch(
    '/api/users/:id',
    requireAuth,
    requireRole('admin'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const target = get('select * from users where id = ?', [id]);
      if (!target) throw httpError(404, 'Account not found');

      const body = req.body || {};
      const updates = [];
      const params = [];

      if (body.name !== undefined) {
        const cleanName = String(body.name).trim();
        if (cleanName.length < 2) throw httpError(400, 'Full name is required');
        updates.push('name = ?');
        params.push(cleanName);
      }
      if (body.role !== undefined) {
        if (!ROLES.includes(body.role)) throw httpError(400, 'Choose a valid role');
        updates.push('role = ?');
        params.push(body.role);
      }
      if (body.active !== undefined) {
        const active = body.active ? 1 : 0;
        if (!active && target.id === req.user.id) throw httpError(400, 'You cannot deactivate your own account');
        updates.push('active = ?');
        params.push(active);
        if (!active) run('delete from sessions where user_id = ?', [id]);
      }
      if (body.password !== undefined) {
        if (String(body.password).length < 8) throw httpError(400, 'Password must be at least 8 characters');
        updates.push('password_hash = ?');
        params.push(hashPassword(body.password));
        run('delete from sessions where user_id = ? and user_id <> ?', [id, req.user.id]);
      }
      if (!updates.length) throw httpError(400, 'Nothing to update');

      const remainingAdmins = get(`select count(*) as c from users where role = 'admin' and active = 1 and id <> ?`, [id]);
      const losesAdmin =
        (body.role !== undefined && body.role !== 'admin' && target.role === 'admin') ||
        (body.active !== undefined && !body.active && target.role === 'admin');
      if (losesAdmin && (!remainingAdmins || remainingAdmins.c === 0)) {
        throw httpError(400, 'At least one active administrator is required');
      }

      run(`update users set ${updates.join(', ')} where id = ?`, [...params, id]);
      logActivity(req.user.id, 'user_update', `Updated account ${target.email}`);
      res.json({ user: publicUser(get('select * from users where id = ?', [id])) });
    })
  );

  app.delete(
    '/api/users/:id',
    requireAuth,
    requireRole('admin'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (id === req.user.id) throw httpError(400, 'You cannot remove your own account');
      const target = get('select * from users where id = ?', [id]);
      if (!target) throw httpError(404, 'Account not found');
      if (target.role === 'admin') {
        const admins = get(`select count(*) as c from users where role = 'admin' and active = 1 and id <> ?`, [id]);
        if (!admins || admins.c === 0) throw httpError(400, 'At least one active administrator is required');
      }
      run('update users set active = 0 where id = ?', [id]);
      run('delete from sessions where user_id = ?', [id]);
      logActivity(req.user.id, 'user_deactivate', `Deactivated account ${target.email}`);
      res.json({ ok: true });
    })
  );

  /* ------------------------------ property ------------------------------ */
  app.get('/api/property', requireAuth, (req, res) => {
    res.json({ property: readSettings(), currency: readSettings().currency || 'EUR' });
  });

  app.put(
    '/api/property',
    requireAuth,
    requireRole('admin', 'manager'),
    wrap(async (req, res) => {
      const allowed = [
        'property_name',
        'property_address',
        'property_phone',
        'currency',
        'check_in_time',
        'check_out_time',
        'timezone'
      ];
      const body = req.body || {};
      for (const key of allowed) {
        if (body[key] === undefined) continue;
        run('insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value', [
          key,
          String(body[key])
        ]);
      }
      logActivity(req.user.id, 'settings', 'Updated property settings');
      res.json({ property: readSettings() });
    })
  );

  /* ---------------------------- room types ---------------------------- */
  app.get('/api/room-types', requireAuth, (req, res) => {
    const today = todayISO();
    const tomorrow = addDays(today, 1);
    const types = all('select * from room_types order by name').map((type) => {
      const total = get('select count(*) as c from rooms where active = 1 and room_type_id = ?', [type.id]);
      return {
        ...type,
        rooms_total: total ? total.c : 0,
        available_tonight: availableCount(type.id, today, tomorrow)
      };
    });
    res.json({ room_types: types });
  });

  app.post(
    '/api/room-types',
    requireAuth,
    requireRole('admin', 'manager'),
    wrap(async (req, res) => {
      const body = req.body || {};
      const name = String(body.name || '').trim();
      if (!name) throw httpError(400, 'Room type name is required');
      const capacity = Number(body.capacity || 2);
      const baseRate = Number(body.base_rate || 0);
      if (!Number.isFinite(capacity) || capacity < 1) throw httpError(400, 'Capacity must be at least 1');
      if (!Number.isFinite(baseRate) || baseRate < 0) throw httpError(400, 'Base rate must be zero or more');
      const created = run('insert into room_types (name, code, capacity, base_rate, description) values (?,?,?,?,?)', [
        name,
        String(body.code || '').trim() || null,
        capacity,
        baseRate,
        String(body.description || '').trim() || null
      ]);
      logActivity(req.user.id, 'room_type', `Created room type ${name}`);
      res.status(201).json({ room_type: get('select * from room_types where id = ?', [created.id]) });
    })
  );

  app.patch(
    '/api/room-types/:id',
    requireAuth,
    requireRole('admin', 'manager'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (!get('select id from room_types where id = ?', [id])) throw httpError(404, 'Room type not found');
      const body = req.body || {};
      const updates = [];
      const params = [];
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) throw httpError(400, 'Room type name is required');
        updates.push('name = ?');
        params.push(name);
      }
      if (body.capacity !== undefined) {
        const capacity = Number(body.capacity);
        if (!Number.isFinite(capacity) || capacity < 1) throw httpError(400, 'Capacity must be at least 1');
        updates.push('capacity = ?');
        params.push(capacity);
      }
      if (body.base_rate !== undefined) {
        const rate = Number(body.base_rate);
        if (!Number.isFinite(rate) || rate < 0) throw httpError(400, 'Base rate must be zero or more');
        updates.push('base_rate = ?');
        params.push(rate);
      }
      if (body.description !== undefined) {
        updates.push('description = ?');
        params.push(String(body.description).trim() || null);
      }
      if (body.code !== undefined) {
        updates.push('code = ?');
        params.push(String(body.code).trim() || null);
      }
      if (!updates.length) throw httpError(400, 'Nothing to update');
      run(`update room_types set ${updates.join(', ')} where id = ?`, [...params, id]);
      res.json({ room_type: get('select * from room_types where id = ?', [id]) });
    })
  );

  app.delete(
    '/api/room-types/:id',
    requireAuth,
    requireRole('admin'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const rooms = get('select count(*) as c from rooms where room_type_id = ?', [id]);
      if (rooms && rooms.c > 0) throw httpError(409, 'Move or remove the rooms of this type first');
      run('delete from room_types where id = ?', [id]);
      res.json({ ok: true });
    })
  );

  /* ------------------------------- rooms ------------------------------- */
  app.get('/api/rooms', requireAuth, (req, res) => {
    const today = todayISO();
    const rooms = all(
      `select rm.*, rt.name as room_type_name, rt.base_rate, rt.capacity,
        (select r.id from reservations r where r.room_id = rm.id and r.status = 'checked_in' limit 1) as current_reservation_id,
        (select g.first_name || ' ' || g.last_name from reservations r join guests g on g.id = r.guest_id
           where r.room_id = rm.id and r.status = 'checked_in' limit 1) as current_guest,
        (select r.check_out from reservations r where r.room_id = rm.id and r.status = 'checked_in' limit 1) as current_check_out,
        (select r.check_in from reservations r where r.room_id = rm.id and r.status = 'confirmed' and r.check_in >= ? order by r.check_in limit 1) as next_arrival
       from rooms rm join room_types rt on rt.id = rm.room_type_id
       order by rm.number`,
      [today]
    );
    res.json({ rooms, statuses: ROOM_STATUSES });
  });

  app.post(
    '/api/rooms',
    requireAuth,
    requireRole('admin', 'manager'),
    wrap(async (req, res) => {
      const body = req.body || {};
      const number = String(body.number || '').trim();
      if (!number) throw httpError(400, 'Room number is required');
      if (get('select id from rooms where lower(number) = lower(?)', [number])) {
        throw httpError(409, 'That room number already exists');
      }
      const typeId = Number(body.room_type_id);
      if (!get('select id from room_types where id = ?', [typeId])) throw httpError(400, 'Choose a valid room type');
      const status = ROOM_STATUSES.includes(body.status) ? body.status : 'clean';
      const created = run(
        'insert into rooms (number, room_type_id, floor, status, notes, ical_token, active) values (?,?,?,?,?,?,1)',
        [number, typeId, Number(body.floor || 1), status, String(body.notes || '').trim() || null, randomToken(16)]
      );
      logActivity(req.user.id, 'room_create', `Added room ${number}`);
      res.status(201).json({ room: get('select * from rooms where id = ?', [created.id]) });
    })
  );

  app.patch(
    '/api/rooms/:id',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const room = get('select * from rooms where id = ?', [id]);
      if (!room) throw httpError(404, 'Room not found');
      const body = req.body || {};
      const updates = [];
      const params = [];
      if (body.number !== undefined) {
        const number = String(body.number).trim();
        if (!number) throw httpError(400, 'Room number is required');
        const clash = get('select id from rooms where lower(number) = lower(?) and id <> ?', [number, id]);
        if (clash) throw httpError(409, 'That room number already exists');
        updates.push('number = ?');
        params.push(number);
      }
      if (body.room_type_id !== undefined) {
        const typeId = Number(body.room_type_id);
        if (!get('select id from room_types where id = ?', [typeId])) throw httpError(400, 'Choose a valid room type');
        updates.push('room_type_id = ?');
        params.push(typeId);
      }
      if (body.floor !== undefined) {
        updates.push('floor = ?');
        params.push(Number(body.floor) || 1);
      }
      if (body.status !== undefined) {
        if (!ROOM_STATUSES.includes(body.status)) throw httpError(400, 'Choose a valid room status');
        updates.push('status = ?');
        params.push(body.status);
      }
      if (body.notes !== undefined) {
        updates.push('notes = ?');
        params.push(String(body.notes).trim() || null);
      }
      if (body.active !== undefined) {
        updates.push('active = ?');
        params.push(body.active ? 1 : 0);
      }
      if (!updates.length) throw httpError(400, 'Nothing to update');
      run(`update rooms set ${updates.join(', ')} where id = ?`, [...params, id]);
      res.json({ room: get('select * from rooms where id = ?', [id]) });
    })
  );

  app.patch(
    '/api/rooms/:id/status',
    requireAuth,
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const room = get('select * from rooms where id = ?', [id]);
      if (!room) throw httpError(404, 'Room not found');
      const { status, notes } = req.body || {};
      if (!ROOM_STATUSES.includes(status)) throw httpError(400, 'Choose a valid room status');
      run('update rooms set status = ?, notes = coalesce(?, notes) where id = ?', [status, notes ?? null, id]);
      logActivity(req.user.id, 'housekeeping', `Room ${room.number} marked ${status.replace('_', ' ')}`);
      res.json({ room: get('select * from rooms where id = ?', [id]) });
    })
  );

  /* ------------------------------- guests ------------------------------- */
  const GUEST_SELECT = `select g.*,
      (select count(*) from reservations r where r.guest_id = g.id and r.status not in ('cancelled','no_show')) as stays,
      (select coalesce(sum(julianday(r.check_out) - julianday(r.check_in)), 0) from reservations r
        where r.guest_id = g.id and r.status not in ('cancelled','no_show')) as nights_stayed,
      (select coalesce(sum(p.amount), 0) from payments p join reservations r on r.id = p.reservation_id
        where r.guest_id = g.id) as lifetime_value,
      (select max(r.check_in) from reservations r where r.guest_id = g.id) as last_stay,
      (select min(r.check_in) from reservations r where r.guest_id = g.id
        and r.check_in >= ? and r.status in ('pending','confirmed','checked_in')) as next_stay
    from guests g`;

  app.get('/api/guests', requireAuth, (req, res) => {
    const q = String(req.query.q || '').trim();
    const like = `%${q}%`;
    const rows = all(
      `${GUEST_SELECT}
       where ? = '' or lower(g.first_name || ' ' || g.last_name) like lower(?)
         or lower(coalesce(g.email, '')) like lower(?)
         or coalesce(g.phone, '') like ?
         or lower(coalesce(g.company, '')) like lower(?)
         or lower(coalesce(g.id_number, '')) like lower(?)
       order by g.vip desc, g.last_name, g.first_name limit 300`,
      [todayISO(), q, like, like, like, like, like]
    );
    res.json({ guests: rows });
  });

  app.get('/api/guests/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const guest = get(`${GUEST_SELECT} where g.id = ?`, [todayISO(), id]);
    if (!guest) throw httpError(404, 'Guest not found');
    const reservations = all(`${RES_SELECT} where r.guest_id = ? order by r.check_in desc`, [id]).map(reservationRow);
    res.json({ guest, reservations });
  });

  const GUEST_FIELDS = [
    ['first_name', 'first_name'],
    ['last_name', 'last_name'],
    ['email', 'email'],
    ['phone', 'phone'],
    ['country', 'country'],
    ['company', 'company'],
    ['address', 'address'],
    ['city', 'city'],
    ['id_type', 'id_type'],
    ['id_number', 'id_number'],
    ['birth_date', 'birth_date'],
    ['preferences', 'preferences'],
    ['notes', 'notes']
  ];
  const GUEST_FLAGS = [
    ['vip', 'vip'],
    ['marketing_opt_in', 'marketing_opt_in'],
    ['blacklisted', 'blacklisted']
  ];

  app.post(
    '/api/guests',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const body = req.body || {};
      const first = String(body.first_name || '').trim();
      const last = String(body.last_name || '').trim();
      if (!first || !last) throw httpError(400, 'Guest first and last name are required');
      const now = new Date().toISOString();
      const created = run(
        `insert into guests (first_name, last_name, email, phone, country, company, address, city, id_type, id_number,
          birth_date, preferences, notes, vip, marketing_opt_in, blacklisted, created_at, updated_at)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          first,
          last,
          String(body.email || '').trim() || null,
          String(body.phone || '').trim() || null,
          String(body.country || '').trim() || null,
          String(body.company || '').trim() || null,
          String(body.address || '').trim() || null,
          String(body.city || '').trim() || null,
          String(body.id_type || '').trim() || null,
          String(body.id_number || '').trim() || null,
          String(body.birth_date || '').trim() || null,
          String(body.preferences || '').trim() || null,
          String(body.notes || '').trim() || null,
          body.vip ? 1 : 0,
          body.marketing_opt_in ? 1 : 0,
          body.blacklisted ? 1 : 0,
          now,
          now
        ]
      );
      logActivity(req.user.id, 'guest', `Created guest profile ${first} ${last}`);
      res.status(201).json({ guest: get('select * from guests where id = ?', [created.id]) });
    })
  );

  app.patch(
    '/api/guests/:id',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (!get('select id from guests where id = ?', [id])) throw httpError(404, 'Guest not found');
      const body = req.body || {};
      const updates = [];
      const params = [];
      for (const [key, column] of GUEST_FIELDS) {
        if (body[key] === undefined) continue;
        updates.push(`${column} = ?`);
        params.push(String(body[key]).trim() || null);
      }
      for (const [key, column] of GUEST_FLAGS) {
        if (body[key] === undefined) continue;
        updates.push(`${column} = ?`);
        params.push(body[key] ? 1 : 0);
      }
      if (!updates.length) throw httpError(400, 'Nothing to update');
      updates.push('updated_at = ?');
      params.push(new Date().toISOString(), id);
      run(`update guests set ${updates.join(', ')} where id = ?`, params);
      logActivity(req.user.id, 'guest', `Updated guest profile #${id}`);
      res.json({ guest: get('select * from guests where id = ?', [id]) });
    })
  );

  app.delete(
    '/api/guests/:id',
    requireAuth,
    requireRole('admin', 'manager'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (!get('select id from guests where id = ?', [id])) throw httpError(404, 'Guest not found');
      const linked = get('select count(*) as c from reservations where guest_id = ?', [id]).c;
      if (linked) throw httpError(409, 'This guest has reservation history and cannot be deleted');
      run('delete from guests where id = ?', [id]);
      logActivity(req.user.id, 'guest', `Deleted guest profile #${id}`);
      res.json({ ok: true });
    })
  );

  /* ---------------------------- reservations ---------------------------- */
  app.get('/api/reservations', requireAuth, (req, res) => {
    const filters = [];
    const params = [];
    const { from, to, status, q, room_id: roomId, channel_id: channelId } = req.query;

    if (from && isISODate(from)) {
      filters.push('r.check_out > ?');
      params.push(from);
    }
    if (to && isISODate(to)) {
      filters.push('r.check_in < ?');
      params.push(to);
    }
    if (status && RESERVATION_STATUSES.includes(status)) {
      filters.push('r.status = ?');
      params.push(status);
    }
    if (roomId) {
      filters.push('r.room_id = ?');
      params.push(Number(roomId));
    }
    if (channelId) {
      filters.push('r.channel_id = ?');
      params.push(Number(channelId));
    }
    if (q) {
      const like = `%${String(q).trim()}%`;
      filters.push(`(lower(g.first_name || ' ' || g.last_name) like lower(?) or lower(r.code) like lower(?) or coalesce(rm.number, '') like ? or coalesce(r.external_ref, '') like ?)`);
      params.push(like, like, like, like);
    }

    const where = filters.length ? `where ${filters.join(' and ')}` : '';
    const rows = all(`${RES_SELECT} ${where} order by r.check_in desc, r.code limit 400`, params);
    res.json({ reservations: rows.map(reservationRow), statuses: RESERVATION_STATUSES });
  });

  app.get(
    '/api/reservations/:id',
    requireAuth,
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const row = get(`${RES_SELECT} where r.id = ?`, [id]);
      if (!row) throw httpError(404, 'Reservation not found');
      res.json({
        reservation: reservationRow(row),
        charges: all('select * from charges where reservation_id = ? order by id', [id]),
        payments: all('select * from payments where reservation_id = ? order by id', [id])
      });
    })
  );

  function resolveGuestId(body) {
    if (body.guest_id) {
      const guest = get('select id from guests where id = ?', [Number(body.guest_id)]);
      if (!guest) throw httpError(400, 'Guest not found');
      return guest.id;
    }
    const first = String(body.first_name || '').trim();
    const last = String(body.last_name || '').trim();
    if (!first || !last) throw httpError(400, 'Guest first and last name are required');
    const email = String(body.email || '').trim();
    if (email) {
      const existing = get('select id from guests where lower(email) = lower(?)', [email]);
      if (existing) return existing.id;
    }
    const created = run(
      'insert into guests (first_name, last_name, email, phone, country, notes, created_at) values (?,?,?,?,?,?,?)',
      [
        first,
        last,
        email || null,
        String(body.phone || '').trim() || null,
        String(body.country || '').trim() || null,
        null,
        new Date().toISOString()
      ]
    );
    return created.id;
  }

  function validateStay(checkIn, checkOut) {
    if (!isISODate(checkIn) || !isISODate(checkOut)) throw httpError(400, 'Check-in and check-out dates are required');
    if (checkIn >= checkOut) throw httpError(400, 'Check-out must be after check-in');
  }

  app.post(
    '/api/reservations',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const body = req.body || {};
      const checkIn = String(body.check_in || '');
      const checkOut = String(body.check_out || '');
      validateStay(checkIn, checkOut);

      const typeId = Number(body.room_type_id);
      const roomType = get('select * from room_types where id = ?', [typeId]);
      if (!roomType) throw httpError(400, 'Choose a valid room type');

      let roomId = body.room_id ? Number(body.room_id) : null;
      if (roomId) {
        const room = get('select * from rooms where id = ? and active = 1', [roomId]);
        if (!room) throw httpError(400, 'Choose a valid room');
        const blocked = blockedRoomIds({ from: checkIn, to: checkOut });
        if (blocked.ids.has(roomId)) throw httpError(409, `Room ${room.number} is not available for those dates`);
      } else if (availableCount(typeId, checkIn, checkOut) <= 0) {
        throw httpError(409, `No ${roomType.name} rooms are available for those dates`);
      }

      const guestId = resolveGuestId(body);
      const rate = money(body.rate !== undefined && body.rate !== '' ? body.rate : roomType.base_rate);
      const status = body.status === 'pending' ? 'pending' : 'confirmed';
      const stayNights = nights(checkIn, checkOut);
      const created = run(
        `insert into reservations (code, guest_id, room_type_id, room_id, check_in, check_out, adults, children, status,
          channel_id, external_ref, rate, notes, created_by, created_at)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          code('R'),
          guestId,
          typeId,
          roomId,
          checkIn,
          checkOut,
          Math.max(1, Number(body.adults || 1)),
          Math.max(0, Number(body.children || 0)),
          status,
          body.channel_id ? Number(body.channel_id) : 1,
          String(body.external_ref || '').trim() || null,
          rate,
          String(body.notes || '').trim() || null,
          req.user.id,
          new Date().toISOString()
        ]
      );

      if (stayNights > 0) {
        run('insert into charges (reservation_id, description, amount, quantity, created_by, created_at) values (?,?,?,?,?,?)', [
          created.id,
          `Room charge · ${stayNights} night(s) @ ${rate}`,
          money(rate * stayNights),
          1,
          req.user.id,
          new Date().toISOString()
        ]);
      }

      const row = reservationRow(get(`${RES_SELECT} where r.id = ?`, [created.id]));
      logActivity(req.user.id, 'reservation', `Created reservation ${row.code} for ${row.guest_name}`);
      res.status(201).json({ reservation: row });
    })
  );

  app.patch(
    '/api/reservations/:id',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const existing = get('select * from reservations where id = ?', [id]);
      if (!existing) throw httpError(404, 'Reservation not found');
      if (['checked_out', 'cancelled'].includes(existing.status)) {
        throw httpError(409, 'This reservation is closed and cannot be edited');
      }
      const body = req.body || {};

      const checkIn = body.check_in !== undefined ? String(body.check_in) : existing.check_in;
      const checkOut = body.check_out !== undefined ? String(body.check_out) : existing.check_out;
      validateStay(checkIn, checkOut);

      const typeId = body.room_type_id !== undefined ? Number(body.room_type_id) : existing.room_type_id;
      if (!get('select id from room_types where id = ?', [typeId])) throw httpError(400, 'Choose a valid room type');

      let roomId = body.room_id !== undefined ? (body.room_id ? Number(body.room_id) : null) : existing.room_id;
      if (roomId) {
        const room = get('select * from rooms where id = ? and active = 1', [roomId]);
        if (!room) throw httpError(400, 'Choose a valid room');
        const blocked = blockedRoomIds({ from: checkIn, to: checkOut, excludeReservationId: id });
        if (blocked.ids.has(roomId)) throw httpError(409, `Room ${room.number} is not available for those dates`);
        roomId = room.id;
      }

      const rate = body.rate !== undefined ? money(body.rate) : existing.rate;
      run(
        `update reservations set room_type_id = ?, room_id = ?, check_in = ?, check_out = ?, adults = ?, children = ?,
          rate = ?, notes = ?, channel_id = ?, external_ref = ?, updated_at = ? where id = ?`,
        [
          typeId,
          roomId,
          checkIn,
          checkOut,
          Math.max(1, Number(body.adults ?? existing.adults)),
          Math.max(0, Number(body.children ?? existing.children)),
          rate,
          body.notes !== undefined ? String(body.notes).trim() || null : existing.notes,
          body.channel_id !== undefined ? Number(body.channel_id) : existing.channel_id,
          body.external_ref !== undefined ? String(body.external_ref).trim() || null : existing.external_ref,
          new Date().toISOString(),
          id
        ]
      );
      logActivity(req.user.id, 'reservation', `Updated reservation ${existing.code}`);
      res.json({ reservation: reservationRow(get(`${RES_SELECT} where r.id = ?`, [id])) });
    })
  );

  app.post(
    '/api/reservations/:id/assign-room',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const reservation = get('select * from reservations where id = ?', [id]);
      if (!reservation) throw httpError(404, 'Reservation not found');
      if (['checked_out', 'cancelled', 'no_show'].includes(reservation.status)) {
        throw httpError(409, 'This reservation is closed');
      }
      let roomId = req.body?.room_id ? Number(req.body.room_id) : null;
      if (roomId) {
        const blocked = blockedRoomIds({
          from: reservation.check_in,
          to: reservation.check_out,
          excludeReservationId: id
        });
        if (blocked.ids.has(roomId)) throw httpError(409, 'That room is not available for these dates');
      } else {
        const free = freeRooms(reservation.room_type_id, reservation.check_in, reservation.check_out, id);
        if (!free.length) throw httpError(409, 'No free room of this type for these dates');
        roomId = free[0].id;
      }
      run('update reservations set room_id = ?, updated_at = ? where id = ?', [roomId, new Date().toISOString(), id]);
      res.json({ reservation: reservationRow(get(`${RES_SELECT} where r.id = ?`, [id])) });
    })
  );

  app.post(
    '/api/reservations/:id/check-in',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const reservation = get('select * from reservations where id = ?', [id]);
      if (!reservation) throw httpError(404, 'Reservation not found');
      if (reservation.status === 'checked_in') throw httpError(409, 'Guest is already checked in');
      if (['checked_out', 'cancelled', 'no_show'].includes(reservation.status)) {
        throw httpError(409, 'This reservation cannot be checked in');
      }

      let roomId = req.body?.room_id ? Number(req.body.room_id) : reservation.room_id;
      if (!roomId) {
        const free = freeRooms(reservation.room_type_id, reservation.check_in, reservation.check_out, id);
        if (!free.length) throw httpError(409, 'No free room of this type to check the guest into');
        roomId = free[0].id;
      } else {
        const blocked = blockedRoomIds({
          from: reservation.check_in,
          to: reservation.check_out,
          excludeReservationId: id
        });
        if (blocked.ids.has(roomId)) throw httpError(409, 'That room is occupied or blocked for these dates');
        const room = get('select * from rooms where id = ?', [roomId]);
        if (room && room.status === 'out_of_order') throw httpError(409, `Room ${room.number} is out of order`);
      }

      const now = new Date().toISOString();
      run('update reservations set status = ?, room_id = ?, checked_in_at = ?, updated_at = ? where id = ?', [
        'checked_in',
        roomId,
        now,
        now,
        id
      ]);
      const row = reservationRow(get(`${RES_SELECT} where r.id = ?`, [id]));
      logActivity(req.user.id, 'check_in', `Checked in ${row.guest_name} to room ${row.room_number}`);
      res.json({ reservation: row });
    })
  );

  app.post(
    '/api/reservations/:id/check-out',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const reservation = get('select * from reservations where id = ?', [id]);
      if (!reservation) throw httpError(404, 'Reservation not found');
      if (reservation.status !== 'checked_in') throw httpError(409, 'Only checked-in guests can check out');

      const now = new Date().toISOString();
      run('update reservations set status = ?, checked_out_at = ?, updated_at = ? where id = ?', [
        'checked_out',
        now,
        now,
        id
      ]);
      if (reservation.room_id) run(`update rooms set status = 'dirty' where id = ?`, [reservation.room_id]);
      const row = reservationRow(get(`${RES_SELECT} where r.id = ?`, [id]));
      logActivity(req.user.id, 'check_out', `Checked out ${row.guest_name} from room ${row.room_number}`);
      res.json({ reservation: row });
    })
  );

  app.post(
    '/api/reservations/:id/cancel',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const reservation = get('select * from reservations where id = ?', [id]);
      if (!reservation) throw httpError(404, 'Reservation not found');
      if (['checked_out', 'cancelled'].includes(reservation.status)) throw httpError(409, 'Reservation is already closed');
      run('update reservations set status = ?, cancelled_at = ?, updated_at = ? where id = ?', [
        'cancelled',
        new Date().toISOString(),
        new Date().toISOString(),
        id
      ]);
      logActivity(req.user.id, 'reservation', `Cancelled reservation ${reservation.code}`);
      res.json({ reservation: reservationRow(get(`${RES_SELECT} where r.id = ?`, [id])) });
    })
  );

  app.post(
    '/api/reservations/:id/no-show',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const reservation = get('select * from reservations where id = ?', [id]);
      if (!reservation) throw httpError(404, 'Reservation not found');
      if (['checked_in', 'checked_out', 'cancelled'].includes(reservation.status)) {
        throw httpError(409, 'This reservation cannot be marked as a no-show');
      }
      run('update reservations set status = ?, updated_at = ? where id = ?', ['no_show', new Date().toISOString(), id]);
      logActivity(req.user.id, 'reservation', `Marked reservation ${reservation.code} as no-show`);
      res.json({ reservation: reservationRow(get(`${RES_SELECT} where r.id = ?`, [id])) });
    })
  );

  app.post(
    '/api/reservations/:id/charges',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (!get('select id from reservations where id = ?', [id])) throw httpError(404, 'Reservation not found');
      const { description, amount, quantity } = req.body || {};
      const clean = String(description || '').trim();
      const value = Number(amount);
      if (!clean) throw httpError(400, 'Charge description is required');
      if (!Number.isFinite(value)) throw httpError(400, 'Charge amount must be a number');
      run('insert into charges (reservation_id, description, amount, quantity, created_by, created_at) values (?,?,?,?,?,?)', [
        id,
        clean,
        money(value),
        Number(quantity || 1),
        req.user.id,
        new Date().toISOString()
      ]);
      res.status(201).json({ charges: all('select * from charges where reservation_id = ? order by id', [id]) });
    })
  );

  app.delete(
    '/api/reservations/:id/charges/:chargeId',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      run('delete from charges where id = ? and reservation_id = ?', [Number(req.params.chargeId), Number(req.params.id)]);
      res.json({ charges: all('select * from charges where reservation_id = ? order by id', [Number(req.params.id)]) });
    })
  );

  app.post(
    '/api/reservations/:id/payments',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      if (!get('select id from reservations where id = ?', [id])) throw httpError(404, 'Reservation not found');
      const { amount, method, reference } = req.body || {};
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) throw httpError(400, 'Payment amount must be greater than zero');
      const shift = get("select id from shifts where user_id = ? and status = 'open' order by id desc limit 1", [
        req.user.id
      ]);
      run(
        'insert into payments (reservation_id, amount, method, reference, created_by, created_at, shift_id) values (?,?,?,?,?,?,?)',
        [
          id,
          money(value),
          String(method || 'card'),
          String(reference || '').trim() || null,
          req.user.id,
          new Date().toISOString(),
          shift ? shift.id : null
        ]
      );
      logActivity(req.user.id, 'payment', `Recorded ${money(value)} payment on reservation #${id}`);
      res.status(201).json({ payments: all('select * from payments where reservation_id = ? order by id', [id]) });
    })
  );

  /* ---------------------------- availability ---------------------------- */
  app.get('/api/availability', requireAuth, (req, res) => {
    const from = isISODate(req.query.from) ? req.query.from : todayISO();
    const to = isISODate(req.query.to) ? req.query.to : addDays(from, 1);
    if (to <= from) return res.status(400).json({ error: 'End date must be after start date' });
    const types = all('select * from room_types order by name').map((type) => {
      const total = get('select count(*) as c from rooms where active = 1 and room_type_id = ?', [type.id]);
      const roomsTotal = total ? total.c : 0;
      return {
        room_type_id: type.id,
        name: type.name,
        base_rate: type.base_rate,
        rooms_total: roomsTotal,
        available: availableCount(type.id, from, to),
        free_rooms: freeRooms(type.id, from, to)
      };
    });
    res.json({ from, to, room_types: types });
  });

  app.get('/api/calendar', requireAuth, (req, res) => {
    const start = isISODate(req.query.start) ? req.query.start : todayISO();
    const days = Math.min(45, Math.max(1, Number(req.query.days) || 14));
    const dates = eachDate(start, days);
    const end = addDays(start, days);

    const rooms = all(
      `select rm.id, rm.number, rm.floor, rm.status, rm.active, rm.room_type_id, rt.name as room_type_name
       from rooms rm join room_types rt on rt.id = rm.room_type_id
       where rm.active = 1 order by rm.number`
    );
    const reservations = all(
      `select r.id, r.code, r.room_id, r.check_in, r.check_out, r.status, r.room_type_id, r.rate,
        g.first_name || ' ' || g.last_name as guest_name, ch.name as channel_name, ch.color as channel_color
       from reservations r join guests g on g.id = r.guest_id left join channels ch on ch.id = r.channel_id
       where r.status in ('pending','confirmed','checked_in') and r.check_in < ? and r.check_out > ?
       order by r.check_in`,
      [end, start]
    );
    const blocks = all(
      `select b.id, b.room_id, b.start_date, b.end_date, b.summary, b.source, ch.name as channel_name, ch.color as channel_color
       from calendar_blocks b left join channels ch on ch.id = b.channel_id
       where b.start_date < ? and b.end_date > ? order by b.start_date`,
      [end, start]
    );

    res.json({
      start,
      days,
      dates: dates.map((date) => ({ date, weekday: weekdayShort(date), is_today: date === todayISO() })),
      rooms,
      reservations,
      blocks,
      unassigned: reservations.filter((reservation) => !reservation.room_id)
    });
  });

  /* ------------------------------- channels ------------------------------- */
  app.get('/api/channels', requireAuth, (req, res) => {
    const channels = all(
      `select ch.*, (select count(*) from ical_feeds f where f.channel_id = ch.id) as feeds,
        (select count(*) from reservations r where r.channel_id = ch.id and r.status in ('pending','confirmed','checked_in')) as active_reservations
       from channels ch order by ch.name`
    );
    res.json({ channels: channels.map((channel) => ({ ...channel, active: Boolean(channel.active) })) });
  });

  app.post(
    '/api/channels',
    requireAuth,
    requireRole('admin', 'manager'),
    wrap(async (req, res) => {
      const { name, kind, color, commission } = req.body || {};
      const clean = String(name || '').trim();
      if (!clean) throw httpError(400, 'Channel name is required');
      const created = run('insert into channels (name, kind, color, commission, active) values (?,?,?,?,1)', [
        clean,
        String(kind || 'ota'),
        String(color || '#2563eb'),
        Number(commission || 0)
      ]);
      res.status(201).json({ channel: get('select * from channels where id = ?', [created.id]) });
    })
  );

  app.patch(
    '/api/channels/:id',
    requireAuth,
    requireRole('admin', 'manager'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const channel = get('select * from channels where id = ?', [id]);
      if (!channel) throw httpError(404, 'Channel not found');
      const body = req.body || {};
      const updates = [];
      const params = [];
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) throw httpError(400, 'Channel name is required');
        updates.push('name = ?');
        params.push(name);
      }
      if (body.color !== undefined) {
        updates.push('color = ?');
        params.push(String(body.color));
      }
      if (body.commission !== undefined) {
        updates.push('commission = ?');
        params.push(Number(body.commission) || 0);
      }
      if (body.active !== undefined) {
        updates.push('active = ?');
        params.push(body.active ? 1 : 0);
      }
      if (!updates.length) throw httpError(400, 'Nothing to update');
      run(`update channels set ${updates.join(', ')} where id = ?`, [...params, id]);
      res.json({ channel: get('select * from channels where id = ?', [id]) });
    })
  );

  const FEED_SELECT = `select f.*, ch.name as channel_name, ch.color as channel_color,
      rm.number as room_number, rt.name as room_type_name
    from ical_feeds f
    join channels ch on ch.id = f.channel_id
    left join rooms rm on rm.id = f.room_id
    left join room_types rt on rt.id = f.room_type_id`;

  app.get('/api/channels/feeds', requireAuth, (req, res) => {
    const feeds = all(`${FEED_SELECT} order by f.name`).map((row) => feedRow(row, req));
    res.json({ feeds });
  });

  app.post(
    '/api/channels/feeds',
    requireAuth,
    requireRole('admin', 'manager'),
    wrap(async (req, res) => {
      const body = req.body || {};
      const name = String(body.name || '').trim();
      if (!name) throw httpError(400, 'Feed name is required');
      const channelId = Number(body.channel_id);
      if (!get('select id from channels where id = ?', [channelId])) throw httpError(400, 'Choose a valid channel');
      const url = String(body.url || '').trim();
      if (!/^https?:\/\//i.test(url)) throw httpError(400, 'Feed URL must start with http:// or https://');

      const roomId = body.room_id ? Number(body.room_id) : null;
      const roomTypeId = body.room_type_id ? Number(body.room_type_id) : null;
      if (!roomId && !roomTypeId) throw httpError(400, 'Choose a room or a room type for this feed');
      if (roomId && !get('select id from rooms where id = ?', [roomId])) throw httpError(400, 'Choose a valid room');
      if (roomTypeId && !get('select id from room_types where id = ?', [roomTypeId])) {
        throw httpError(400, 'Choose a valid room type');
      }

      const created = run(
        'insert into ical_feeds (name, channel_id, room_id, room_type_id, url, active, created_at) values (?,?,?,?,?,1,?)',
        [name, channelId, roomId, roomId ? null : roomTypeId, url, new Date().toISOString()]
      );
      logActivity(req.user.id, 'channel', `Added ${name} import feed`);
      const feed = get(`${FEED_SELECT} where f.id = ?`, [created.id]);
      res.status(201).json({ feed: feedRow(feed, req) });
    })
  );

  app.patch(
    '/api/channels/feeds/:id',
    requireAuth,
    requireRole('admin', 'manager'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const feed = get('select * from ical_feeds where id = ?', [id]);
      if (!feed) throw httpError(404, 'Feed not found');
      const body = req.body || {};
      const updates = [];
      const params = [];
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) throw httpError(400, 'Feed name is required');
        updates.push('name = ?');
        params.push(name);
      }
      if (body.url !== undefined) {
        const url = String(body.url).trim();
        if (!/^https?:\/\//i.test(url)) throw httpError(400, 'Feed URL must start with http:// or https://');
        updates.push('url = ?');
        params.push(url);
      }
      if (body.active !== undefined) {
        updates.push('active = ?');
        params.push(body.active ? 1 : 0);
      }
      if (!updates.length) throw httpError(400, 'Nothing to update');
      run(`update ical_feeds set ${updates.join(', ')} where id = ?`, [...params, id]);
      res.json({ feed: feedRow(get(`${FEED_SELECT} where f.id = ?`, [id]), req) });
    })
  );

  app.delete(
    '/api/channels/feeds/:id',
    requireAuth,
    requireRole('admin', 'manager'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const feed = get('select * from ical_feeds where id = ?', [id]);
      if (!feed) throw httpError(404, 'Feed not found');
      tx(() => {
        run('delete from calendar_blocks where feed_id = ?', [id]);
        run('delete from ical_feeds where id = ?', [id]);
      });
      logActivity(req.user.id, 'channel', `Removed feed ${feed.name} and its imported blocks`);
      res.json({ ok: true });
    })
  );

  app.post(
    '/api/channels/feeds/:id/sync',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const feed = get('select * from ical_feeds where id = ?', [Number(req.params.id)]);
      if (!feed) throw httpError(404, 'Feed not found');
      const result = await syncFeed(feed);
      logActivity(req.user.id, 'channel', `Synced ${feed.name}: ${result.message || result.error}`);
      res.json({ result });
    })
  );

  app.post(
    '/api/channels/sync',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const feeds = all('select * from ical_feeds where active = 1');
      const results = [];
      for (const feed of feeds) results.push(await syncFeed(feed));
      const conflicts = results.reduce((sum, item) => sum + item.conflicts.length, 0);
      logActivity(req.user.id, 'channel', `Synced ${results.length} channel feed(s)`);
      res.json({ results, conflicts, synced: results.length });
    })
  );

  app.get('/api/channels/export', requireAuth, (req, res) => {
    const root = baseUrl(req);
    const rooms = all(
      `select rm.id, rm.number, rm.floor, rm.ical_token, rt.name as room_type_name
       from rooms rm join room_types rt on rt.id = rm.room_type_id
       where rm.active = 1 order by rm.number`
    ).map((room) => ({
      ...room,
      url: `${root}/ical/${room.ical_token}.ics`,
      webcal: `webcal://${root.replace(/^https?:\/\//, '')}/ical/${room.ical_token}.ics`
    }));
    const feeds = all(`${FEED_SELECT} order by f.name`).map((row) => feedRow(row, req));
    res.json({ rooms, feeds, property: readSettings() });
  });

  app.post(
    '/api/rooms/:id/rotate-ical',
    requireAuth,
    requireRole('admin', 'manager'),
    wrap(async (req, res) => {
      const id = Number(req.params.id);
      const room = get('select * from rooms where id = ?', [id]);
      if (!room) throw httpError(404, 'Room not found');
      run('update rooms set ical_token = ? where id = ?', [randomToken(16), id]);
      logActivity(req.user.id, 'channel', `Rotated export calendar link for room ${room.number}`);
      res.json({ ok: true });
    })
  );

  app.get('/api/channels/blocks', requireAuth, (req, res) => {
    const from = isISODate(req.query.from) ? req.query.from : todayISO();
    const to = isISODate(req.query.to) ? req.query.to : addDays(from, 30);
    const blocks = all(
      `select b.*, rm.number as room_number, ch.name as channel_name, f.name as feed_name
       from calendar_blocks b
       join rooms rm on rm.id = b.room_id
       left join channels ch on ch.id = b.channel_id
       left join ical_feeds f on f.id = b.feed_id
       where b.start_date < ? and b.end_date > ? order by b.start_date`,
      [to, from]
    );
    res.json({ blocks });
  });

  app.post(
    '/api/channels/blocks',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const { room_id: roomId, start_date: start, end_date: end, summary } = req.body || {};
      if (!isISODate(start) || !isISODate(end) || end <= start) {
        throw httpError(400, 'Provide valid block start and end dates');
      }
      const room = get('select * from rooms where id = ?', [Number(roomId)]);
      if (!room) throw httpError(400, 'Choose a valid room');
      const blocked = blockedRoomIds({ from: start, to: end });
      if (blocked.ids.has(room.id)) throw httpError(409, `Room ${room.number} already has a reservation or block in that range`);
      const created = run(
        `insert into calendar_blocks (room_id, start_date, end_date, source, channel_id, feed_id, external_uid, summary, created_at)
         values (?,?,?,?,?,?,?,?,?)`,
        [room.id, start, end, 'manual', null, null, null, String(summary || 'Blocked by front desk').trim(), new Date().toISOString()]
      );
      logActivity(req.user.id, 'channel', `Blocked room ${room.number} ${start} → ${end}`);
      res.status(201).json({ block: get('select * from calendar_blocks where id = ?', [created.id]) });
    })
  );

  app.delete(
    '/api/channels/blocks/:id',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const block = get('select * from calendar_blocks where id = ?', [Number(req.params.id)]);
      if (!block) throw httpError(404, 'Block not found');
      if (block.source === 'ical') {
        throw httpError(409, 'Channel blocks are managed by their feed. Remove the feed or wait for the next sync.');
      }
      run('delete from calendar_blocks where id = ?', [block.id]);
      res.json({ ok: true });
    })
  );

  /* ------------------------------ dashboard ------------------------------ */
  app.get('/api/dashboard', requireAuth, (req, res) => {
    const today = todayISO();
    const tomorrow = addDays(today, 1);

    const arrivals = all(`${RES_SELECT} where r.check_in = ? and r.status in ('pending','confirmed') order by r.code`, [today]).map(
      reservationRow
    );
    const departures = all(`${RES_SELECT} where r.check_out = ? and r.status = 'checked_in' order by r.code`, [today]).map(
      reservationRow
    );
    const inHouse = all(`${RES_SELECT} where r.status = 'checked_in' order by rm.number`).map(reservationRow);

    const totalRoomsRow = get('select count(*) as c from rooms where active = 1');
    const totalRooms = totalRoomsRow ? totalRoomsRow.c : 0;
    const blocked = blockedRoomIds({ from: today, to: tomorrow });
    const occupied = get(
      `select count(distinct room_id) as c from reservations
       where status in ('confirmed','checked_in') and room_id is not null and check_in <= ? and check_out > ?`,
      [today, today]
    );
    const occupiedRooms = occupied ? occupied.c : 0;
    const unavailable = blocked.ids.size + blocked.unassigned;
    const available = Math.max(0, totalRooms - unavailable);

    const statusRows = all(`select status, count(*) as c from rooms where active = 1 group by status`);
    const roomStatus = {};
    for (const row of statusRows) roomStatus[row.status] = row.c;

    const revenueRow = get(`select coalesce(sum(amount * quantity), 0) as total from charges where substr(created_at, 1, 10) = ?`, [today]);
    const feeds = all(`${FEED_SELECT} order by f.name`).map((row) => feedRow(row, req));
    const activity = all(
      `select a.*, u.name as user_name from activity_log a left join users u on u.id = a.user_id
       order by a.id desc limit 12`
    );

    res.json({
      today,
      property: readSettings(),
      stats: {
        total_rooms: totalRooms,
        occupied: occupiedRooms,
        available,
        blocked: blocked.ids.size,
        unassigned: blocked.unassigned,
        occupancy: totalRooms ? Math.round((occupiedRooms / totalRooms) * 100) : 0,
        arrivals: arrivals.length,
        departures: departures.length,
        in_house: inHouse.length,
        dirty: roomStatus.dirty || 0,
        clean: roomStatus.clean || 0,
        inspected: roomStatus.inspected || 0,
        out_of_order: roomStatus.out_of_order || 0,
        revenue_today: money(revenueRow ? revenueRow.total : 0)
      },
      arrivals,
      departures,
      in_house: inHouse,
      room_status: roomStatus,
      feeds,
      activity
    });
  });

  app.get('/api/activity', requireAuth, requireRole('admin', 'manager'), (req, res) => {
    const rows = all(
      `select a.*, u.name as user_name, u.role as user_role from activity_log a
       left join users u on u.id = a.user_id order by a.id desc limit 200`
    );
    res.json({ activity: rows });
  });

  /* --------------------------- public iCal feed --------------------------- */
  app.get('/ical/:file', (req, res) => {
    const token = String(req.params.file || '').replace(/\.ics$/i, '');
    const room = get(
      `select rm.*, rt.name as room_type_name from rooms rm join room_types rt on rt.id = rm.room_type_id where rm.ical_token = ?`,
      [token]
    );
    if (!room) return res.status(404).type('text/plain').send('Calendar not found');
    if (!room.active) return res.status(410).type('text/plain').send('Room is no longer sold');

    const property = readSettings();
    const events = all(
      `select r.id, r.check_in, r.check_out, r.status from reservations r
       where r.room_id = ? and r.status in ('pending','confirmed','checked_in') and r.check_out >= ?
       order by r.check_in`,
      [room.id, addDays(todayISO(), -60)]
    ).map((reservation) => ({
      uid: `res-${reservation.id}@appjet-pms`,
      start: reservation.check_in,
      end: reservation.check_out,
      summary: 'Reserved',
      status: 'CONFIRMED'
    }));

    const body = buildIcal({
      calendarName: `${property.property_name || 'Hotel'} · Room ${room.number}`,
      events
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="room-${room.number}.ics"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  });

  /* -------------------------------- static -------------------------------- */
  const distDir = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api') || req.path.startsWith('/ical')) return next();
      return res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use((req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Endpoint not found' });
    res.status(404).type('text/plain').send('Not found');
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    const status = error.status || 500;
    if (status >= 500) console.error('[api]', error.stack || error.message);
    return res.status(status).json({ error: status >= 500 ? 'Server error' : error.message });
  });

  return app;
}
