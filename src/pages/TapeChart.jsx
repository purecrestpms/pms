import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, addDays, isoToday, shortDate } from '../api.js';
import { Banner, Card, Empty, Spinner, StatusBadge, useApp } from '../components/ui.jsx';
import ReservationForm from '../components/ReservationForm.jsx';
import ReservationDetail from '../components/ReservationDetail.jsx';

const DAY_WIDTH = 62;

function dayOffset(start, date) {
  return Math.round((new Date(`${date}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000);
}

export default function TapeChart() {
  const { money } = useApp();
  const [start, setStart] = useState(isoToday());
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [prefill, setPrefill] = useState(null);

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

  const shift = (amount) => setStart(addDays(start, amount));

  return (
    <>
      <Banner kind="error">{error}</Banner>

      <Card
        title="Tape chart"
        subtitle="Room-by-room availability across the calendar, including channel blocks"
        padded={false}
        actions={
          <>
            <button type="button" className="btn sm" onClick={() => shift(-days)}>
              ‹ Earlier
            </button>
            <button type="button" className="btn sm" onClick={() => setStart(isoToday())}>
              Today
            </button>
            <button type="button" className="btn sm" onClick={() => shift(days)}>
              Later ›
            </button>
            <select value={days} onChange={(event) => setDays(Number(event.target.value))} style={{ width: 110 }}>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={21}>21 days</option>
              <option value={30}>30 days</option>
            </select>
          </>
        }
      >
        {!data ? (
          <Spinner />
        ) : (
          <>
            <div className="card-body" style={{ paddingBottom: 8 }}>
              <div className="legend">
                <span className="legend-item">
                  <i style={{ background: '#1d4ed8' }} /> Booking
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
              <div className="tape" style={{ minWidth: 150 + days * DAY_WIDTH }}>
                <div className="tape-head">
                  <div className="tape-room-label">Room</div>
                  {data.dates.map((day) => (
                    <div key={day.date} className={`tape-day${day.is_today ? ' today' : ''}`} style={{ width: DAY_WIDTH }}>
                      <span className="dow">{day.weekday}</span>
                      <span className="dom">{day.date.slice(8)}</span>
                    </div>
                  ))}
                </div>

                {data.rooms.map((room) => {
                  const roomBars = bars.get(room.id) || [];
                  return (
                    <div className="tape-row" key={room.id}>
                      <div className="tape-room-label">
                        <span className="row-strong">{room.number}</span>
                        <span className="small muted">{room.room_type_name}</span>
                      </div>
                      <div className="tape-cells">
                        {data.dates.map((day) => {
                          const covered = roomBars.some(
                            (bar) => bar.check_in ? bar.check_in <= day.date && bar.check_out > day.date
                              : bar.start_date <= day.date && bar.end_date > day.date
                          );
                          return (
                            <button
                              key={day.date}
                              type="button"
                              className={`tape-cell${day.is_today ? ' today' : ''}${covered ? ' covered' : ''}`}
                              style={{ width: DAY_WIDTH }}
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
                              {day.date.slice(8)}
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
                          return (
                            <button
                              key={`${bar.kind}-${bar.id}`}
                              type="button"
                              className={`tape-bar${isBlock ? ' block' : ''}${isChannelBlock ? ' channel' : ''}`}
                              style={{
                                left: offset * DAY_WIDTH + 2,
                                width: visibleSpan * DAY_WIDTH - 4,
                                background: isChannelBlock ? '#f97316' : isBlock ? '#94a3b8' : '#1d4ed8'
                              }}
                              title={
                                isBlock
                                  ? `${bar.summary || 'Blocked'} · ${from} → ${to}${bar.channel_name ? ` · ${bar.channel_name}` : ''}`
                                  : `${bar.guest_name} · ${from} → ${to} · ${bar.channel_name || 'Direct'}`
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
        <ReservationForm
          initial={prefill}
          onClose={() => setPrefill(null)}
          onSaved={() => load()}
        />
      ) : null}
      {detailId ? <ReservationDetail id={detailId} onClose={() => setDetailId(null)} onChange={load} /> : null}
    </>
  );
}
