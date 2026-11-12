import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { hashPassword, randomToken } from './password.js';
import { todayISO, addDays, nights, money } from './util.js';

const require = createRequire(import.meta.url);

let SQL = null;
let db = null;
let dbFile = null;
let persistTimer = null;
let persistDisabled = false;
let dataDirUsed = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'front_desk',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS room_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  capacity INTEGER NOT NULL DEFAULT 2,
  base_rate REAL NOT NULL DEFAULT 100,
  description TEXT
);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  floor INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'clean',
  notes TEXT,
  ical_token TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  country TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  vip INTEGER NOT NULL DEFAULT 0,
  company TEXT,
  address TEXT,
  city TEXT,
  id_type TEXT,
  id_number TEXT,
  birth_date TEXT,
  preferences TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  blacklisted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'ota',
  color TEXT NOT NULL DEFAULT '#2563eb',
  commission REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS ical_feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  channel_id INTEGER NOT NULL REFERENCES channels(id),
  room_id INTEGER REFERENCES rooms(id),
  room_type_id INTEGER REFERENCES room_types(id),
  url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  last_status TEXT,
  last_message TEXT,
  last_event_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  guest_id INTEGER NOT NULL REFERENCES guests(id),
  room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  room_id INTEGER REFERENCES rooms(id),
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  adults INTEGER NOT NULL DEFAULT 1,
  children INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed',
  channel_id INTEGER REFERENCES channels(id),
  external_ref TEXT,
  rate REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT,
  checked_in_at TEXT,
  checked_out_at TEXT,
  cancelled_at TEXT
);
CREATE TABLE IF NOT EXISTS charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  amount REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'card',
  reference TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  shift_id INTEGER REFERENCES shifts(id)
);
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opening_float REAL NOT NULL DEFAULT 0,
  counted_cash REAL,
  expected_cash REAL,
  variance REAL,
  notes TEXT,
  closing_notes TEXT,
  status TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS calendar_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ical',
  channel_id INTEGER REFERENCES channels(id),
  feed_id INTEGER REFERENCES ical_feeds(id) ON DELETE CASCADE,
  external_uid TEXT,
  summary TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_res_dates ON reservations (check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_res_room ON reservations (room_id);
CREATE INDEX IF NOT EXISTS idx_blocks_dates ON calendar_blocks (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_blocks_feed ON calendar_blocks (feed_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts (status);
CREATE INDEX IF NOT EXISTS idx_shifts_user ON shifts (user_id);
CREATE INDEX IF NOT EXISTS idx_guests_name ON guests (last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_payments_shift ON payments (shift_id);
`;

function normalizeParams(params = []) {
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
}

export function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(normalizeParams(params));
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

export function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

export function run(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(normalizeParams(params));
    stmt.step();
  } finally {
    stmt.free();
  }
  const inserted = get('select last_insert_rowid() as id');
  schedulePersist();
  return { id: inserted ? inserted.id : null, changes: db.getRowsModified() };
}

export function exec(sql) {
  db.run(sql);
  schedulePersist();
}

export function tx(fn) {
  db.run('BEGIN');
  try {
    const result = fn();
    db.run('COMMIT');
    schedulePersist();
    return result;
  } catch (error) {
    try {
      db.run('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw error;
  }
}

export function schedulePersist() {
  if (persistDisabled || !dbFile || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persist();
  }, 40);
  if (typeof persistTimer.unref === 'function') persistTimer.unref();
}

export function persist() {
  if (!dbFile || persistDisabled) return;
  try {
    const data = Buffer.from(db.export());
    const tmp = `${dbFile}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dbFile);
  } catch (error) {
    console.error(`[db] could not persist database: ${error.message}`);
    persistDisabled = true;
  }
}

export function getDataDir() {
  return dataDirUsed;
}

function pickDataDir() {
  const candidates = [
    process.env.DATA_DIR,
    path.join(process.cwd(), 'data'),
    path.join(os.tmpdir(), 'appjet-pms-data')
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

export async function initDb() {
  if (db) return db;
  const wasmDir = path.dirname(require.resolve('sql.js'));
  SQL = await initSqlJs({ locateFile: (file) => path.join(wasmDir, file) });

  dataDirUsed = pickDataDir();
  if (dataDirUsed) {
    dbFile = path.join(dataDirUsed, 'pms.sqlite');
    if (fs.existsSync(dbFile)) {
      try {
        db = new SQL.Database(fs.readFileSync(dbFile));
      } catch (error) {
        console.error(`[db] existing database unreadable (${error.message}); starting fresh`);
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
    persistDisabled = true;
    console.warn('[db] no writable data directory found; running in memory only');
  }

  db.run('PRAGMA foreign_keys = ON;');
  db.run(SCHEMA);
  seedIfEmpty();
  migrate();
  persist();
  return db;
}

export function closeDb() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persist();
  if (db) db.close();
  db = null;
}

/* ------------------------------ seed data ------------------------------ */

function seedIfEmpty() {
  const existing = get('select count(*) as c from users');
  if (existing && existing.c > 0) return;

  const now = new Date().toISOString();
  const today = todayISO();

  const settings = {
    property_name: 'PCH Hotel',
    property_address: '12 Marina Parade, Lisbon, Portugal',
    property_phone: '+351 210 000 000',
    property_email: 'stay@pchhotel.example',
    currency: 'EUR',
    check_in_time: '15:00',
    check_out_time: '11:00',
    timezone: 'Europe/Lisbon',
    site_headline: 'Boutique stays, booked direct',
    site_tagline: 'Best available rate, instant confirmation and no booking fees.',
    site_about:
      'PCH Hotel sits two minutes from the marina, with 11 individually styled rooms, a rooftop terrace and breakfast served until noon. Book direct for the lowest rate and a free upgrade when available.',
    site_notice: 'Free cancellation up to 48 hours before arrival.',
    site_accent: '#0f766e'
  };
  for (const [key, value] of Object.entries(settings)) {
    run('insert or ignore into settings (key, value) values (?, ?)', [key, value]);
  }

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@hotelpms.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';

  const users = [
    ['Hotel Admin', adminEmail, adminPassword, 'admin'],
    ['Sofia Reception', 'frontdesk@hotelpms.local', 'Front123!', 'front_desk'],
    ['Marco Housekeeping', 'housekeeping@hotelpms.local', 'House123!', 'housekeeping'],
    ['Nadia Manager', 'manager@hotelpms.local', 'Manager123!', 'manager']
  ];
  for (const [name, email, password, role] of users) {
    run('insert into users (name, email, password_hash, role, active, created_at) values (?,?,?,?,1,?)', [
      name,
      email,
      hashPassword(password),
      role,
      now
    ]);
  }

  const channels = [
    ['Direct', 'direct', '#0ea5e9', 0],
    ['PCH Website', 'website', '#0f766e', 0],
    ['Booking.com', 'ota', '#1d4ed8', 15],
    ['Airbnb', 'ota', '#e11d48', 3],
    ['Expedia', 'ota', '#f59e0b', 18],
    ['Agoda', 'ota', '#7c3aed', 17]
  ];
  for (const [name, kind, color, commission] of channels) {
    run('insert into channels (name, kind, color, commission, active) values (?,?,?,?,1)', [name, kind, color, commission]);
  }

  const roomTypes = [
    ['Standard Queen', 'STDQ', 2, 120, 'Queen bed, city view, 22 m²'],
    ['Deluxe King', 'DLXK', 2, 165, 'King bed, balcony, 30 m²'],
    ['Twin Room', 'TWIN', 2, 110, 'Two single beds, 20 m²'],
    ['Family Suite', 'FAML', 4, 240, 'Two bedrooms, living area, 45 m²']
  ];
  for (const [name, codeValue, capacity, baseRate, description] of roomTypes) {
    run('insert into room_types (name, code, capacity, base_rate, description) values (?,?,?,?,?)', [
      name,
      codeValue,
      capacity,
      baseRate,
      description
    ]);
  }

  const rooms = [
    ['101', 1, 1], ['102', 1, 1], ['103', 1, 1], ['104', 3, 1], ['105', 3, 1], ['106', 1, 1],
    ['201', 2, 2], ['202', 2, 2], ['203', 2, 2], ['204', 4, 2], ['205', 4, 2]
  ];
  for (const [number, typeId, floor] of rooms) {
    run('insert into rooms (number, room_type_id, floor, status, ical_token, active) values (?,?,?,?,?,1)', [
      number,
      typeId,
      floor,
      number === '106' ? 'dirty' : 'clean',
      randomToken(16)
    ]);
  }

  const roomByNumber = {};
  for (const room of all('select id, number from rooms')) roomByNumber[room.number] = room.id;

  const guest = (first, last, email, phone, country) => {
    run('insert into guests (first_name, last_name, email, phone, country, created_at) values (?,?,?,?,?,?)', [
      first,
      last,
      email,
      phone,
      country,
      now
    ]);
    return get('select last_insert_rowid() as id').id;
  };

  const reservation = ({ guestId, typeId, roomNumber, from, to, status, channelId, ref, rate, adults = 2, children = 0, notes = null }) => {
    const checkIn = addDays(today, from);
    const checkOut = addDays(today, to);
    const total = money(rate * nights(checkIn, checkOut));
    run(
      `insert into reservations (code, guest_id, room_type_id, room_id, check_in, check_out, adults, children, status, channel_id, external_ref, rate, notes, created_by, created_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        `R-${String(Math.floor(Math.random() * 900000) + 100000)}`,
        guestId,
        typeId,
        roomNumber ? roomByNumber[roomNumber] : null,
        checkIn,
        checkOut,
        adults,
        children,
        status,
        channelId,
        ref,
        rate,
        notes,
        1,
        now
      ]
    );
    const id = get('select last_insert_rowid() as id').id;
    run('insert into charges (reservation_id, description, amount, quantity, created_by, created_at) values (?,?,?,?,?,?)', [
      id,
      `Room charge · ${nights(checkIn, checkOut)} night(s)`,
      total,
      1,
      1,
      now
    ]);
    if (status === 'checked_in') {
      run('insert into payments (reservation_id, amount, method, reference, created_by, created_at) values (?,?,?,?,?,?)', [
        id,
        money(total / 2),
        'card',
        'Deposit',
        1,
        now
      ]);
    }
    return id;
  };

  const g1 = guest('Emma', 'Schneider', 'emma.schneider@example.com', '+49 151 2233445', 'Germany');
  const g2 = guest('Lucas', 'Almeida', 'lucas.almeida@example.com', '+351 912 334 556', 'Portugal');
  const g3 = guest('Hannah', 'O\u2019Neill', 'hannah.oneill@example.com', '+353 87 223 1188', 'Ireland');
  const g4 = guest('Yuki', 'Tanaka', 'yuki.tanaka@example.com', '+81 90 2234 8890', 'Japan');
  const g5 = guest('Marco', 'Rossi', 'marco.rossi@example.com', '+39 333 887 2211', 'Italy');
  const g6 = guest('Ana', 'Costa', 'ana.costa@example.com', '+351 934 771 220', 'Portugal');

  run(
    `update guests set vip = 1, company = 'Nordwind Travel', address = 'Hafenstrasse 22', city = 'Hamburg',
      id_type = 'Passport', id_number = 'DE-C23X9911', birth_date = '1984-06-12', marketing_opt_in = 1,
      preferences = 'High floor, extra pillows, late checkout' where id = ?`,
    [g1]
  );
  run(
    `update guests set company = 'Lisboa Tech', address = 'Rua do Alecrim 4', city = 'Lisbon', id_type = 'ID card',
      id_number = 'PT-1188223', birth_date = '1990-02-27' where id = ?`,
    [g2]
  );
  run(
    `update guests set vip = 1, company = 'Kyoto Imports', address = '3-14 Kawaramachi', city = 'Kyoto',
      id_type = 'Passport', id_number = 'JP-TK7781', birth_date = '1979-11-03',
      preferences = 'Twin beds, quiet room, green tea' where id = ?`,
    [g4]
  );
  run("update guests set preferences = 'Cot for a toddler, early breakfast' where id = ?", [g6]);

  reservation({ guestId: g1, typeId: 1, roomNumber: '101', from: -1, to: 2, status: 'checked_in', channelId: 2, ref: 'BK-88213', rate: 120 });
  reservation({ guestId: g2, typeId: 2, roomNumber: '201', from: 0, to: 3, status: 'confirmed', channelId: 1, ref: null, rate: 165 });
  reservation({ guestId: g3, typeId: 3, roomNumber: '104', from: 0, to: 1, status: 'confirmed', channelId: 3, ref: 'ABNB-4471', rate: 110 });
  reservation({ guestId: g4, typeId: 2, roomNumber: '202', from: -2, to: 0, status: 'checked_in', channelId: 4, ref: 'EXP-99021', rate: 165, notes: 'Late checkout requested' });
  reservation({ guestId: g5, typeId: 1, roomNumber: '103', from: 2, to: 5, status: 'confirmed', channelId: 2, ref: 'BK-90114', rate: 125 });
  reservation({ guestId: g6, typeId: 2, roomNumber: null, from: 1, to: 4, status: 'pending', channelId: 3, ref: 'ABNB-4502', rate: 158 });
  reservation({ guestId: g1, typeId: 4, roomNumber: '204', from: 5, to: 8, status: 'confirmed', channelId: 1, ref: null, rate: 240, adults: 2, children: 2 });

  const nowIso = new Date().toISOString();
  run('insert into calendar_blocks (room_id, start_date, end_date, source, channel_id, feed_id, external_uid, summary, created_at) values (?,?,?,?,?,?,?,?,?)', [
    roomByNumber['205'],
    addDays(today, 1),
    addDays(today, 4),
    'ical',
    2,
    null,
    'seed-booking-1',
    'Booking.com reservation',
    nowIso
  ]);
  run('insert into calendar_blocks (room_id, start_date, end_date, source, channel_id, feed_id, external_uid, summary, created_at) values (?,?,?,?,?,?,?,?,?)', [
    roomByNumber['106'],
    today,
    addDays(today, 2),
    'maintenance',
    null,
    null,
    null,
    'Bathroom maintenance',
    nowIso
  ]);

  run('update rooms set status = ? where number = ?', ['out_of_order', '106']);

  const shiftOpenAt = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
  const shiftCloseAt = new Date(Date.now() - 14 * 3600 * 1000).toISOString();
  run(
    `insert into shifts (user_id, opened_at, closed_at, opening_float, counted_cash, expected_cash, variance, notes, closing_notes, status)
     values (?,?,?,?,?,?,?,?,?,?)`,
    [2, shiftOpenAt, shiftCloseAt, 200, 320, 320, 0, 'Morning shift', 'Draw balanced at handover', 'closed']
  );
  run('insert into shifts (user_id, opened_at, opening_float, notes, status) values (?,?,?,?,?)', [
    1,
    new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    250,
    'Day shift',
    'open'
  ]);

  const activity = [
    [1, 'setup', 'Property created with 11 rooms and 4 room types'],
    [2, 'check_in', 'Checked in Emma Schneider to room 101'],
    [1, 'channel', 'Connected Booking.com iCal feed for room 205']
  ];
  for (const [userId, action, detail] of activity) {
    run('insert into activity_log (user_id, action, detail, created_at) values (?,?,?,?)', [userId, action, detail, nowIso]);
  }

  console.log('[db] seeded demo property, staff accounts, rooms and reservations');
}

/* ------------------------------ migrations ------------------------------ */

const GUEST_EXTRA_COLUMNS = [
  ['vip', 'INTEGER NOT NULL DEFAULT 0'],
  ['company', 'TEXT'],
  ['address', 'TEXT'],
  ['city', 'TEXT'],
  ['id_type', 'TEXT'],
  ['id_number', 'TEXT'],
  ['birth_date', 'TEXT'],
  ['preferences', 'TEXT'],
  ['marketing_opt_in', 'INTEGER NOT NULL DEFAULT 0'],
  ['blacklisted', 'INTEGER NOT NULL DEFAULT 0'],
  ['updated_at', 'TEXT']
];

function migrate() {
  const guestColumns = new Set(all('PRAGMA table_info(guests)').map((row) => row.name));
  for (const [name, definition] of GUEST_EXTRA_COLUMNS) {
    if (!guestColumns.has(name)) exec(`ALTER TABLE guests ADD COLUMN ${name} ${definition}`);
  }

  const paymentColumns = new Set(all('PRAGMA table_info(payments)').map((row) => row.name));
  if (!paymentColumns.has('shift_id')) exec('ALTER TABLE payments ADD COLUMN shift_id INTEGER');

  run(
    "update settings set value = 'PCH Hotel' where key = 'property_name' and value in ('Harbor View Hotel', 'AppJet Hotel')"
  );

  const siteDefaults = {
    site_headline: 'Boutique stays, booked direct',
    site_tagline: 'Best available rate, instant confirmation and no booking fees.',
    site_about:
      'PCH Hotel sits two minutes from the marina, with 11 individually styled rooms, a rooftop terrace and breakfast served until noon. Book direct for the lowest rate and a free upgrade when available.',
    site_notice: 'Free cancellation up to 48 hours before arrival.',
    site_accent: '#0f766e'
  };
  for (const [key, value] of Object.entries(siteDefaults)) {
    run('insert or ignore into settings (key, value) values (?, ?)', [key, value]);
  }

  run(
    `insert into channels (name, kind, color, commission, active)
     select 'PCH Website', 'website', '#0f766e', 0, 1
     where not exists (select 1 from channels where kind = 'website')`
  );

  run("update users set name = 'PCH Admin' where email like 'admin@%' and name in ('Hotel Admin', 'AppJet Admin')");
  exec('PRAGMA foreign_keys = ON');
}
