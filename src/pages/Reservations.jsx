import React, { useCallback, useEffect, useState } from 'react';
import { api, shortDate, STATUS_LABELS } from '../api.js';
import { Banner, Card, Empty, Field, Spinner, StatusBadge, useApp } from '../components/ui.jsx';
import ReservationForm from '../components/ReservationForm.jsx';
import ReservationDetail from '../components/ReservationDetail.jsx';

const STATUSES = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'];

export default function Reservations() {
  const { money, toast } = useApp();
  const [filters, setFilters] = useState({ q: '', status: '', from: '', to: '' });
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filters.q.trim()) params.set('q', filters.q.trim());
    if (filters.status) params.set('status', filters.status);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    try {
      const data = await api.get(`/reservations${params.toString() ? `?${params}` : ''}`);
      setRows(data.reservations || []);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value }));

  const totals = (rows || []).reduce(
    (acc, row) => {
      acc.charges += Number(row.charges_total || 0);
      acc.payments += Number(row.payments_total || 0);
      return acc;
    },
    { charges: 0, payments: 0 }
  );

  return (
    <>
      <Banner kind="error">{error}</Banner>

      <Card
        title="Reservations"
        subtitle={`${rows ? rows.length : 0} booking(s) · ${money(totals.charges)} charged · ${money(totals.payments)} collected`}
        padded={false}
        actions={
          <button type="button" className="btn primary sm" onClick={() => setShowForm(true)}>
            + New reservation
          </button>
        }
      >
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="inline-form">
            <Field label="Search">
              <input value={filters.q} onChange={set('q')} placeholder="Guest, code, room, OTA ref" autoComplete="off" />
            </Field>
            <Field label="Status">
              <select value={filters.status} onChange={set('status')}>
                <option value="">Any status</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Staying from">
              <input type="date" value={filters.from} onChange={set('from')} />
            </Field>
            <Field label="Staying until">
              <input type="date" value={filters.to} onChange={set('to')} />
            </Field>
            <button type="button" className="btn" onClick={load}>
              Apply
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setFilters({ q: '', status: '', from: '', to: '' })}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Guest</th>
                <th>Stay</th>
                <th>Room</th>
                <th>Channel</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
                <th style={{ textAlign: 'right' }}>Balance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr>
                  <td colSpan="9">
                    <Spinner />
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((reservation) => (
                  <tr key={reservation.id}>
                    <td className="mono">{reservation.code}</td>
                    <td>
                      <span className="row-strong">{reservation.guest_name}</span>
                      <div className="small muted">{reservation.guest_email || reservation.guest_phone || '—'}</div>
                    </td>
                    <td>
                      {shortDate(reservation.check_in)} → {shortDate(reservation.check_out)}
                      <div className="small muted">{reservation.nights} night(s)</div>
                    </td>
                    <td>
                      {reservation.room_number || '—'}
                      <div className="small muted">{reservation.room_type_name}</div>
                    </td>
                    <td>{reservation.channel_name || 'Direct'}</td>
                    <td>
                      <StatusBadge status={reservation.status} />
                    </td>
                    <td style={{ textAlign: 'right' }}>{money(reservation.rate)}</td>
                    <td style={{ textAlign: 'right' }}>{money(reservation.balance)}</td>
                    <td className="actions">
                      <button type="button" className="btn sm" onClick={() => setDetailId(reservation.id)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="9">
                    <Empty>No reservations match these filters</Empty>
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
          onSaved={(reservation) => {
            toast(`Reservation ${reservation.code} created`);
            load();
          }}
        />
      ) : null}
      {detailId ? <ReservationDetail id={detailId} onClose={() => setDetailId(null)} onChange={load} /> : null}
    </>
  );
}
