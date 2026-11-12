import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, addDays, isoToday, shortDate } from '../api.js';
import { Banner, Card, Empty, Spinner, useApp } from '../components/ui.jsx';
import ReservationForm from '../components/ReservationForm.jsx';
import ReservationDetail from '../components/ReservationDetail.jsx';

const ZOOMS = { compact: 44, normal: 62, wide: 88 };

function dayOffset(start, date) {
  return Math.round((new Date(`${date}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000);
}

function occupancyTone(percent) {
  if (percent >= 90) return { background: '#0f766e', color: '#fff' };
  if (percent >= 70) return { background: '#14b8a6', color: '#042f2e' };
  if (percent >= 40) return { background: '#99f6e4', color: '#0f172a' };
  if (percent > 0) return { background: '#ccfbf1', color: '#0f172a' };
  return { background: '#f8fafc', color: '#64748b' };
}

export default function TapeChart() {
  const { money } = useApp();
  const [start, setStart] = useState(isoToday());
  const [days, setDays] = useState(14);
  const [zoom, setZoom] = useState('normal');
  const [typeFilter, setTypeFilter] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [prefill, setPrefill] = useState(null);

  const dayWidth = ZOOMS[zoom] || ZOOMS.normal;

  const load = useCallback(async () => {
    try {
      const result = await api.get(`/calendar?start=${start}&days=${days}`);
      setData(result);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [start, days]);

  useEffect(() => {
    load();
  }, [load]);

  const rooms = useMemo(() => {
    if (!data) return [];
    if (typeFilter === 'all') return data.rooms;
    return data.rooms.filter((room) => String(room.room_type_id) === String(typeFilter));
  }, [data, typeFilter]);

  const types = useMemo(() => {
    if (!data) return [];
    const map = new Map();
    for (const room of data.rooms) {
      if (!map.has(room.room_type_id)) map.set(room.room_type_id, room.room_type_name);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [data]);

  const bars = useMemo(() => {
    if (!data) return new Map();
    const map = new Map();
    const push = (roomId, item) => {
      const list = map.get(roomId) || [];
      list.push(item);
      map.set(roomId, list);
    };
    for (const reservation of data.reservations) {
      if (!reservation.room_id) continue;
      push(reservation.room_id, { kind: 'reservation', ...reservation });
    }
    for (const block of data.blocks) {
      push(block.room_id, { kind: 'block', ...block });
    }
    return map;
  }, [data]);

  const occupancy = useMemo(() => {
    if (!data) return [];
    const total = data.rooms.length || 1;
    return data.dates.map((day) => {
      const sold = data.reservations.filter(
        (reservation) => reservation.check_in <= day.date && reservation.check_out > day.date
      ).length;
      const blocked = data.blocks.filter(
        (block) => block.start_date <= day.date && block.end_date > day.date
      ).length;
      return {
        date: day.date,
        sold,
        blocked,
        percent: Math.round((sold / total) * 100)
      };
    });
  }, [data]);

  const summary = useMemo(() => {
    if (!data) return null;
    const today = isoToday();
    const arrivals = data.reservations.filter((reservation) => reservation.check_in === today).length;
    const departures = data.reservations.filter((reservation) => reservation.check_out === today).length;
    const inHouse = data.reservations.filter(
      (reservation) => reservation.check_in <= today && reservation.check_out > today
    ).length;
    const averageOccupancy = occupancy.length
      ? Math.round(occupancy.reduce((sum, day) => sum + day.percent, 0) / occupancy.length)
      : 0;
    return { arrivals, departures, inHouse, averageOccupancy, unassigned: data.unassigned.length };
  }, [data, occupancy]);

  const shift = (amount) => setStart(addDays(start, amount));

  return (
    <>
      <Banner kind="error">{error}</Banner>

      {summary ? (
        <div className="stat-row no-print">
          <div className="stat-tile">
            <span className="stat-label">Occupancy in view</span>
            <span className="stat-value">{summary.averageOccupancy}%</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">In house today</span>
            <span className="stat-value">{summary.inHouse}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Arrivals</span>
            <span className="stat-value">{summary.arrivals}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Departures</span>
            <span className="stat-value">{summary.departures}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Unassigned</span>
            <span className="stat-value">{summary.unassigned}</span>
          </div>
        </div>
      ) : null}

      <Card
        title="Availability calendar"
        subtitle="Occupancy heat strip, channel blocks and one-click booking on any free cell"
        padded={false}
        actions={
          <div className="tape-toolbar">
            <button type="button" className="btn sm" onClick={() => shift(-days)}>
              ‹ Earlier
            </button>
            <button type="button" className="btn sm" onClick={() => setStart(isoToday())}>
              Today
            </button>
            <button type="button" className="btn sm" onClick={() => shift(days)}>
              Later ›
            </button>
            <input
              type="date"
              value={start}
              onChange={(event) => event.target.value && setStart(event.target.value)}
              style={{ width: 150 }}
              aria-label="Jump to date"
            />
            <select value={days} onChange={(event) => setDays(Number(event.target.value))} style={{ width: 104 }}>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={21}>21 days</option>
              <option value={30}>30 days</option>
            </select>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} style={{ width: 150 }}>
              <option value="all">All room types</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            <select value={zoom} onChange={(event) => setZoom(event.target.value)} style={{ width: 110 }}>
              <option value="compact">Compact</option>
              <option value="normal">Normal</option>
              <option value="wide">Wide</option>
            </select>
            <button type="button" className="btn sm" onClick={() => window.print()}>
              Print / PDF
            </button>
          </div>
        }
      >
        {!data ? (
          <Spinner />
        ) : (
          <>
            <div className="card-body" style={{ paddingBottom: 8 }}>
              <div className="legend">
                <span className="legend-item">
                  <i style={{ background: '#1d4ed8' }} /> Confirmed
                </span>
                <span className="legend-item">
                  <i style={{ background: '#0f766e' }} /> In house
                </span>
                <span className="legend-item">
                  <i style={{ background: '#6366f1' }} /> Pending
                </span>
                <span className="legend-item">
                  <i style={{ background: '#f97316' }} /> Channel block (iCal)
                </span>
                <span className="legend-item">
                  <i style={{ background: '#94a3b8' }} /> Manual block
                </span>
                <span className="legend-item">
                  <i style={{ background: '#f1f5f9', border: '1px solid #cbd5e1' }} /> Free
                </span>
                <span className="small muted">Click a free cell to start a booking</span>
              </div>
            </div>

            <div className="tape-wrap">
              <div className="tape" style={{ minWidth: 170 + days * dayWidth }}>
                <div className="tape-head">
                  <div className="tape-room-label">Room</div>
                  {data.dates.map((day) => {
                    const weekend = ['Sat', 'Sun'].includes(day.weekday);
                    return (
                      <div
                        key={day.date}
                        className={`tape-day${day.is_today ? ' today' : ''}${weekend ? ' weekend' : ''}`}
                        style={{ width: dayWidth }}
                      >
                        <span className="dow">{day.weekday}</span>
                        <span className="dom">{day.date.slice(8)}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="tape-row occupancy-row">
                  <div className="tape-room-label">
                    <span className="row-strong">Occupancy</span>
                    <span className="small muted">sold / total</span>
                  </div>
                  {occupancy.map((day) => (
                    <div
                      key={day.date}
                      className="occ-cell"
                      style={{ width: dayWidth, ...occupancyTone(day.percent) }}
                      title={`${day.sold} of ${data.rooms.length} rooms sold${day.blocked ? `, ${day.blocked} blocked` : ''}`}
                    >
                      {day.percent}%
                    </div>
                  ))}
                </div>

                {rooms.map((room) => {
                  const roomBars = bars.get(room.id) || [];
                  return (
                    <div className="tape-row" key={room.id}>
                      <div className="tape-room-label">
                        <span className="row-strong">{room.number}</span>
                        <span className="small muted">{room.room_type_name}</span>
                      </div>
                      <div className="tape-cells">
                        {data.dates.map((day) => {
                          const covered = roomBars.some((bar) =>
                            bar.check_in
                              ? bar.check_in <= day.date && bar.check_out > day.date
                              : bar.start_date <= day.date && bar.end_date > day.date
                          );
                          const weekend = ['Sat', 'Sun'].includes(day.weekday);
                          return (
                            <button
                              key={day.date}
                              type="button"
                              className={`tape-cell${day.is_today ? ' today' : ''}${covered ? ' covered' : ''}${
                                weekend ? ' weekend' : ''
                              }`}
                              style={{ width: dayWidth }}
                              title={covered ? 'Occupied' : `Book room ${room.number} on ${day.date}`}
                              onClick={() => {
                                if (covered) return;
                                setPrefill({
                                  room_id: room.id,
                                  room_type_id: room.room_type_id,
                                  check_in: day.date,
                                  check_out: addDays(day.date, 1)
                                });
                              }}
                            >
                              {zoom === 'compact' ? '' : day.date.slice(8)}
                            </button>
                          );
                        })}

                        {roomBars.map((bar) => {
                          const from = bar.check_in || bar.start_date;
                          const to = bar.check_out || bar.end_date;
                          const offset = Math.max(0, dayOffset(data.start, from));
                          const span = Math.max(1, dayOffset(from, to) - Math.max(0, -dayOffset(data.start, from)));
                          const visibleSpan = Math.min(span, data.days - offset);
                          if (visibleSpan <= 0 || offset >= data.days) return null;
                          const isBlock = bar.kind === 'block';
                          const isChannelBlock = isBlock && bar.source === 'ical';
                          const colour = isChannelBlock
                            ? '#f97316'
                            : isBlock
                              ? '#94a3b8'
                              : bar.channel_color || (bar.status === 'checked_in' ? '#0f766e' : bar.status === 'pending' ? '#6366f1' : '#1d4ed8');
                          return (
                            <button
                              key={`${bar.kind}-${bar.id}`}
                              type="button"
                              className={`tape-bar${isBlock ? ' block' : ''}${isChannelBlock ? ' channel' : ''}${
                                bar.status ? ` ${bar.status}` : ''
                              }`}
                              style={{
                                left: offset * dayWidth + 2,
                                width: visibleSpan * dayWidth - 4,
                                background: colour
                              }}
                              title={
                                isBlock
                                  ? `${bar.summary || 'Blocked'} · ${from} → ${to}${bar.channel_name ? ` · ${bar.channel_name}` : ''}`
                                  : `${bar.guest_name} · ${from} → ${to} · ${bar.channel_name || 'Direct'} · ${money(
                                      bar.rate
                                    )}`
                              }
                              onClick={() => (isBlock ? null : setDetailId(bar.id))}
                            >
                              {isBlock ? bar.summary || 'Blocked' : bar.guest_name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
              <h4 style={{ margin: '0 0 8px' }}>Unassigned bookings ({data.unassigned.length})</h4>
              {data.unassigned.length ? (
                <div className="chip-list">
                  {data.unassigned.map((reservation) => (
                    <button key={reservation.id} type="button" className="chip" onClick={() => setDetailId(reservation.id)}>
                      {reservation.guest_name} · {shortDate(reservation.check_in)} → {shortDate(reservation.check_out)} ·{' '}
                      {reservation.room_type_name} · {money(reservation.rate)}
                    </button>
                  ))}
                </div>
              ) : (
                <Empty>Every booking in this window has a room assigned</Empty>
              )}
            </div>
          </>
        )}
      </Card>

      {prefill ? (
        <ReservationForm initial={prefill} onClose={() => setPrefill(null)} onSaved={() => load()} />
      ) : null}
      {detailId ? <ReservationDetail id={detailId} onClose={() => setDetailId(null)} onChange={load} /> : null}
    </>
  );
}
