/**
 * PCH PMS — licensing, website editor, media, roles, reports, payments and shifts.
 * Mounted from createApp() so the core PMS routes stay untouched.
 */
import express from 'express';
import { all, get, run } from './db.js';
import { requireAuth, requireRole } from './session.js';
import { sendPdf, reportPdf } from './pdf.js';
import { isISODate, todayISO, addDays } from './util.js';

const now = () => new Date().toISOString();

/* ------------------------------ schema ------------------------------ */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    mime TEXT NOT NULL,
    data TEXT NOT NULL,
    bytes INTEGER NOT NULL DEFAULT 0,
    kind TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    base TEXT NOT NULL DEFAULT 'front_desk',
    permissions TEXT NOT NULL DEFAULT '[]',
    builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`
];

export const PERMISSIONS = [
  { key: 'dashboard', label: 'Dashboard & KPIs' },
  { key: 'front_desk', label: 'Front desk & folios' },
  { key: 'reservations', label: 'Reservations' },
  { key: 'guests', label: 'Guest profiles' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'shifts', label: 'Shifts & cash-up' },
  { key: 'channels', label: 'Channel manager' },
  { key: 'rooms', label: 'Rooms & housekeeping' },
  { key: 'reports', label: 'Reports & exports' },
  { key: 'website', label: 'Website editor' },
  { key: 'staff', label: 'Staff accounts' },
  { key: 'roles', label: 'Roles & permissions' },
  { key: 'settings', label: 'Settings' }
];

const ALL_PERMISSIONS = PERMISSIONS.map((permission) => permission.key);

const BUILTIN_ROLES = [
  {
    key: 'admin',
    name: 'Property admin',
    description: 'Full control of the property, staff, roles and licensing.',
    base: 'admin',
    permissions: ALL_PERMISSIONS
  },
  {
    key: 'manager',
    name: 'General manager',
    description: 'Runs the property day to day: rates, staff, website and reports.',
    base: 'manager',
    permissions: ALL_PERMISSIONS.filter((key) => key !== 'roles')
  },
  {
    key: 'front_desk',
    name: 'Front desk',
    description: 'Check-in, check-out, reservations, payments and cash-up.',
    base: 'front_desk',
    permissions: ['dashboard', 'front_desk', 'reservations', 'guests', 'calendar', 'shifts', 'channels', 'rooms', 'reports']
  },
  {
    key: 'housekeeping',
    name: 'Housekeeping',
    description: 'Room status board and today\'s arrivals.',
    base: 'housekeeping',
    permissions: ['dashboard', 'rooms', 'calendar']
  }
];

export const SITE_KEYS = [
  'brand_name',
  'site_headline',
  'site_tagline',
  'site_about',
  'site_notice',
  'site_accent',
  'site_hero_image',
  'site_gallery',
  'site_facilities',
  'site_whatsapp',
  'site_map_url',
  'site_domain',
  'site_domain_status',
  'site_domain_note',
  'payment_card_enabled',
  'payment_deposit_percent'
];

const SITE_DEFAULTS = {
  brand_name: 'PCH PMS',
  site_facilities:
    'Free high-speed Wi-Fi|24-hour power supply|Secure parking|Daily housekeeping|Air conditioning|Smart TV|24-hour security|Airport pickup on request',
  site_hero_image: '/hero.svg',
  site_gallery: '[]',
  site_domain: '',
  site_domain_status: 'not_configured',
  site_domain_note: '',
  site_whatsapp: '',
  site_map_url: '',
  payment_card_enabled: '1',
  payment_deposit_percent: '100'
};

function ensureSchema() {
  for (const statement of SCHEMA) run(statement);
  for (const role of BUILTIN_ROLES) {
    run(
      `insert into roles (key, name, description, base, permissions, builtin, created_at)
       values (?,?,?,?,?,1,?)
       on conflict(key) do update set name = excluded.name, description = excluded.description, base = excluded.base, permissions = excluded.permissions, builtin = 1`,
      [role.key, role.name, role.description, role.base, JSON.stringify(role.permissions), now()]
    );
  }
  for (const [key, value] of Object.entries(SITE_DEFAULTS)) {
    run('insert into settings (key, value) values (?, ?) on conflict(key) do nothing', [key, value]);
  }
}

/* ------------------------------ helpers ------------------------------ */

function setting(key, fallback = '') {
  const row = get('select value from settings where key = ?', [key]);
  return row && row.value !== null && row.value !== undefined ? row.value : fallback;
}

function putSetting(key, value) {
  run('insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value', [
    key,
    String(value)
  ]);
}

function readSite() {
  const site = {};
  for (const key of SITE_KEYS) site[key] = setting(key, SITE_DEFAULTS[key] ?? '');
  let gallery = [];
  try {
    gallery = JSON.parse(site.site_gallery || '[]');
  } catch {
    gallery = [];
  }
  site.gallery = Array.isArray(gallery) ? gallery : [];
  site.facilities = String(site.site_facilities || '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
  site.payment_card_enabled = String(site.payment_card_enabled) === '1';
  site.payment_deposit_percent = Number(site.payment_deposit_percent || 100);
  return site;
}

function readProperty() {
  const out = {};
  for (const row of all('select key, value from settings')) out[row.key] = row.value;
  return out;
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(headers, rows) {
  const lines = [headers.map((header) => csvCell(header.label)).join(',')];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header.key])).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

const dayMs = 86400000;
const dateMs = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
const daysBetween = (from, to) => Math.max(0, Math.round((dateMs(to) - dateMs(from)) / dayMs));

function rangeFromQuery(query) {
  const to = isISODate(query.to) ? query.to : todayISO();
  const from = isISODate(query.from) ? query.from : addDays(to, -29);
  if (dateMs(from) > dateMs(to)) throw httpError(400, 'The start date must be before the end date');
  if (daysBetween(from, to) > 400) throw httpError(400, 'Choose a range of 400 days or less');
  return { from, to };
}

/* ------------------------------ report core ------------------------------ */

function buildReport(from, to) {
  const property = readProperty();
  const currency = property.currency || 'NGN';
  const days = Math.max(1, daysBetween(from, to) + 1);
  const roomCount = get('select count(*) as count from rooms where active = 1').count || 0;

  const reservations = all(
    `select r.id, r.code, r.check_in, r.check_out, r.status, r.rate, r.adults, r.children,
            r.external_ref, g.first_name || ' ' || g.last_name as guest_name, g.email as guest_email,
            rt.name as room_type_name, rt.section as room_section,
            rm.number as room_number, c.name as channel_name
       from reservations r
       join guests g on g.id = r.guest_id
       join room_types rt on rt.id = r.room_type_id
       left join rooms rm on rm.id = r.room_id
       left join channels c on c.id = r.channel_id
      where r.check_in < ? and r.check_out > ? and r.status != 'cancelled'
      order by r.check_in`,
    [to, from]
  );

  let roomNights = 0;
  let roomRevenue = 0;
  const byChannel = new Map();
  const byRoomType = new Map();
  const daily = [];

  for (let index = 0; index < days; index += 1) {
    const date = addDays(from, index);
    daily.push({ date, rooms: 0, room_revenue: 0, payments: 0, arrivals: 0, departures: 0 });
  }
  const dailyIndex = new Map(daily.map((row) => [row.date, row]));

  for (const reservation of reservations) {
    const start = Math.max(dateMs(reservation.check_in), dateMs(from));
    const end = Math.min(dateMs(reservation.check_out), dateMs(to) + dayMs);
    const nights = Math.max(0, Math.round((end - start) / dayMs));
    const revenue = nights * Number(reservation.rate || 0);
    roomNights += nights;
    roomRevenue += revenue;

    const channelKey = reservation.channel_name || 'Direct';
    const channel = byChannel.get(channelKey) || { name: channelKey, room_nights: 0, revenue: 0, bookings: 0 };
    channel.room_nights += nights;
    channel.revenue += revenue;
    channel.bookings += 1;
    byChannel.set(channelKey, channel);

    const typeKey = reservation.room_type_name || 'Unassigned';
    const type = byRoomType.get(typeKey) || { name: typeKey, room_nights: 0, revenue: 0, bookings: 0 };
    type.room_nights += nights;
    type.revenue += revenue;
    type.bookings += 1;
    byRoomType.set(typeKey, type);

    for (let cursor = start; cursor < end; cursor += dayMs) {
      const key = new Date(cursor).toISOString().slice(0, 10);
      const bucket = dailyIndex.get(key);
      if (!bucket) continue;
      bucket.rooms += 1;
      bucket.room_revenue += Number(reservation.rate || 0);
      if (reservation.check_in === key) bucket.arrivals += 1;
      if (reservation.check_out === key) bucket.departures += 1;
    }
  }

  const payments = all(
    `select p.id, p.amount, p.method, p.reference, p.created_at, r.code, r.check_in, r.check_out,
            g.first_name || ' ' || g.last_name as guest_name
       from payments p
       join reservations r on r.id = p.reservation_id
       join guests g on g.id = r.guest_id
      where date(p.created_at) between ? and ?
      order by p.created_at desc`,
    [from, to]
  );

  const byMethod = new Map();
  let paymentsTotal = 0;
  for (const payment of payments) {
    paymentsTotal += Number(payment.amount || 0);
    const key = String(payment.method || 'other');
    const entry = byMethod.get(key) || { method: key, count: 0, total: 0 };
    entry.count += 1;
    entry.total += Number(payment.amount || 0);
    byMethod.set(key, entry);
    const bucket = dailyIndex.get(String(payment.created_at).slice(0, 10));
    if (bucket) bucket.payments += Number(payment.amount || 0);
  }

  const cancelled = get(
    `select count(*) as count from reservations where status = 'cancelled' and check_in >= ? and check_in < ?`,
    [from, addDays(to, 1)]
  ).count;

  const availableRoomNights = roomCount * days;
  const round = (value) => Math.round(Number(value || 0) * 100) / 100;

  return {
    property: {
      name: property.property_name || 'Richgates Apartments',
      address: property.property_address || '',
      phone: property.property_phone || '',
      email: property.property_email || ''
    },
    range: { from, to, days },
    currency,
    kpis: {
      room_nights: roomNights,
      available_room_nights: availableRoomNights,
      occupancy: availableRoomNights ? round((roomNights / availableRoomNights) * 100) : 0,
      room_revenue: round(roomRevenue),
      payments_total: round(paymentsTotal),
      adr: roomNights ? round(roomRevenue / roomNights) : 0,
      revpar: availableRoomNights ? round(roomRevenue / availableRoomNights) : 0,
      bookings: reservations.length,
      cancelled: cancelled || 0,
      rooms: roomCount,
      arrivals: reservations.filter((row) => row.check_in >= from && row.check_in <= to).length,
      departures: reservations.filter((row) => row.check_out >= from && row.check_out <= to).length
    },
    daily: daily.map((row) => ({
      ...row,
      room_revenue: round(row.room_revenue),
      payments: round(row.payments),
      occupancy: roomCount ? round((row.rooms / roomCount) * 100) : 0
    })),
    by_channel: [...byChannel.values()].map((row) => ({ ...row, revenue: round(row.revenue) })).sort((a, b) => b.revenue - a.revenue),
    by_room_type: [...byRoomType.values()].map((row) => ({ ...row, revenue: round(row.revenue) })).sort((a, b) => b.revenue - a.revenue),
    by_method: [...byMethod.values()].map((row) => ({ ...row, total: round(row.total) })).sort((a, b) => b.total - a.total),
    reservations: reservations.map((row) => ({ ...row, nights: daysBetween(row.check_in, row.check_out), revenue: round(daysBetween(row.check_in, row.check_out) * Number(row.rate || 0)) })),
    payments: payments.map((row) => ({ ...row, amount: round(row.amount) }))
  };
}

/* ------------------------------ mount ------------------------------ */

export function registerExtras(app) {
  ensureSchema();

  /* ---------- website settings ---------- */
  app.get('/api/site', requireAuth, (req, res) => {
    res.json({ site: readSite(), permissions: PERMISSIONS, property: readProperty() });
  });

  app.put(
    '/api/site',
    requireAuth,
    requireRole('admin', 'manager'),
    wrap(async (req, res) => {
      const body = req.body || {};
      for (const key of SITE_KEYS) {
        if (body[key] === undefined) continue;
        let value = body[key];
        if (key === 'site_gallery') {
          if (!Array.isArray(value)) throw httpError(400, 'Gallery must be a list of images');
          value = JSON.stringify(
            value
              .filter((item) => item && item.url)
              .slice(0, 24)
              .map((item) => ({ url: String(item.url).slice(0, 500), caption: String(item.caption || '').slice(0, 120) }))
          );
        }
        if (key === 'site_facilities') {
          value = Array.isArray(value) ? value.join('|') : String(value);
        }
        if (key === 'payment_card_enabled') value = value ? '1' : '0';
        if (key === 'payment_deposit_percent') {
          const percent = Number(value);
          if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
            throw httpError(400, 'Deposit must be between 0 and 100 percent');
          }
          value = String(Math.round(percent));
        }
        if (key === 'site_accent' && !/^#[0-9a-fA-F]{6}$/.test(String(value))) {
          throw httpError(400, 'Accent colour must be a hex value like #0f766e');
        }
        if (key === 'site_domain') {
          const domain = String(value || '').trim().toLowerCase();
          if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw httpError(400, 'Enter a domain like bookings.richgates.com');
          value = domain;
        }
        putSetting(key, String(value).slice(0, 4000));
      }
      res.json({ site: readSite() });
    })
  );

  app.get('/api/public/site', (req, res) => {
    const site = readSite();
    res.json({
      brand_name: site.brand_name,
      hero_image: site.site_hero_image,
      gallery: site.gallery,
      facilities: site.facilities,
      whatsapp: site.site_whatsapp,
      map_url: site.site_map_url,
      domain: site.site_domain,
      card_payments: site.payment_card_enabled,
      deposit_percent: site.payment_deposit_percent
    });
  });

  /* ---------- media library ---------- */
  app.post(
    '/api/media',
    requireAuth,
    requireRole('admin', 'manager'),
    express.raw({ type: () => true, limit: '8mb' }),
    wrap(async (req, res) => {
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!/^image\/(png|jpe?g|webp|gif|avif|svg\+xml)$/.test(mime)) {
        throw httpError(400, 'Upload a PNG, JPEG, WebP, GIF, AVIF or SVG image');
      }
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!buffer.length) throw httpError(400, 'The uploaded file was empty');
      if (buffer.length > 6 * 1024 * 1024) throw httpError(400, 'Images must be 6 MB or smaller');
      const filename = String(req.headers['x-filename'] || 'upload').slice(0, 120);
      const kind = String(req.headers['x-kind'] || 'gallery').slice(0, 30);
      run('insert into media (filename, mime, data, bytes, kind, created_by, created_at) values (?,?,?,?,?,?,?)', [
        filename,
        mime,
        buffer.toString('base64'),
        buffer.length,
        kind,
        req.user.id,
        now()
      ]);
      const row = get('select id, filename, mime, bytes, kind, created_at from media order by id desc limit 1');
      res.status(201).json({ media: { ...row, url: `/api/media/${row.id}` } });
    })
  );

  app.get('/api/media', requireAuth, (req, res) => {
    const rows = all('select id, filename, mime, bytes, kind, created_at from media order by id desc limit 120');
    res.json({ media: rows.map((row) => ({ ...row, url: `/api/media/${row.id}` })) });
  });

  app.get('/api/media/:id', (req, res) => {
    const row = get('select mime, data, bytes from media where id = ?', [Number(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'Image not found' });
    const buffer = Buffer.from(row.data, 'base64');
    res.setHeader('Content-Type', row.mime);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(buffer);
  });

  app.delete(
    '/api/media/:id',
    requireAuth,
    requireRole('admin', 'manager'),
    (req, res) => {
      run('delete from media where id = ?', [Number(req.params.id)]);
      res.json({ ok: true });
    }
  );

  /* ---------- roles ---------- */
  const readRoles = () =>
    all('select key, name, description, base, permissions, builtin, created_at from roles order by builtin desc, name').map(
      (row) => {
        let permissions = [];
        try {
          permissions = JSON.parse(row.permissions || '[]');
        } catch {
          permissions = [];
        }
        return { ...row, builtin: Boolean(row.builtin), permissions };
      }
    );

  app.get('/api/roles', requireAuth, (req, res) => {
    res.json({ roles: readRoles(), permissions: PERMISSIONS });
  });

  app.post(
    '/api/roles',
    requireAuth,
    requireRole('admin'),
    wrap(async (req, res) => {
      const { name, description, base, permissions } = req.body || {};
      const label = String(name || '').trim();
      if (label.length < 3) throw httpError(400, 'Give the role a name of at least 3 characters');
      const key = slug(label);
      if (!key) throw httpError(400, 'Use letters and numbers in the role name');
      if (get('select id from roles where key = ?', [key])) throw httpError(409, 'A role with that name already exists');
      const baseRole = ['admin', 'manager', 'front_desk', 'housekeeping'].includes(base) ? base : 'front_desk';
      const allowed = Array.isArray(permissions) ? permissions.filter((item) => ALL_PERMISSIONS.includes(item)) : [];
      run('insert into roles (key, name, description, base, permissions, builtin, created_at) values (?,?,?,?,?,0,?)', [
        key,
        label,
        String(description || '').slice(0, 300),
        baseRole,
        JSON.stringify(allowed),
        now()
      ]);
      res.status(201).json({ roles: readRoles() });
    })
  );

  app.patch(
    '/api/roles/:key',
    requireAuth,
    requireRole('admin'),
    wrap(async (req, res) => {
      const row = get('select * from roles where key = ?', [req.params.key]);
      if (!row) throw httpError(404, 'Role not found');
      const body = req.body || {};
      const name = body.name === undefined ? row.name : String(body.name).trim();
      if (name.length < 3) throw httpError(400, 'Give the role a name of at least 3 characters');
      const base = body.base === undefined ? row.base : body.base;
      const baseRole = ['admin', 'manager', 'front_desk', 'housekeeping'].includes(base) ? base : row.base;
      let permissions = row.permissions;
      if (Array.isArray(body.permissions)) {
        permissions = JSON.stringify(body.permissions.filter((item) => ALL_PERMISSIONS.includes(item)));
      }
      const description = body.description === undefined ? row.description : String(body.description).slice(0, 300);
      if (row.builtin && baseRole !== row.base) throw httpError(400, 'The base access level of a built-in role cannot change');
      run('update roles set name = ?, description = ?, base = ?, permissions = ? where key = ?', [
        name,
        description,
        baseRole,
        permissions,
        row.key
      ]);
      res.json({ roles: readRoles() });
    })
  );

  app.delete(
    '/api/roles/:key',
    requireAuth,
    requireRole('admin'),
    (req, res) => {
      const row = get('select * from roles where key = ?', [req.params.key]);
      if (!row) return res.status(404).json({ error: 'Role not found' });
      if (row.builtin) return res.status(400).json({ error: 'Built-in roles cannot be deleted' });
      const inUse = get('select count(*) as count from users where role = ?', [row.key]).count;
      if (inUse) return res.status(400).json({ error: `${inUse} staff member(s) still use this role. Reassign them first.` });
      run('delete from roles where key = ?', [row.key]);
      return res.json({ roles: readRoles() });
    }
  );

  /* ---------- reports ---------- */
  app.get('/api/reports/summary', requireAuth, requireRole('admin', 'manager', 'front_desk'), (req, res) => {
    const { from, to } = rangeFromQuery(req.query || {});
    res.json(buildReport(from, to));
  });

  app.get('/api/reports/export.csv', requireAuth, requireRole('admin', 'manager', 'front_desk'), (req, res) => {
    const { from, to } = rangeFromQuery(req.query || {});
    const report = buildReport(from, to);
    const type = String(req.query.type || 'reservations');
    let headers;
    let rows;
    if (type === 'payments') {
      headers = [
        { key: 'created_at', label: 'Date' },
        { key: 'code', label: 'Booking' },
        { key: 'guest_name', label: 'Guest' },
        { key: 'method', label: 'Method' },
        { key: 'reference', label: 'Reference' },
        { key: 'amount', label: `Amount (${report.currency})` }
      ];
      rows = report.payments;
    } else if (type === 'daily') {
      headers = [
        { key: 'date', label: 'Date' },
        { key: 'rooms', label: 'Rooms occupied' },
        { key: 'occupancy', label: 'Occupancy %' },
        { key: 'arrivals', label: 'Arrivals' },
        { key: 'departures', label: 'Departures' },
        { key: 'room_revenue', label: `Room revenue (${report.currency})` },
        { key: 'payments', label: `Payments (${report.currency})` }
      ];
      rows = report.daily;
    } else if (type === 'channels') {
      headers = [
        { key: 'name', label: 'Channel' },
        { key: 'bookings', label: 'Bookings' },
        { key: 'room_nights', label: 'Room nights' },
        { key: 'revenue', label: `Room revenue (${report.currency})` }
      ];
      rows = report.by_channel;
    } else {
      headers = [
        { key: 'code', label: 'Booking' },
        { key: 'guest_name', label: 'Guest' },
        { key: 'room_type_name', label: 'Room type' },
        { key: 'room_number', label: 'Room' },
        { key: 'check_in', label: 'Arrival' },
        { key: 'check_out', label: 'Departure' },
        { key: 'nights', label: 'Nights' },
        { key: 'status', label: 'Status' },
        { key: 'channel_name', label: 'Channel' },
        { key: 'rate', label: `Rate (${report.currency})` },
        { key: 'revenue', label: `Revenue (${report.currency})` }
      ];
      rows = report.reservations;
    }
    const filename = `pch-report-${type}-${from}_to_${to}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(toCsv(headers, rows));
  });

  app.get('/api/reports/export.pdf', requireAuth, requireRole('admin', 'manager', 'front_desk'), (req, res) => {
    const { from, to } = rangeFromQuery(req.query || {});
    const report = buildReport(from, to);
    sendPdf(res, `pch-report-${from}_to_${to}.pdf`, reportPdf(report));
  });

  /* ---------- shift start / end ---------- */
  const shiftTotals = (shift) => {
    const payments = all(
      `select p.amount, p.method from payments p where p.created_at >= ? and p.created_at <= ?`,
      [shift.opened_at, shift.closed_at || now()]
    );
    const byMethod = new Map();
    let total = 0;
    let cash = 0;
    for (const payment of payments) {
      total += Number(payment.amount || 0);
      if (String(payment.method) === 'cash') cash += Number(payment.amount || 0);
      const key = String(payment.method || 'other');
      const entry = byMethod.get(key) || { method: key, count: 0, total: 0 };
      entry.count += 1;
      entry.total += Number(payment.amount || 0);
      byMethod.set(key, entry);
    }
    return {
      payments_total: Math.round(total * 100) / 100,
      cash_total: Math.round(cash * 100) / 100,
      expected_cash: Math.round((Number(shift.opening_float || 0) + cash) * 100) / 100,
      by_method: [...byMethod.values()]
    };
  };

  const openShift = (userId) => get("select * from shifts where user_id = ? and status = 'open' order by id desc limit 1", [userId]);

  app.get('/api/shift/state', requireAuth, (req, res) => {
    const shift = openShift(req.user.id);
    res.json({
      open: Boolean(shift),
      shift: shift ? { ...shift, totals: shiftTotals(shift) } : null,
      user: { id: req.user.id, name: req.user.name, role: req.user.role }
    });
  });

  app.post(
    '/api/shift/start',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      if (openShift(req.user.id)) throw httpError(400, 'You already have an open shift. End it before starting a new one.');
      const float = Number((req.body || {}).opening_float || 0);
      if (!Number.isFinite(float) || float < 0) throw httpError(400, 'Opening float must be zero or more');
      run('insert into shifts (user_id, opened_at, opening_float, status) values (?,?,?,?)', [
        req.user.id,
        now(),
        Math.round(float * 100) / 100,
        'open'
      ]);
      const shift = openShift(req.user.id);
      res.status(201).json({ open: true, shift: { ...shift, totals: shiftTotals(shift) } });
    })
  );

  app.post(
    '/api/shift/end',
    requireAuth,
    requireRole('admin', 'manager', 'front_desk'),
    wrap(async (req, res) => {
      const shift = openShift(req.user.id);
      if (!shift) throw httpError(400, 'There is no open shift to end');
      const body = req.body || {};
      const totals = shiftTotals(shift);
      const counted = body.counted_cash === undefined || body.counted_cash === '' ? null : Number(body.counted_cash);
      if (counted !== null && (!Number.isFinite(counted) || counted < 0)) {
        throw httpError(400, 'Counted cash must be zero or more');
      }
      const closedAt = now();
      const variance = counted === null ? null : Math.round((counted - totals.expected_cash) * 100) / 100;
      run(
        'update shifts set closed_at = ?, counted_cash = ?, expected_cash = ?, variance = ?, closing_notes = ?, status = ? where id = ?',
        [closedAt, counted, totals.expected_cash, variance, String(body.closing_notes || '').slice(0, 1000), 'closed', shift.id]
      );
      const closed = get('select * from shifts where id = ?', [shift.id]);
      res.json({ open: false, shift: { ...closed, totals: shiftTotals(closed) } });
    })
  );

  app.get('/api/shift/history', requireAuth, (req, res) => {
    const mine = String((req.query || {}).scope || 'mine') === 'all' && ['admin', 'manager'].includes(req.user.role);
    const rows = all(
      `select s.*, u.name as cashier_name from shifts s join users u on u.id = s.user_id
        ${mine ? '' : 'where s.user_id = ' + Number(req.user.id)}
        order by s.id desc limit 40`
    );
    res.json({
      shifts: rows.map((row) => ({
        ...row,
        totals: { ...shiftTotals(row), variance: row.variance, counted_cash: row.counted_cash }
      }))
    });
  });

  /* ---------- card payments on the public site ---------- */
  const luhn = (value) => {
    const digits = String(value).replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let double = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (double) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      double = !double;
    }
    return sum % 10 === 0;
  };

  const cardBrand = (digits) => {
    if (/^4/.test(digits)) return 'Visa';
    if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
    if (/^3[47]/.test(digits)) return 'American Express';
    if (/^(506[01]|6500|6501)/.test(digits)) return 'Verve';
    if (/^6(011|5)/.test(digits)) return 'Discover';
    return 'Card';
  };

  app.post(
    '/api/public/bookings/:code/payment',
    wrap(async (req, res) => {
      if (String(setting('payment_card_enabled', '1')) !== '1') {
        throw httpError(400, 'Card payment is currently switched off for this property');
      }
      const reservation = get(
        `select r.*, rt.name as room_type_name from reservations r join room_types rt on rt.id = r.room_type_id where upper(r.code) = upper(?)`,
        [String(req.params.code || '').trim()]
      );
      if (!reservation) throw httpError(404, 'Booking not found');
      if (reservation.status === 'cancelled') throw httpError(400, 'This booking was cancelled');

      const card = (req.body || {}).card || {};
      const number = String(card.number || '').replace(/\s+/g, '');
      const name = String(card.name || '').trim();
      const expiry = String(card.expiry || '').trim();
      const cvc = String(card.cvc || '').trim();

      if (!luhn(number)) throw httpError(400, 'That card number is not valid. Check the digits and try again.');
      if (name.length < 3) throw httpError(400, 'Enter the cardholder name as printed on the card');
      const match = /^(\d{2})\s*\/\s*(\d{2,4})$/.exec(expiry);
      if (!match) throw httpError(400, 'Use the expiry date format MM/YY');
      const month = Number(match[1]);
      const year = Number(match[2].length === 2 ? `20${match[2]}` : match[2]);
      if (month < 1 || month > 12) throw httpError(400, 'Card expiry month is invalid');
      const expiryEnd = new Date(Date.UTC(year, month, 1));
      if (expiryEnd.getTime() <= Date.now()) throw httpError(400, 'That card has expired');
      if (!/^\d{3,4}$/.test(cvc)) throw httpError(400, 'The security code must be 3 or 4 digits');

      const nights = daysBetween(reservation.check_in, reservation.check_out);
      const total = Math.round(Number(reservation.rate || 0) * nights * 100) / 100;
      const percent = Number(setting('payment_deposit_percent', '100'));
      const amount = Math.round((total * (percent / 100)) * 100) / 100;
      if (amount <= 0) throw httpError(400, 'Nothing to pay for this booking');

      const digits = number.replace(/\D/g, '');
      const last4 = digits.slice(-4);
      const brand = cardBrand(digits);
      const reference = `${brand} •••• ${last4}`;
      run('insert into payments (reservation_id, amount, method, reference, created_by, created_at) values (?,?,?,?,?,?)', [
        reservation.id,
        amount,
        'card',
        reference,
        null,
        now()
      ]);
      const shift = openShift(0);
      if (shift) run('update payments set shift_id = ? where id = (select max(id) from payments)', [shift.id]);

      res.status(201).json({
        payment: { amount, method: 'card', reference, brand, last4, deposit_percent: percent },
        reservation: {
          code: reservation.code,
          check_in: reservation.check_in,
          check_out: reservation.check_out,
          room_type_name: reservation.room_type_name,
          total,
          paid: amount,
          balance: Math.round((total - amount) * 100) / 100
        }
      });
    })
  );

  /* ---------- licence / tenant info ---------- */
  app.get('/api/licence', requireAuth, (req, res) => {
    const property = readProperty();
    res.json({
      product: 'PCH PMS',
      vendor: 'PCH Hospitality Systems',
      edition: property.licence_edition || 'Multi-property licence',
      tenant: property.property_name || 'Richgates Apartments',
      properties_allowed: Number(property.licence_properties || 5),
      support_email: property.licence_support_email || 'support@pchpms.com',
      installed_at: setting('licence_installed_at', '')
    });
  });
}
