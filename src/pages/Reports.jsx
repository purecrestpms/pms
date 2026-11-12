import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, money } from '../api.js';

const iso = (date) => date.toISOString().slice(0, 10);
const shift = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
};

const PRESETS = [
  { key: 'today', label: 'Today', from: () => shift(0), to: () => shift(0) },
  { key: '7', label: 'Last 7 days', from: () => shift(-6), to: () => shift(0) },
  { key: '30', label: 'Last 30 days', from: () => shift(-29), to: () => shift(0) },
  {
    key: 'month',
    label: 'This month',
    from: () => {
      const date = new Date();
      return iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
    },
    to: () => shift(0)
  },
  {
    key: 'lastmonth',
    label: 'Last month',
    from: () => {
      const date = new Date();
      return iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1)));
    },
    to: () => {
      const date = new Date();
      return iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0)));
    }
  }
];

function pretty(isoDate) {
  if (!isoDate) return '—';
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className={`kpi-tile${tone ? ` ${tone}` : ''}`}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {sub ? <span className="kpi-sub">{sub}</span> : null}
    </div>
  );
}

export default function Reports() {
  const [preset, setPreset] = useState('30');
  const [from, setFrom] = useState(shift(-29));
  const [to, setTo] = useState(shift(0));
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [csvType, setCsvType] = useState('reservations');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get(`/reports/summary?from=${from}&to=${to}`);
      setReport(data);
    } catch (loadError) {
      setError(loadError.message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const applyPreset = (item) => {
    setPreset(item.key);
    setFrom(item.from());
    setTo(item.to());
  };

  const currency = report?.currency || 'NGN';
  const kpis = report?.kpis;
  const peak = useMemo(() => {
    if (!report) return 1;
    return Math.max(1, ...report.daily.map((row) => row.rooms));
  }, [report]);

  const download = (path) => {
    window.location.href = path;
  };

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h2 className="page-title">Reporting</h2>
          <p className="muted small">Occupancy, revenue and channel production for any date range.</p>
        </div>
        <div className="page-head-actions">
          <label className="inline-field">
            <span>Export</span>
            <select value={csvType} onChange={(event) => setCsvType(event.target.value)}>
              <option value="reservations">Reservations</option>
              <option value="payments">Payments</option>
              <option value="daily">Daily summary</option>
              <option value="channels">Channel production</option>
            </select>
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => download(`/api/reports/export.csv?from=${from}&to=${to}&type=${csvType}`)}
          >
            Download CSV
          </button>
          <button type="button" className="btn primary" onClick={() => download(`/api/reports/export.pdf?from=${from}&to=${to}`)}>
            Download PDF
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="preset-row">
          {PRESETS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`chip-btn${preset === item.key ? ' active' : ''}`}
              onClick={() => applyPreset(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="date-row">
          <label className="inline-field">
            <span>From</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) => {
                setPreset('custom');
                setFrom(event.target.value);
              }}
            />
          </label>
          <label className="inline-field">
            <span>To</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(event) => {
                setPreset('custom');
                setTo(event.target.value);
              }}
            />
          </label>
          <button type="button" className="btn sm" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? <div className="inline-error">{error}</div> : null}

      {kpis ? (
        <>
          <div className="kpi-grid">
            <Kpi label="Occupancy" value={`${kpis.occupancy}%`} sub={`${kpis.room_nights} of ${kpis.available_room_nights} room nights`} tone="accent" />
            <Kpi label="Room revenue" value={money(kpis.room_revenue, currency)} sub={`ADR ${money(kpis.adr, currency)}`} />
            <Kpi label="Payments collected" value={money(kpis.payments_total, currency)} sub="Cash, card and transfers" />
            <Kpi label="RevPAR" value={money(kpis.revpar, currency)} sub={`${kpis.rooms} rooms in inventory`} />
            <Kpi label="Bookings" value={kpis.bookings} sub={`${kpis.arrivals} arrivals · ${kpis.departures} departures`} />
            <Kpi label="Cancellations" value={kpis.cancelled} sub={pretty(report.range.from) + ' → ' + pretty(report.range.to)} />
          </div>

          <section className="card">
            <div className="card-head">
              <h3>Daily occupancy & revenue</h3>
              <span className="badge neutral">{report.range.days} days</span>
            </div>
            <div className="bar-chart">
              {report.daily.map((row) => (
                <div className="bar-col" key={row.date} title={`${pretty(row.date)} · ${row.rooms} rooms · ${money(row.room_revenue, currency)}`}>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ height: `${Math.round((row.rooms / peak) * 100)}%` }} />
                  </div>
                  <span className="bar-label">{row.date.slice(8)}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="split-grid">
            <section className="card">
              <h3>Channel production</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th className="num">Bookings</th>
                    <th className="num">Room nights</th>
                    <th className="num">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_channel.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td className="num">{row.bookings}</td>
                      <td className="num">{row.room_nights}</td>
                      <td className="num">{money(row.revenue, currency)}</td>
                    </tr>
                  ))}
                  {!report.by_channel.length ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        No bookings in this range
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </section>

            <section className="card">
              <h3>Payments by method</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th className="num">Transactions</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_method.map((row) => (
                    <tr key={row.method}>
                      <td style={{ textTransform: 'capitalize' }}>{row.method}</td>
                      <td className="num">{row.count}</td>
                      <td className="num">{money(row.total, currency)}</td>
                    </tr>
                  ))}
                  {!report.by_method.length ? (
                    <tr>
                      <td colSpan={3} className="muted">
                        No payments in this range
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </section>
          </div>

          <div className="split-grid">
            <section className="card">
              <h3>Room type performance</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Room type</th>
                    <th className="num">Bookings</th>
                    <th className="num">Nights</th>
                    <th className="num">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_room_type.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td className="num">{row.bookings}</td>
                      <td className="num">{row.room_nights}</td>
                      <td className="num">{money(row.revenue, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="card">
              <h3>Daily detail</h3>
              <div className="scroll-y">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="num">Rooms</th>
                      <th className="num">Occ %</th>
                      <th className="num">Revenue</th>
                      <th className="num">Payments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.daily.map((row) => (
                      <tr key={row.date}>
                        <td>{pretty(row.date)}</td>
                        <td className="num">{row.rooms}</td>
                        <td className="num">{row.occupancy}</td>
                        <td className="num">{money(row.room_revenue, currency)}</td>
                        <td className="num">{money(row.payments, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="card">
            <div className="card-head">
              <h3>Reservations in range</h3>
              <span className="muted small">{report.reservations.length} bookings</span>
            </div>
            <div className="scroll-y tall">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Booking</th>
                    <th>Guest</th>
                    <th>Room</th>
                    <th>Arrival</th>
                    <th>Departure</th>
                    <th className="num">Nights</th>
                    <th>Channel</th>
                    <th className="num">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {report.reservations.map((row) => (
                    <tr key={row.id}>
                      <td className="mono">{row.code}</td>
                      <td>{row.guest_name}</td>
                      <td>
                        {row.room_number || '—'} <span className="muted small">{row.room_type_name}</span>
                      </td>
                      <td>{pretty(row.check_in)}</td>
                      <td>{pretty(row.check_out)}</td>
                      <td className="num">{row.nights}</td>
                      <td>{row.channel_name || 'Direct'}</td>
                      <td className="num">{money(row.revenue, currency)}</td>
                    </tr>
                  ))}
                  {!report.reservations.length ? (
                    <tr>
                      <td colSpan={8} className="muted">
                        No reservations in this range
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        !loading && <p className="muted">Choose a date range to build the report.</p>
      )}
    </div>
  );
}
