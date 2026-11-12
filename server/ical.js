import dns from 'node:dns/promises';
import net from 'node:net';
import { addDays } from './util.js';

/* ----------------------------- parsing ----------------------------- */

function unfold(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');
}

function parseProperty(line) {
  const idx = line.indexOf(':');
  if (idx < 0) return null;
  const head = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const segments = head.split(';');
  const name = segments[0].trim().toUpperCase();
  const params = {};
  for (const segment of segments.slice(1)) {
    const eq = segment.indexOf('=');
    if (eq < 0) continue;
    params[segment.slice(0, eq).trim().toUpperCase()] = segment.slice(eq + 1).trim();
  }
  return { name, value, params };
}

function parseDateValue(prop) {
  if (!prop || !prop.value) return null;
  const raw = prop.value.trim();
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * Parse an iCalendar document into simple availability events.
 * Dates are reduced to property-local calendar days; DTEND is exclusive.
 */
export function parseIcalEvents(text) {
  const lines = unfold(text).split('\n');
  const events = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.toUpperCase() === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line.toUpperCase() === 'END:VEVENT') {
      if (current) {
        const event = finishEvent(current);
        if (event) events.push(event);
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const prop = parseProperty(line);
    if (!prop) continue;
    current[prop.name] = prop;
  }

  return events;
}

function finishEvent(raw) {
  const status = raw.STATUS?.value?.toUpperCase();
  if (status === 'CANCELLED') return null;

  const start = parseDateValue(raw.DTSTART);
  if (!start) return null;

  let end = parseDateValue(raw.DTEND);
  if (!end || end <= start) end = addDays(start, 1);

  const uid = raw.UID?.value?.trim() || null;
  const summary = (raw.SUMMARY?.value || '').trim() || 'Blocked (channel)';

  return { uid, start, end, summary };
}

/* ----------------------------- building ----------------------------- */

function icsDate(iso) {
  return iso.replace(/-/g, '');
}

function escapeText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function stamp(date = new Date()) {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

export function buildIcal({ calendarName, events, productId = '-//AppJet PMS//Channel Manager//EN' }) {
  const now = stamp();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${productId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    'X-PUBLISHED-TTL:PT1H'
  ];

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${icsDate(event.start)}`,
      `DTEND;VALUE=DATE:${icsDate(event.end)}`,
      `SUMMARY:${escapeText(event.summary || 'Reserved')}`,
      `STATUS:${event.status || 'CONFIRMED'}`,
      'TRANSP:OPAQUE',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

/* ------------------------------ fetching ------------------------------ */

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

/** Reject anything that is not a public http(s) endpoint so feeds cannot be used to probe the network. */
export async function assertFetchableUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl).trim());
  } catch {
    throw new Error('Feed URL is not a valid URL');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('Feed URL must use http or https');
  if (process.env.PMS_ALLOW_PRIVATE_FEEDS === '1') return parsed.toString();

  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('Feed URL must point to a public host');
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Feed URL must point to a public host');
    return parsed.toString();
  }
  let records;
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new Error('Feed host could not be resolved');
  }
  if (!records.length) throw new Error('Feed host could not be resolved');
  if (records.some((record) => isPrivateAddress(record.address))) {
    throw new Error('Feed URL must point to a public host');
  }
  return parsed.toString();
}

export async function fetchIcal(url, { timeoutMs = 15000, maxBytes = 2 * 1024 * 1024 } = {}) {
  const target = await assertFetchableUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8', 'user-agent': 'AppJetPMS/1.0' }
    });
    if (!response.ok) throw new Error(`Channel feed returned HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > maxBytes) throw new Error('Channel feed is too large');
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Channel feed is not a valid iCalendar document');
    return text;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Channel feed request timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
