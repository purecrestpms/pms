import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dateTime, shortDate } from '../api.js';
import { Banner, Card, Empty, Spinner, StatusBadge, useApp } from '../components/ui.jsx';
import ReservationForm from '../components/ReservationForm.jsx';
import ReservationDetail from '../components/ReservationDetail.jsx';

function Donut({ value, size = 132 }) {
  const radius = size / 2 - 10;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <svg className="donut" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`Occupancy ${filled}%`}>
      <circle cx={size / 2} cy={size / 2} r={radius} className="donut-track" strokeWidth="12" fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        className="donut-fill"
        strokeWidth="12"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${(filled / 100) * circumference} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="donut-value">
        {filled}%
      </text>
    </svg>
  );
}

function Kpi({ label, value, hint, tone = '', children }) {
  return (
    <div className={`kpi ${tone}`.trim()}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
      {children}
    </div>
  );
}

function Sparkline({ points }) {
  const width = 120;
  const height = 34;
  if (!points.length) return null;
  const max = Math.max(...points, 1);
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const path = points
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(1)},${(height - (value / max) * (height - 4) - 2).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <path d={path} fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Dashboard() {
  const { money, can, toast, property } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get('/dashboard'));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (reservation, action) => {
    setBusy(`${reservation.id}:${action}`);
    try {
      const result = await api.post(`/reservations/${reservation.id}/${action}`);
      toast(
        action === 'check-in'
          ? `${result.reservation.guest_name} checked in to room ${result.reservation.room_number}`
          : `${result.reservation.guest_name} checked out`
      );
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const syncChannels = async () => {
    setSyncing(true);
    try {
      const result = await api.post('/channels/sync');
      toast(`Synced ${result.synced} feed(s) · ${result.conflicts} conflict(s)`);
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  const trend = data?.trend || [];
  const occupancyPoints = useMemo(() => trend.map((day) => Number(day.occupancy) || 0), [trend]);
  const revenuePoints = useMemo(() => trend.map((day) => Number(day.revenue) || 0), [trend]);

  if (!data) {
    return (
      <Card title="Dashboard">
        {error ? <Banner kind="error">{error}</Banner> : <Spinner />}
      </Card>
    );
  }

  const stats = data.stats;
  const canAct = can('manager', 'front_desk');
  const channels = data.channels || [];
  const upcoming = data.upcoming || [];
  const maxChannel = Math.max(1, ...channels.map((channel) => channel.bookings));
  const maxRevenue = Math.max(1, ...revenuePoints);
  const housekeeping = [
    { label: 'Clean', value: stats.clean, tone: 'ok' },
    { label: 'Inspected', value: stats.inspected, tone: 'info' },
    { label: 'Dirty', value: stats.dirty, tone: 'warn' },
    { label: 'Out of order', value: stats.out_of_order, tone: 'danger' }
  ];

  return (
    <>
      <Banner kind="error">{error}</Banner>

      <section className="dash-hero">
        <div className="dash-hero-main">
          <div className="eyebrow">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <h2>{property.property_name || 'Richgates Apartments'}</h2>
          <p>
            {stats.in_house} guest{stats.in_house === 1 ? '' : 's'} in house · {stats.available} of {stats.total_rooms} rooms
            available · {stats.arrivals} arrival{stats.arrivals === 1 ? '' : 's'} and {stats.departures} departure
            {stats.departures === 1 ? '' : 's'} today
          </p>
          <div className="dash-hero-actions">
            {canAct ? (
              <button type="button" className="btn primary" onClick={() => setShowForm(true)}>
                + New reservation
              </button>
            ) : null}
            <Link className="btn ghost-light" to="/calendar">
              Open calendar
            </Link>
            <Link className="btn ghost-light" to="/front-desk">
              Front desk
            </Link>
            <button type="button" className="btn ghost-light" onClick={load}>
              Refresh
            </button>
          </div>
        </div>
        <div className="dash-hero-ring">
          <Donut value={stats.occupancy} />
          <div className="dash-hero-ring-label">Occupancy today</div>
          <div className="dash-hero-ring-sub">
            {stats.occupied} occupied · {stats.blocked} blocked
          </div>
        </div>
      </section>

      <div className="kpi-grid">
        <Kpi label="Revenue today" value={money(stats.revenue_today)} hint={`${money(stats.revenue_week)} this week`}>
          <Sparkline points={revenuePoints} />
        </Kpi>
        <Kpi label="Revenue this month" value={money(stats.revenue_month)} hint="posted charges, last 30 days" />
        <Kpi label="Occupancy" value={`${stats.occupancy}%`} hint={`${stats.occupied} of ${stats.total_rooms} rooms sold`} tone="accent">
          <Sparkline points={occupancyPoints} />
        </Kpi>
        <Kpi label="Arrivals / departures" value={`${stats.arrivals} / ${stats.departures}`} hint={`${stats.in_house} guests in house`} />
        <Kpi label="Available tonight" value={stats.available} hint={`${stats.unassigned} unassigned bookings`} />
        <Kpi label="Housekeeping" value={stats.dirty} hint="rooms waiting to be cleaned" tone={stats.dirty ? 'warn' : ''} />
      </div>

      <div className="dash-columns">
        <div className="stack">
          <Card
            title="Last 7 days"
            subtitle="Occupancy and posted revenue"
            actions={<Link className="btn ghost sm" to="/calendar">Calendar →</Link>}
          >
            <div className="trend-chart">
              {trend.map((day) => (
                <div key={day.date} className="trend-col" title={`${shortDate(day.date)} · ${day.occupancy}% · ${money(day.revenue)}`}>
                  <div className="trend-bars">
                    <div className="trend-bar occ" style={{ height: `${Math.max(4, day.occupancy)}%` }} />
                    <div className="trend-bar rev" style={{ height: `${Math.max(3, (Number(day.revenue) / maxRevenue) * 100)}%` }} />
                  </div>
                  <div className="trend-day">{shortDate(day.date)}</div>
                </div>
              ))}
            </div>
            <div className="legend-row">
              <span className="legend-item"><i className="swatch occ" /> Occupancy %</span>
              <span className="legend-item"><i className="swatch rev" /> Revenue</span>
            </div>
          </Card>

          <Card
            title="Arrivals today"
            subtitle="Guests expected to check in"
            padded={false}
            actions={<span className="badge info">{data.arrivals.length}</span>}
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Guest</th>
                    <th>Room</th>
                    <th>Nights</th>
                    <th>Channel</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.arrivals.length ? (
                    data.arrivals.map((reservation) => (
                      <tr key={reservation.id}>
                        <td>
                          <button type="button" className="btn ghost" style={{ padding: 0 }} onClick={() => setDetailId(reservation.id)}>
                            <span className="row-strong">{reservation.guest_name}</span>
                          </button>
                          <div className="small muted">{reservation.code}</div>
                        </td>
                        <td>
                          {reservation.room_number ? `Room ${reservation.room_number}` : <span className="badge warn">Unassigned</span>}
                          <div className="small muted">{reservation.room_type_name}</div>
                        </td>
                        <td>{reservation.nights}</td>
                        <td>{reservation.channel_name || 'Direct'}</td>
                        <td className="actions">
                          {canAct ? (
                            <button
                              type="button"
                              className="btn sm primary"
                              disabled={busy === `${reservation.id}:check-in`}
                              onClick={() => act(reservation, 'check-in')}
                            >
                              Check in
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5">
                        <Empty>No arrivals left for today</Empty>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card
            title="Departures today"
            subtitle="Checked-in guests due to leave"
            padded={false}
            actions={<span className="badge info">{data.departures.length}</span>}
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Guest</th>
                    <th>Room</th>
                    <th>Balance</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.departures.length ? (
                    data.departures.map((reservation) => (
                      <tr key={reservation.id}>
                        <td>
                          <button type="button" className="btn ghost" style={{ padding: 0 }} onClick={() => setDetailId(reservation.id)}>
                            <span className="row-strong">{reservation.guest_name}</span>
                          </button>
                          <div className="small muted">{reservation.code}</div>
                        </td>
                        <td>{reservation.room_number ? `Room ${reservation.room_number}` : '—'}</td>
                        <td>{money(reservation.balance)}</td>
                        <td className="actions">
                          {canAct ? (
                            <button
                              type="button"
                              className="btn sm"
                              disabled={busy === `${reservation.id}:check-out`}
                              onClick={() => act(reservation, 'check-out')}
                            >
                              Check out
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="4">
                        <Empty>No departures scheduled today</Empty>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="In house" subtitle="Currently staying" padded={false} actions={<Link className="btn ghost sm" to="/front-desk">Front desk →</Link>}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Guest</th>
                    <th>Room</th>
                    <th>Departs</th>
                    <th>Balance</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.in_house.length ? (
                    data.in_house.map((reservation) => (
                      <tr key={reservation.id}>
                        <td>
                          <span className="row-strong">{reservation.guest_name}</span>
                          <div className="small muted">{reservation.code}</div>
                        </td>
                        <td>{reservation.room_number || '—'}</td>
                        <td>{shortDate(reservation.check_out)}</td>
                        <td>{money(reservation.balance)}</td>
                        <td className="actions">
                          <button type="button" className="btn sm" onClick={() => setDetailId(reservation.id)}>
                            Folio
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5">
                        <Empty>No guests in house</Empty>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title="Booking sources" subtitle="Last 30 days">
            <div className="stack">
              {channels.length ? (
                channels.map((channel) => (
                  <div key={channel.name} className="mix-row">
                    <div className="mix-head">
                      <span className="mix-name">
                        <i className="swatch" style={{ background: channel.color }} /> {channel.name}
                      </span>
                      <span className="small muted">
                        {channel.bookings} booking{channel.bookings === 1 ? '' : 's'} · {money(channel.value)}
                      </span>
                    </div>
                    <div className="mix-track">
                      <div
                        className="mix-fill"
                        style={{ width: `${Math.round((channel.bookings / maxChannel) * 100)}%`, background: channel.color }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <Empty>No bookings in the last 30 days</Empty>
              )}
            </div>
          </Card>

          <Card title="Housekeeping" subtitle="Room status board">
            <div className="hk-grid">
              {housekeeping.map((item) => (
                <div key={item.label} className={`hk-tile ${item.tone}`}>
                  <div className="hk-value">{item.value}</div>
                  <div className="hk-label">{item.label}</div>
                </div>
              ))}
            </div>
            <Link className="btn sm" to="/rooms">
              Manage rooms
            </Link>
          </Card>

          <Card title="Next 7 days" subtitle="Upcoming arrivals" actions={<span className="badge info">{upcoming.length}</span>}>
            <div className="stack">
              {upcoming.length ? (
                upcoming.map((reservation) => (
                  <button
                    key={reservation.id}
                    type="button"
                    className="upcoming-row"
                    onClick={() => setDetailId(reservation.id)}
                  >
                    <div>
                      <div className="row-strong">{reservation.guest_name}</div>
                      <div className="small muted">
                        {reservation.room_type_name} · {reservation.nights}n
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="small">{shortDate(reservation.check_in)}</div>
                      <div className="small muted">{reservation.room_number || 'unassigned'}</div>
                    </div>
                  </button>
                ))
              ) : (
                <Empty>Nothing booked for the coming week</Empty>
              )}
            </div>
          </Card>

          <Card
            title="Channel manager"
            subtitle="iCal feeds"
            actions={
              canAct ? (
                <button type="button" className="btn sm" onClick={syncChannels} disabled={syncing}>
                  {syncing ? 'Syncing…' : 'Sync all'}
                </button>
              ) : null
            }
          >
            <div className="stack">
              {data.feeds.length ? (
                data.feeds.map((feed) => (
                  <div key={feed.id} className="row between">
                    <div>
                      <div className="row-strong">{feed.name}</div>
                      <div className="small muted">{feed.scope}</div>
                    </div>
                    <div className="stack" style={{ alignItems: 'flex-end', gap: 2 }}>
                      <StatusBadge status={feed.last_status === 'error' ? 'no_show' : feed.last_status === 'ok' ? 'clean' : 'pending'} />
                      <span className="small muted">{feed.last_sync_at ? dateTime(feed.last_sync_at) : 'never'}</span>
                    </div>
                  </div>
                ))
              ) : (
                <Empty>No import feeds yet</Empty>
              )}
              <Link className="btn sm" to="/channels">
                Open channel manager
              </Link>
            </div>
          </Card>

          <Card title="Activity" subtitle="Latest front desk actions">
            <div className="stack">
              {data.activity.length ? (
                data.activity.map((entry) => (
                  <div key={entry.id}>
                    <div className="small">
                      <strong>{entry.user_name || 'System'}</strong> · {entry.detail || entry.action}
                    </div>
                    <div className="small muted">{dateTime(entry.created_at)}</div>
                  </div>
                ))
              ) : (
                <Empty>No activity recorded yet</Empty>
              )}
            </div>
          </Card>
        </div>
      </div>

      {showForm ? (
        <ReservationForm
          onClose={() => setShowForm(false)}
          onSaved={() => {
            load();
          }}
        />
      ) : null}
      {detailId ? <ReservationDetail id={detailId} onClose={() => setDetailId(null)} onChange={load} /> : null}
    </>
  );
}
