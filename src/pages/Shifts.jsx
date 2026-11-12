import React, { useCallback, useEffect, useState } from 'react';
import { api, dateTime } from '../api.js';
import { Banner, Card, Empty, Field, Spinner, useApp } from '../components/ui.jsx';

function duration(openedAt, closedAt) {
  if (!openedAt) return '—';
  const start = new Date(openedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const minutes = Math.max(0, Math.round((end - start) / 60000));
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function methodLabel(method) {
  return String(method || 'card').replace('_', ' ');
}

export default function Shifts() {
  const { money, toast, user } = useApp();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openForm, setOpenForm] = useState({ opening_float: '200', notes: '' });
  const [closeForm, setCloseForm] = useState({ counted_cash: '', closing_notes: '' });

  const load = useCallback(async () => {
    try {
      const payload = await api.get('/shifts');
      setData(payload);
      if (payload.current) {
        setCloseForm({
          counted_cash: String(payload.current.totals.expected_cash ?? ''),
          closing_notes: ''
        });
      }
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openShift = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/shifts/open', openForm);
      toast('Shift opened');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const closeShift = async (event) => {
    event.preventDefault();
    if (!data?.current) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.post(`/shifts/${data.current.id}/close`, closeForm);
      const variance = result?.shift?.totals?.variance;
      toast(variance === null || variance === undefined ? 'Shift closed' : `Shift closed · variance ${money(variance)}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <div className="centered-page">
        <Spinner />
      </div>
    );
  }

  const current = data.current;
  const totals = current?.totals;

  return (
    <div className="stack">
      <Banner kind="error">{error}</Banner>

      <div className="grid two">
        <Card
          title={current ? 'Open shift' : 'No open shift'}
          subtitle={
            current
              ? `Opened ${dateTime(current.opened_at)} · ${duration(current.opened_at)} · ${current.cashier_name}`
              : `Sign in and open a shift to attach payments and cash to your name.`
          }
        >
          {current ? (
            <div className="stack">
              <div className="stat-row">
                <div className="stat-tile">
                  <span className="stat-label">Opening float</span>
                  <span className="stat-value">{money(totals.opening_float)}</span>
                </div>
                <div className="stat-tile">
                  <span className="stat-label">Payments taken</span>
                  <span className="stat-value">{money(totals.payments_total)}</span>
                </div>
                <div className="stat-tile">
                  <span className="stat-label">Cash sales</span>
                  <span className="stat-value">{money(totals.cash_total)}</span>
                </div>
                <div className="stat-tile">
                  <span className="stat-label">Expected drawer</span>
                  <span className="stat-value">{money(totals.expected_cash)}</span>
                </div>
              </div>

              {totals.by_method.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Method</th>
                        <th>Payments</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {totals.by_method.map((row) => (
                        <tr key={row.method}>
                          <td className="capitalize">{methodLabel(row.method)}</td>
                          <td>{row.count}</td>
                          <td style={{ textAlign: 'right' }}>{money(row.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>No payments captured in this shift yet.</Empty>
              )}

              {totals.payments.length ? (
                <details className="detail-block">
                  <summary>{totals.payments.length} payments in this shift</summary>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Booking</th>
                          <th>Guest</th>
                          <th>Method</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {totals.payments.map((payment) => (
                          <tr key={payment.id}>
                            <td className="muted small">{dateTime(payment.created_at)}</td>
                            <td className="mono">{payment.reservation_code}</td>
                            <td>{payment.guest_name}</td>
                            <td className="capitalize">{methodLabel(payment.method)}</td>
                            <td style={{ textAlign: 'right' }}>{money(payment.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : null}

              <form className="inline-form" onSubmit={closeShift}>
                <Field label="Counted cash" hint="Cash physically in the drawer at handover">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={closeForm.counted_cash}
                    onChange={(event) => setCloseForm({ ...closeForm, counted_cash: event.target.value })}
                  />
                </Field>
                <Field label="Handover notes">
                  <input
                    value={closeForm.closing_notes}
                    onChange={(event) => setCloseForm({ ...closeForm, closing_notes: event.target.value })}
                    placeholder="Anything the next shift should know"
                  />
                </Field>
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'Closing…' : 'Close shift'}
                </button>
                <a className="btn" href={`/api/shifts/${current.id}/report.pdf`} target="_blank" rel="noreferrer">
                  Shift report PDF
                </a>
              </form>
            </div>
          ) : (
            <form className="inline-form" onSubmit={openShift}>
              <Field label="Opening float" hint="Cash in the drawer at the start of your shift">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={openForm.opening_float}
                  onChange={(event) => setOpenForm({ ...openForm, opening_float: event.target.value })}
                />
              </Field>
              <Field label="Notes">
                <input
                  value={openForm.notes}
                  onChange={(event) => setOpenForm({ ...openForm, notes: event.target.value })}
                  placeholder={`Opening ${new Date().toLocaleDateString('en-GB', { weekday: 'long' })} shift`}
                />
              </Field>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Opening…' : 'Open shift'}
              </button>
            </form>
          )}
        </Card>

        <Card title="How shifts work" subtitle="Every payment is stamped with the shift that took it">
          <ul className="plain-list">
            <li>Open a shift when you start at the desk — the opening float is recorded against your name.</li>
            <li>Folio payments taken while your shift is open are attached to it automatically.</li>
            <li>At handover, count the cash. The system compares it with expected cash and records any variance.</li>
            <li>Download the shift report as a PDF for the cash-up book or your accountant.</li>
            <li>Managers can close any cashier&apos;s shift; front desk staff can close only their own.</li>
          </ul>
          {user ? <p className="muted small">Signed in as {user.name}.</p> : null}
        </Card>
      </div>

      <Card title="Shift history" subtitle="Last 40 shifts with cash-up results">
        {data.shifts.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Cashier</th>
                  <th>Opened</th>
                  <th>Closed</th>
                  <th>Duration</th>
                  <th style={{ textAlign: 'right' }}>Payments</th>
                  <th style={{ textAlign: 'right' }}>Expected</th>
                  <th style={{ textAlign: 'right' }}>Counted</th>
                  <th style={{ textAlign: 'right' }}>Variance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.shifts.map((shift) => {
                  const variance = shift.totals.variance;
                  return (
                    <tr key={shift.id}>
                      <td className="mono">{shift.id}</td>
                      <td>{shift.cashier_name}</td>
                      <td className="muted small">{dateTime(shift.opened_at)}</td>
                      <td className="muted small">{shift.closed_at ? dateTime(shift.closed_at) : '—'}</td>
                      <td>{duration(shift.opened_at, shift.closed_at)}</td>
                      <td style={{ textAlign: 'right' }}>{money(shift.totals.payments_total)}</td>
                      <td style={{ textAlign: 'right' }}>{money(shift.totals.expected_cash)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {shift.totals.counted_cash === null ? '—' : money(shift.totals.counted_cash)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {variance === null ? (
                          <span className={`badge ${shift.status === 'open' ? 'info' : 'neutral'}`}>
                            {shift.status === 'open' ? 'open' : 'not counted'}
                          </span>
                        ) : (
                          <span className={`badge ${Math.abs(variance) < 0.005 ? 'ok' : 'warn'}`}>{money(variance)}</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <a className="btn sm" href={`/api/shifts/${shift.id}/report.pdf`} target="_blank" rel="noreferrer">
                          PDF
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No shifts recorded yet.</Empty>
        )}
      </Card>
    </div>
  );
}
