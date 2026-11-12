import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-test-'));
process.env.ADMIN_EMAIL = 'admin@hotelpms.local';
process.env.ADMIN_PASSWORD = 'Admin123!';

const { initDb, closeDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { parseIcalEvents, buildIcal } = await import('../server/ical.js');
const { addDays, todayISO } = await import('../server/util.js');

let server;
let base;

before(async () => {
  await initDb();
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  closeDb?.();
});

function client() {
  let cookie = '';
  return async function call(pathname, { method = 'GET', body } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    for (const raw of response.headers.getSetCookie?.() || []) {
      const pair = raw.split(';')[0];
      if (pair.startsWith('pms_session=')) cookie = pair;
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: response.status, data, text };
  };
}

async function login(email, password) {
  const call = client();
  const result = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(result.status, 200, `login failed for ${email}: ${result.text}`);
  return { call, user: result.data.user };
}

const futureIn = addDays(todayISO(), 120);
const futureOut = addDays(futureIn, 3);

test('health endpoint reports ok without authentication', async () => {
  const call = client();
  const result = await call('/api/health');
  assert.equal(result.status, 200);
  assert.equal(result.data.status, 'ok');
});

test('staff endpoints reject anonymous requests', async () => {
  const call = client();
  assert.equal((await call('/api/users')).status, 401);
  assert.equal((await call('/api/reservations')).status, 401);
  assert.equal((await call('/api/dashboard')).status, 401);
});

test('admin signs in and can manage property data', async () => {
  const { call, user } = await login('admin@hotelpms.local', 'Admin123!');
  assert.equal(user.role, 'admin');

  const type = await call('/api/room-types', {
    method: 'POST',
    body: { name: 'Test Suite', code: 'TST', capacity: 2, base_rate: 150, description: 'Regression fixture' }
  });
  assert.equal(type.status, 201, type.text);
  const roomTypeId = type.data.room_type.id;

  const room = await call('/api/rooms', { method: 'POST', body: { number: 'T-999', room_type_id: roomTypeId, floor: 9 } });
  assert.equal(room.status, 201, room.text);
  assert.equal(room.data.room.number, 'T-999');

  const property = await call('/api/property', { method: 'PUT', body: { property_name: 'Test Property' } });
  assert.equal(property.status, 200, property.text);
  assert.equal(property.data.property.property_name, 'Test Property');
});

test('admin creates a front desk account that can sign in', async () => {
  const { call } = await login('admin@hotelpms.local', 'Admin123!');
  const created = await call('/api/users', {
    method: 'POST',
    body: { name: 'Regression Agent', email: 'agent@test.local', password: 'Agent123!', role: 'front_desk' }
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.data.user.role, 'front_desk');

  const agent = await login('agent@test.local', 'Agent123!');
  assert.equal(agent.user.role, 'front_desk');

  const forbidden = await agent.call('/api/users', {
    method: 'POST',
    body: { name: 'Nope', email: 'nope@test.local', password: 'Nope1234', role: 'admin' }
  });
  assert.equal(forbidden.status, 403, 'front desk must not create accounts');
});

test('housekeeping cannot create reservations', async () => {
  const { call } = await login('housekeeping@hotelpms.local', 'House123!');
  const result = await call('/api/reservations', {
    method: 'POST',
    body: { first_name: 'Blocked', last_name: 'User', check_in: futureIn, check_out: futureOut, room_type_id: 1 }
  });
  assert.equal(result.status, 403);
  assert.equal((await call('/api/rooms')).status, 200);
});

test('front desk creates a reservation, blocks double booking and checks the guest out', async () => {
  const { call } = await login('frontdesk@hotelpms.local', 'Front123!');
  const rooms = await call('/api/rooms');
  const room = rooms.data.rooms.find((item) => item.number === 'T-999');
  assert.ok(room, 'test room must exist');

  const created = await call('/api/reservations', {
    method: 'POST',
    body: {
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@test.local',
      phone: '+100000',
      check_in: futureIn,
      check_out: futureOut,
      adults: 2,
      room_type_id: room.room_type_id,
      room_id: room.id
    }
  });
  assert.equal(created.status, 201, created.text);
  const reservation = created.data.reservation;
  assert.equal(reservation.status, 'confirmed');
  assert.match(reservation.code, /^R/);

  const clash = await call('/api/reservations', {
    method: 'POST',
    body: {
      first_name: 'Grace',
      last_name: 'Hopper',
      check_in: futureIn,
      check_out: futureOut,
      room_type_id: room.room_type_id,
      room_id: room.id
    }
  });
  assert.equal(clash.status, 409, 'overlapping stay on the same room must be rejected');

  const availability = await call(`/api/availability?check_in=${futureIn}&check_out=${futureOut}`);
  assert.equal(availability.status, 200);

  const checkedIn = await call(`/api/reservations/${reservation.id}/check-in`, { method: 'POST', body: {} });
  assert.equal(checkedIn.status, 200, checkedIn.text);
  assert.equal(checkedIn.data.reservation.status, 'checked_in');

  const checkedOut = await call(`/api/reservations/${reservation.id}/check-out`, { method: 'POST', body: {} });
  assert.equal(checkedOut.status, 200, checkedOut.text);
  assert.equal(checkedOut.data.reservation.status, 'checked_out');

  const after = await call('/api/rooms');
  const updated = after.data.rooms.find((item) => item.id === room.id);
  assert.equal(updated.status, 'dirty', 'checkout must flag the room dirty for housekeeping');
});

test('room iCal export feed is publicly readable and contains the stay', async () => {
  const { call } = await login('frontdesk@hotelpms.local', 'Front123!');
  const rooms = await call('/api/rooms');
  const room = rooms.data.rooms.find((item) => item.number === 'T-999');
  assert.ok(room.ical_token, 'every room needs an export token');

  const feed = await fetch(`${base}/ical/${room.ical_token}.ics`);
  assert.equal(feed.status, 200);
  assert.match(feed.headers.get('content-type') || '', /text\/calendar/);
  const body = await feed.text();
  assert.match(body, /BEGIN:VCALENDAR/);
  assert.match(body, /BEGIN:VEVENT/);
  assert.match(body, /SUMMARY:/);

  const unknown = await fetch(`${base}/ical/does-not-exist.ics`);
  assert.equal(unknown.status, 404);
});

test('front desk blocks a room and the block prevents a booking', async () => {
  const { call } = await login('frontdesk@hotelpms.local', 'Front123!');
  const rooms = await call('/api/rooms');
  const room = rooms.data.rooms.find((item) => item.number === 'T-999');
  const start = addDays(todayISO(), 200);
  const end = addDays(start, 2);

  const block = await call('/api/channels/blocks', {
    method: 'POST',
    body: { room_id: room.id, start_date: start, end_date: end, summary: 'Maintenance' }
  });
  assert.equal(block.status, 201, block.text);

  const duplicate = await call('/api/channels/blocks', {
    method: 'POST',
    body: { room_id: room.id, start_date: start, end_date: end }
  });
  assert.equal(duplicate.status, 409);

  const booking = await call('/api/reservations', {
    method: 'POST',
    body: {
      first_name: 'Kurt',
      last_name: 'Godel',
      check_in: start,
      check_out: end,
      room_type_id: room.room_type_id,
      room_id: room.id
    }
  });
  assert.equal(booking.status, 409, 'blocked dates must reject bookings');

  const removed = await call(`/api/channels/blocks/${block.data.block.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200, removed.text);
});

test('channel feeds require a URL and expose the room export list', async () => {
  const { call } = await login('admin@hotelpms.local', 'Admin123!');
  const channels = await call('/api/channels');
  assert.equal(channels.status, 200);
  const channelId = channels.data.channels[0].id;

  const invalid = await call('/api/channels/feeds', {
    method: 'POST',
    body: { name: 'Bad feed', channel_id: channelId, url: 'not-a-url' }
  });
  assert.equal(invalid.status, 400);

  const exportList = await call('/api/channels/export');
  assert.equal(exportList.status, 200);
  assert.ok(exportList.data.rooms.length > 0);
  assert.match(exportList.data.rooms[0].url, /\/ical\/.+\.ics$/);
});

test('iCal parser extracts channel bookings', () => {
  const sample = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Booking.com//Channel//EN',
    'BEGIN:VEVENT',
    'UID:booking-123@example.com',
    'DTSTAMP:20260101T120000Z',
    'DTSTART;VALUE=DATE:20260210',
    'DTEND;VALUE=DATE:20260213',
    'SUMMARY:Reserved - Booking.com',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const events = parseIcalEvents(sample);
  assert.equal(events.length, 1);
  assert.equal(events[0].uid, 'booking-123@example.com');
  assert.equal(events[0].start, '2026-02-10');
  assert.equal(events[0].end, '2026-02-13');
  assert.match(events[0].summary, /Booking\.com/);
});

test('generated iCal round-trips through the parser', () => {
  const ics = buildIcal({
    calendarName: 'Room 101',
    events: [{ uid: 'res-1@pms', start: '2026-03-01', end: '2026-03-04', summary: 'Ada Lovelace (R123456)' }]
  });
  const events = parseIcalEvents(ics);
  assert.equal(events.length, 1);
  assert.equal(events[0].start, '2026-03-01');
  assert.equal(events[0].end, '2026-03-04');
});
