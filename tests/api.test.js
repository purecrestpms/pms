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
  server = createApp().listen(0, '0.0.0.0');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  closeDb?.();
});

function client() {
  let cookie = '';
  const call = async function call(pathname, { method = 'GET', body } = {}) {
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
  call.getCookie = () => cookie;
  return call;
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

  const stay = await call('/api/reservations', {
    method: 'POST',
    body: {
      first_name: 'Export',
      last_name: 'Guest',
      check_in: addDays(todayISO(), 140),
      check_out: addDays(todayISO(), 143),
      room_type_id: room.room_type_id,
      room_id: room.id
    }
  });
  assert.equal(stay.status, 201, stay.text);

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

test('guest profiles capture identity, preferences and stay history', async () => {
  const { call } = await login('admin@hotelpms.local', 'Admin123!');

  const missing = await call('/api/guests', { method: 'POST', body: { first_name: 'Only' } });
  assert.equal(missing.status, 400, 'first and last name are required');

  const created = await call('/api/guests', {
    method: 'POST',
    body: {
      first_name: 'Rosalind',
      last_name: 'Franklin',
      email: 'rosalind@test.local',
      phone: '+441234',
      country: 'United Kingdom',
      company: 'Photo 51 Ltd',
      id_type: 'Passport',
      id_number: 'X1234567',
      preferences: 'Quiet room, extra pillows',
      vip: true
    }
  });
  assert.equal(created.status, 201, created.text);
  const guestId = created.data.guest.id;

  const search = await call('/api/guests?q=franklin');
  assert.equal(search.status, 200);
  assert.ok(search.data.guests.some((guest) => guest.id === guestId), 'profile must be searchable by name');

  const byCompany = await call('/api/guests?q=photo%2051');
  assert.ok(byCompany.data.guests.some((guest) => guest.id === guestId), 'profile must be searchable by company');

  const patched = await call(`/api/guests/${guestId}`, {
    method: 'PATCH',
    body: { notes: 'Prefers late checkout', marketing_opt_in: true }
  });
  assert.equal(patched.status, 200, patched.text);

  const detail = await call(`/api/guests/${guestId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.guest.id_number, 'X1234567');
  assert.equal(detail.data.guest.vip, 1);
  assert.equal(detail.data.guest.notes, 'Prefers late checkout');
  assert.ok(Array.isArray(detail.data.reservations), 'stay history must be returned');

  const removed = await call(`/api/guests/${guestId}`, { method: 'DELETE' });
  assert.equal(removed.status, 200, removed.text);
  assert.equal((await call(`/api/guests/${guestId}`)).status, 404);
});

test('shift cash-up tracks payments, variance and printable PDF documents', async () => {
  const { call } = await login('frontdesk@hotelpms.local', 'Front123!');

  const opened = await call('/api/shifts/open', { method: 'POST', body: { opening_float: 100, notes: 'Morning shift' } });
  assert.equal(opened.status, 201, opened.text);
  const shiftId = opened.data.shift.id;
  assert.equal(opened.data.shift.status, 'open');

  const duplicate = await call('/api/shifts/open', { method: 'POST', body: { opening_float: 50 } });
  assert.equal(duplicate.status, 409, 'a cashier cannot hold two open shifts');

  const rooms = await call('/api/rooms');
  const room = rooms.data.rooms.find((item) => item.number === 'T-999');
  assert.ok(room, 'test room must exist');
  const stayIn = addDays(todayISO(), 200);
  const stayOut = addDays(stayIn, 2);

  const reservation = await call('/api/reservations', {
    method: 'POST',
    body: {
      first_name: 'Katherine',
      last_name: 'Johnson',
      check_in: stayIn,
      check_out: stayOut,
      adults: 1,
      room_type_id: room.room_type_id,
      room_id: room.id
    }
  });
  assert.equal(reservation.status, 201, reservation.text);
  const reservationId = reservation.data.reservation.id;

  const payment = await call(`/api/reservations/${reservationId}/payments`, {
    method: 'POST',
    body: { amount: 50, method: 'cash', reference: 'DRAWER-1' }
  });
  assert.equal(payment.status, 201, payment.text);

  const closed = await call(`/api/shifts/${shiftId}/close`, {
    method: 'POST',
    body: { counted_cash: 150, closing_notes: 'Drawer balanced' }
  });
  assert.equal(closed.status, 200, closed.text);
  assert.equal(closed.data.shift.status, 'closed');
  assert.equal(Number(closed.data.shift.variance), 0, 'counted cash must match the expected drawer');

  const cookie = call.getCookie();
  const documents = [
    `/api/shifts/${shiftId}/report.pdf`,
    `/api/reservations/${reservationId}/folio.pdf`,
    `/api/reservations/${reservationId}/registration.pdf`
  ];
  for (const pathname of documents) {
    const response = await fetch(`${base}${pathname}`, { headers: { cookie } });
    assert.equal(response.status, 200, `${pathname} must download for staff`);
    assert.match(response.headers.get('content-type') || '', /application\/pdf/);
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.equal(buffer.subarray(0, 4).toString(), '%PDF', `${pathname} must be a real PDF document`);
  }

  const anonymous = await fetch(`${base}/api/shifts/${shiftId}/report.pdf`);
  assert.equal(anonymous.status, 401, 'shift reports must not leak without a session');
});

test('public booking website quotes availability and creates a synced booking', async () => {
  const call = client();

  const property = await call('/api/public/property');
  assert.equal(property.status, 200, property.text);
  assert.ok(property.data.property.name, 'the website needs a property name');
  const type = property.data.room_types.find((item) => item.room_count > 0);
  assert.ok(type, 'at least one bookable room type is required');

  const checkIn = addDays(todayISO(), 150);
  const checkOut = addDays(checkIn, 2);

  const availability = await call(`/api/public/availability?check_in=${checkIn}&check_out=${checkOut}&adults=2`);
  assert.equal(availability.status, 200, availability.text);

  const past = await call(
    `/api/public/availability?check_in=${addDays(todayISO(), -4)}&check_out=${addDays(todayISO(), -2)}`
  );
  assert.equal(past.status, 400, 'past arrivals must be rejected');

  const booking = await call('/api/public/bookings', {
    method: 'POST',
    body: {
      first_name: 'Hedy',
      last_name: 'Lamarr',
      email: 'hedy@test.local',
      phone: '+431234',
      country: 'Austria',
      room_type_id: type.id,
      check_in: checkIn,
      check_out: checkOut,
      adults: 2,
      children: 0
    }
  });
  assert.equal(booking.status, 201, booking.text);
  assert.match(booking.data.reservation.code, /^PCH-/);
  assert.equal(booking.data.reservation.status, 'confirmed');
  assert.ok(booking.data.reservation.room_id, 'the website must assign a free room automatically');

  const lookup = await call(`/api/public/bookings/${booking.data.reservation.code}`);
  assert.equal(lookup.status, 200);
  assert.match(lookup.data.reservation.guest_name, /Hedy/);

  const invalidEmail = await call('/api/public/bookings', {
    method: 'POST',
    body: {
      first_name: 'A',
      last_name: 'B',
      email: 'not-an-email',
      room_type_id: type.id,
      check_in: checkIn,
      check_out: checkOut
    }
  });
  assert.equal(invalidEmail.status, 400, 'the booking form must validate the email address');

  const staff = await login('frontdesk@hotelpms.local', 'Front123!');
  const calendar = await staff.call(`/api/calendar?start=${checkIn}&days=4`);
  assert.equal(calendar.status, 200);
  assert.ok(
    calendar.data.reservations.some((item) => item.code === booking.data.reservation.code),
    'website bookings must appear on the PMS availability calendar'
  );
});
