import React, { useState } from 'react';
import { api } from '../api.js';
import { Banner, Field } from '../components/ui.jsx';

const DEMO = [
  { role: 'Administrator', email: 'admin@hotelpms.local', password: 'Admin123!' },
  { role: 'Front desk', email: 'frontdesk@hotelpms.local', password: 'Front123!' },
  { role: 'Housekeeping', email: 'housekeeping@hotelpms.local', password: 'House123!' }
];

export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState('admin@hotelpms.local');
  const [password, setPassword] = useState('Admin123!');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api.post('/auth/login', { email, password });
      onSignedIn(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <aside className="login-aside">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark">PCH</div>
          <div>
            <div className="brand-name" style={{ fontSize: 17 }}>
              PCH PMS
            </div>
            <div className="brand-sub">Hotel property management</div>
          </div>
        </div>
        <h1>Run the front desk, housekeeping and every sales channel from one screen.</h1>
        <p>
          A complete property management system: reservations, tape chart availability, guest folios, staff accounts and
          two-way iCal channel sync with OTAs.
        </p>
        <div className="feature-list">
          {[
            'Front desk check-in / check-out with room assignment and folios',
            'Advanced availability calendar with an occupancy heat strip and filters',
            'Guest profiles with documents, preferences and lifetime stay history',
            'Shifts and cash-up: drawer float, variance and printable shift reports',
            'Public booking website synced live with room availability',
            'iCal export calendar and import feeds for Booking.com, Airbnb or Expedia',
            'Admin-created staff accounts with role-based permissions',
            'Guest folio and registration card PDFs for printing'
          ].map((item) => (
            <div className="feature" key={item}>
              <span className="feature-check">✓</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </aside>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div>
            <h2>Sign in</h2>
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              Use the staff account created by your administrator.
            </p>
          </div>

          <Banner kind="error">{error}</Banner>

          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          <button type="submit" className="btn primary block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="demo-box">
            <strong>Demo staff accounts</strong>
            {DEMO.map((account) => (
              <div className="demo-row" key={account.email}>
                <span>
                  {account.role} · <span className="mono">{account.email}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(account.password);
                    setError('');
                  }}
                >
                  use
                </button>
              </div>
            ))}
            <span className="muted">Passwords follow the pattern Role123! — change them after the first sign-in.</span>
          </div>
        </form>
      </section>
    </div>
  );
}
