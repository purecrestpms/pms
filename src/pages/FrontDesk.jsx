import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, addDays, isoToday, shortDate } from '../api.js';
import { Banner, Card, Empty, Field, Spinner, StatusBadge, useApp } from '../components/ui.jsx';
import ReservationForm from '../components/ReservationForm.jsx';
import ReservationDetail from '../components/ReservationDetail.jsx';

const TABS = [
  { id: 'arrivals', label: 'Arrivals' },
  { id: 'in_house', label: 'In house' },
  { id: 'departures', label: 'Departures' },
  { id: 'all', label: 'All bookings' }
];

export default function FrontDesk() {
  const { money, toast } = useApp();
  const today = isoToday();
  const [tab, setTab] = useState('arrivals');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const load = useCallback(async () => {
    try {
      const path =
        tab === 'all'
          ? `/reservations${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`
          : `/reservations?from=${today}&to=${addDays(today, 1)}`;
      const data = await api.get(path);
      setRows(data.reservations || []);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [tab, query, today]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (reservation, action) => {
    setBusy(`${reservation.id}:${action}`);
    try {
      const result = await api.post(`/reservations/${reservation.id}/${action}`);
      const labels = {
        'check-in': `${result.reservation.guest_name} checked in to room ${result.reservation.room_number}`,
        'check-out': `${result.reservation.guest_name} checked out`,
        cancel: `${result.reservation.code} cancelled`,
        'no-show': `${result.reservation.code} marked as no-show`
      };
      toast(labels[action] || 'Updated');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const visible = useMemo(() => {
    if (!rows) return [];
    if (tab === 'arrivals') return rows.filter((row) => row.check_in === today && ['pending', 'confirmed'].includes(row.status));
    if (tab === 'departures') return rows.filter((row) => row.check_out === today && row.status === 'checked_in');
    if (tab === 'in_house') return rows.filter((row) => row.status === 'checked_in');
    return rows;
  }, [rows, tab, today]);

  return (
    <>
      <Banner kind="error">{error}</Banner>

      <Card
        title="Front desk operations"
        subtitle={`${shortDate(today)} · arrivals, in-house guests and departures`}
        padded={false}
        actions={
          <>
            <div className="tabs">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`tab${tab === item.id ? ' active' : ''}`}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button type="button" className="btn primary sm" onClick={() => setShowForm(true)}>
              + New reservation
            </button>
          </>
        }
      >
        {tab === 'all' ? (
          <div className="card-body" style={{ paddingBottom: 0 }}>
            <div className="inline-form">
              <Field label="Search bookings" hint="Guest name, booking code, room or OTA reference">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search…"
                  autoComplete="off"
                />
              </Field>
              <button type="button" className="btn" onClick={load}>
                Search
              </button>
            </div>
          </div>
        ) : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Guest</th>
                <th>Stay</th>
                <th>Room</th>
                <th>Channel</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Balance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr>
                  <td colSpan="7">
                    <Spinner />
                  </td>
                </tr>
              ) : visible.length ? (
                visible.map((reservation) => (
                  <tr key={reservation.id}>
                    <td>
                      <button type="button" className="btn ghost" style={{ padding: 0 }} onClick={() => setDetailId(reservation.id)}>
                        <span className="row-strong">{reservation.guest_name}</span>
                      </button>
                      <div className="small muted">
                        {reservation.code} · {reservation.adults}A/{reservation.children}C
                      </div>
                    </td>
                    <td>
                      {shortDate(reservation.check_in)} → {shortDate(reservation.check_out)}
                      <div className="small muted">{reservation.nights} night(s)</div>
                    </td>
                    <td>
                      {reservation.room_number ? `Room ${reservation.room_number}` : <span className="badge warn">Unassigned</span>}
                      <div className="small muted">{reservation.room_type_name}</div>
                    </td>
                    <td>{reservation.channel_name || 'Direct'}</td>
                    <td>
                      <StatusBadge status={reservation.status} />
                    </td>
                    <td style={{ textAlign: 'right' }}>{money(reservation.balance)}</td>
                    <td className="actions">
                      {['pending', 'confirmed'].includes(reservation.status) ? (
                        <>
                          <button
                            type="button"
                            className="btn sm primary"
                            disabled={busy === `${reservation.id}:check-in`}
                            onClick={() => act(reservation, 'check-in')}
                          >
                            Check in
                          </button>{' '}
                          <button type="button" className="btn sm" onClick={() => setDetailId(reservation.id)}>
                            Folio
                          </button>
                        </>
                      ) : null}
                      {reservation.status === 'checked_in' ? (
                        <button
                          type="button"
                          className="btn sm"
                          disabled={busy === `${reservation.id}:check-out`}
                          onClick={() => act(reservation, 'check-out')}
                        >
                          Check out
                        </button>
                      ) : null}
                      {['checked_out', 'cancelled', 'no_show'].includes(reservation.status) ? (
                        <button type="button" className="btn sm" onClick={() => setDetailId(reservation.id)}>
                          View
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7">
                    <Empty>
                      {tab === 'arrivals'
                        ? 'No arrivals waiting to check in today'
                        : tab === 'departures'
                        ? 'No departures due today'
                        : tab === 'in_house'
                        ? 'No guests currently in house'
                        : 'No bookings match this search'}
                    </Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

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
