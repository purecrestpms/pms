import React, { useCallback, useEffect, useState } from 'react';
import { api, dateTime, shortDate } from '../api.js';
import { Banner, Field, Modal, Spinner, StatusBadge, useApp } from './ui.jsx';
import ReservationForm from './ReservationForm.jsx';

export default function ReservationDetail({ id, onClose, onChange }) {
  const { money, toast, can } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(false);
  const [charge, setCharge] = useState({ description: '', amount: '', quantity: 1 });
  const [payment, setPayment] = useState({ amount: '', method: 'card', reference: '' });

  const load = useCallback(async () => {
    try {
      setData(await api.get(`/reservations/${id}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (action, label) => {
    setBusy(action);
    try {
      const result = await api.post(`/reservations/${id}/${action}`);
      toast(label(result.reservation));
      await load();
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const addCharge = async (event) => {
    event.preventDefault();
    setBusy('charge');
    try {
      await api.post(`/reservations/${id}/charges`, {
        description: charge.description,
        amount: Number(charge.amount),
        quantity: Number(charge.quantity || 1)
      });
      setCharge({ description: '', amount: '', quantity: 1 });
      await load();
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const addPayment = async (event) => {
    event.preventDefault();
    setBusy('payment');
    try {
      await api.post(`/reservations/${id}/payments`, {
        amount: Number(payment.amount),
        method: payment.method,
        reference: payment.reference
      });
      setPayment({ amount: '', method: 'card', reference: '' });
      await load();
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const removeCharge = async (chargeId) => {
    try {
      await api.del(`/reservations/${id}/charges/${chargeId}`);
      await load();
      onChange?.();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!data) {
    return (
      <Modal title="Reservation" onClose={onClose}>
        {error ? <Banner kind="error">{error}</Banner> : <Spinner />}
      </Modal>
    );
  }

  const reservation = data.reservation;
  const charges = data.charges || [];
  const payments = data.payments || [];
  const canAct = can('manager', 'front_desk');

  return (
    <>
      <Modal
        wide
        title={`${reservation.code} · ${reservation.guest_name}`}
        subtitle={`${shortDate(reservation.check_in)} → ${shortDate(reservation.check_out)} · ${reservation.nights} night(s) · ${
          reservation.room_number ? `Room ${reservation.room_number}` : 'Room not assigned'
        }`}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
            {canAct && reservation.status !== 'checked_out' && reservation.status !== 'cancelled' ? (
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                Edit stay
              </button>
            ) : null}
            {canAct && ['pending', 'confirmed'].includes(reservation.status) ? (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={busy !== ''}
                  onClick={() => runAction('no-show', (r) => `${r.code} marked as no-show`)}
                >
                  No-show
                </button>
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy !== ''}
                  onClick={() => runAction('cancel', (r) => `${r.code} cancelled`)}
                >
                  Cancel booking
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy !== ''}
                  onClick={() => runAction('check-in', (r) => `${r.guest_name} checked in to room ${r.room_number}`)}
                >
                  {busy === 'check-in' ? 'Checking in…' : 'Check in'}
                </button>
              </>
            ) : null}
            {canAct && reservation.status === 'checked_in' ? (
              <button
                type="button"
                className="btn primary"
                disabled={busy !== ''}
                onClick={() => runAction('check-out', (r) => `${r.guest_name} checked out`)}
              >
                {busy === 'check-out' ? 'Checking out…' : 'Check out'}
              </button>
            ) : null}
          </>
        }
      >
        <Banner kind="error">{error}</Banner>
        <div className="row between">
          <StatusBadge status={reservation.status} />
          <div className="pill-row">
            <span className="badge neutral">{reservation.channel_name || 'Direct'}</span>
            <span className="badge neutral">{money(reservation.rate)} / night</span>
            {reservation.external_ref ? <span className="badge neutral">OTA {reservation.external_ref}</span> : null}
          </div>
        </div>

        <div className="grid cols-2">
          <div>
            <h4 className="small" style={{ color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Guest
            </h4>
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Name</dt>
              <dd>{reservation.guest_name}</dd>
              <dt>Email</dt>
              <dd>{reservation.guest_email || '—'}</dd>
              <dt>Phone</dt>
              <dd>{reservation.guest_phone || '—'}</dd>
              <dt>Country</dt>
              <dd>{reservation.guest_country || '—'}</dd>
              <dt>Party</dt>
              <dd>
                {reservation.adults} adult(s), {reservation.children} child(ren)
              </dd>
            </dl>
          </div>
          <div>
            <h4 className="small" style={{ color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Stay
            </h4>
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Room type</dt>
              <dd>{reservation.room_type_name}</dd>
              <dt>Room</dt>
              <dd>{reservation.room_number || 'Unassigned'}</dd>
              <dt>Check-in</dt>
              <dd>{shortDate(reservation.check_in)}</dd>
              <dt>Check-out</dt>
              <dd>{shortDate(reservation.check_out)}</dd>
              <dt>Checked in</dt>
              <dd>{dateTime(reservation.checked_in_at)}</dd>
            </dl>
          </div>
        </div>

        {reservation.notes ? <Banner kind="info">{reservation.notes}</Banner> : null}

        <div className="grid cols-2">
          <div className="stack">
            <div className="row between">
              <h4>Folio charges</h4>
              <span className="small muted">{money(reservation.charges_total)}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {charges.length ? (
                    charges.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.description}
                          <div className="small muted">{dateTime(item.created_at)}</div>
                        </td>
                        <td style={{ textAlign: 'right' }}>{money(item.amount * item.quantity)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {canAct ? (
                            <button type="button" className="btn ghost sm" onClick={() => removeCharge(item.id)}>
                              Void
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="3" className="muted">
                        No charges yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {canAct ? (
              <form className="inline-form" onSubmit={addCharge}>
                <Field label="Description">
                  <input
                    value={charge.description}
                    onChange={(event) => setCharge({ ...charge, description: event.target.value })}
                    placeholder="Minibar, breakfast…"
                    required
                  />
                </Field>
                <Field label="Amount">
                  <input
                    type="number"
                    step="0.01"
                    value={charge.amount}
                    onChange={(event) => setCharge({ ...charge, amount: event.target.value })}
                    required
                  />
                </Field>
                <button type="submit" className="btn sm" disabled={busy === 'charge'}>
                  Post
                </button>
              </form>
            ) : null}
          </div>

          <div className="stack">
            <div className="row between">
              <h4>Payments</h4>
              <span className="small muted">{money(reservation.payments_total)}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Method</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.length ? (
                    payments.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.method}
                          <div className="small muted">{item.reference || dateTime(item.created_at)}</div>
                        </td>
                        <td style={{ textAlign: 'right' }}>{money(item.amount)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="2" className="muted">
                        No payments recorded
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="banner info" style={{ justifyContent: 'space-between' }}>
              <span>Balance due</span>
              <strong>{money(reservation.balance)}</strong>
            </div>
            {canAct ? (
              <form className="inline-form" onSubmit={addPayment}>
                <Field label="Amount">
                  <input
                    type="number"
                    step="0.01"
                    value={payment.amount}
                    onChange={(event) => setPayment({ ...payment, amount: event.target.value })}
                    required
                  />
                </Field>
                <Field label="Method">
                  <select value={payment.method} onChange={(event) => setPayment({ ...payment, method: event.target.value })}>
                    <option value="card">Card</option>
                    <option value="cash">Cash</option>
                    <option value="transfer">Bank transfer</option>
                    <option value="ota">OTA prepaid</option>
                  </select>
                </Field>
                <button type="submit" className="btn sm" disabled={busy === 'payment'}>
                  Record
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </Modal>

      {editing ? (
        <ReservationForm
          initial={reservation}
          onClose={() => setEditing(false)}
          onSaved={() => {
            load();
            onChange?.();
          }}
        />
      ) : null}
    </>
  );
}
