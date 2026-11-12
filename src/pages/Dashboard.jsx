import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dateTime, shortDate } from '../api.js';
import { Banner, Card, Empty, Spinner, StatusBadge, useApp } from '../components/ui.jsx';
import ReservationForm from '../components/ReservationForm.jsx';
import ReservationDetail from '../components/ReservationDetail.jsx';

function Stat({ label, value, hint, accent = false }) {
  return (
    <div className={`stat${accent ? ' accent' : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export default function Dashboard() {
  const { money, can, toast } = useApp();
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

  if (!data) {
    return (
      <Card title="Dashboard">
        {error ? <Banner kind="error">{error}</Banner> : <Spinner />}
      </Card>
    );
  }

  const stats = data.stats;
  const canAct = can('manager', 'front_desk');

  return (
    <>
      <Banner kind="error">{error}</Banner>

      <div className="stats">
        <Stat label="Occupancy" value={`${stats.occupancy}%`} hint={`${stats.occupied}/${stats.total_rooms} rooms`} accent />
        <Stat label="Arrivals" value={stats.arrivals} hint="due today" />
        <Stat label="Departures" value={stats.departures} hint="due today" />
        <Stat label="In house" value={stats.in_house} hint="guests staying" />
        <Stat label="Available" value={stats.available} hint={`${stats.blocked} blocked`} />
        <Stat label="Revenue today" value={money(stats.revenue_today)} hint="posted charges" />
      </div>

      <div className="row between">
        <div className="pill-row">
          <span className="badge ok">Clean {stats.clean}</span>
          <span className="badge warn">Dirty {stats.dirty}</span>
          <span className="badge info">Inspected {stats.inspected}</span>
          <span className="badge danger">Out of order {stats.out_of_order}</span>
        </div>
        <div className="row">
          {canAct ? (
            <button type="button" className="btn primary" onClick={() => setShowForm(true)}>
              + New reservation
            </button>
          ) : null}
          <button type="button" className="btn" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      <div className="split">
        <div className="stack">
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

          <Card title="Housekeeping" subtitle="Room status board">
            <div className="stack">
              <div className="row between">
                <span>Dirty rooms</span>
                <span className="badge warn">{stats.dirty}</span>
              </div>
              <div className="row between">
                <span>Clean & ready</span>
                <span className="badge ok">{stats.clean + stats.inspected}</span>
              </div>
              <div className="row between">
                <span>Out of order</span>
                <span className="badge danger">{stats.out_of_order}</span>
              </div>
              <Link className="btn sm" to="/rooms">
                Manage rooms
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
