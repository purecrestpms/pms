import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api, money } from './api.js';
import { AppContext, Spinner, roleLabel, useToasts } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import FrontDesk from './pages/FrontDesk.jsx';
import Reservations from './pages/Reservations.jsx';
import TapeChart from './pages/TapeChart.jsx';
import Channels from './pages/Channels.jsx';
import Rooms from './pages/Rooms.jsx';
import Staff from './pages/Staff.jsx';
import Settings from './pages/Settings.jsx';
import Guests from './pages/Guests.jsx';
import Shifts from './pages/Shifts.jsx';
import Reports from './pages/Reports.jsx';
import Website from './pages/Website.jsx';
import Roles from './pages/Roles.jsx';
import Help from './pages/Help.jsx';
import BookingSite from './pages/BookingSite.jsx';

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: '◧', perm: 'dashboard', end: true }]
  },
  {
    label: 'Front office',
    items: [
      { to: '/front-desk', label: 'Front desk', icon: '🛎', perm: 'front_desk' },
      { to: '/reservations', label: 'Reservations', icon: '📖', perm: 'reservations' },
      { to: '/guests', label: 'Guest profiles', icon: '👥', perm: 'guests' },
      { to: '/calendar', label: 'Calendar', icon: '▦', perm: 'calendar' }
    ]
  },
  {
    label: 'Revenue & distribution',
    items: [
      { to: '/channels', label: 'Channel manager', icon: '⇄', perm: 'channels' },
      { to: '/reports', label: 'Reporting', icon: '📈', perm: 'reports' },
      { to: '/website', label: 'Booking website', icon: '🌐', perm: 'website' }
    ]
  },
  {
    label: 'Operations',
    items: [
      { to: '/shifts', label: 'Shifts & cash-up', icon: '🕒', perm: 'shifts' },
      { to: '/rooms', label: 'Rooms & housekeeping', icon: '🛏', perm: 'rooms' }
    ]
  },
  {
    label: 'Administration',
    items: [
      { to: '/staff', label: 'Staff accounts', icon: '👤', perm: 'staff' },
      { to: '/roles', label: 'Roles & permissions', icon: '🔑', perm: 'roles' },
      { to: '/settings', label: 'Settings', icon: '⚙', perm: 'settings' },
      { to: '/help', label: 'Help & training', icon: '❓', perm: null }
    ]
  }
];

const TITLES = {
  '/': ['Richgates dashboard', 'Occupancy, revenue and the state of the house today'],
  '/front-desk': ['Front desk', 'Walk-ins, check-in, check-out and guest folios'],
  '/reservations': ['Reservations', 'Every booking with its folio, balance and channel'],
  '/guests': ['Guest profiles', 'Contact details, documents, preferences and stay history'],
  '/calendar': ['Calendar', 'Occupancy heat strip, channel blocks and instant booking'],
  '/shifts': ['Shifts & cash-up', 'Open a shift, take payments, count the drawer and print the report'],
  '/channels': ['Channel manager', 'iCal import feeds, export calendars and conflict detection'],
  '/rooms': ['Apartments & rooms', 'Inventory, rates, amenities and the room status board'],
  '/reports': ['Reporting', 'Occupancy, revenue, channel mix and exports to CSV or PDF'],
  '/website': ['Booking website editor', 'Brand, images, room photos, amenities, domain and card payments'],
  '/staff': ['Staff accounts', 'Create and manage front desk, housekeeping and admin users'],
  '/roles': ['Roles & permissions', 'Build custom roles and assign them to your team'],
  '/settings': ['Settings', 'Property details, your password and the audit trail'],
  '/help': ['Help & training', 'Documentation, training guide, install and licensing']
};

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

const clock = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

function ShiftWidget() {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [float, setFloat] = useState('0');
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api.get('/shift/state'));
    } catch {
      setState(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startShift = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/shift/start', { opening_float: Number(float || 0) });
      await load();
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const endShift = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/shift/end', {
        counted_cash: counted === '' ? null : Number(counted),
        closing_notes: notes
      });
      await load();
      setOpen(false);
      setCounted('');
      setNotes('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;
  const isOpen = Boolean(state.open);

  return (
    <div className="shift-widget">
      <button
        type="button"
        className={`shift-pill${isOpen ? ' live' : ''}`}
        onClick={() => {
          setOpen((value) => !value);
          setError('');
        }}
      >
        <span className="dot" aria-hidden="true" />
        {isOpen ? `Shift open ${clock(state.shift?.started_at)}` : 'Start shift'}
      </button>
      {open ? (
        <div className="shift-panel">
          {isOpen ? (
            <>
              <div className="shift-panel-head">End shift</div>
              <p className="muted small">
                Opened {clock(state.shift?.started_at)} by {state.shift?.user_name || 'you'}. Count the drawer before
                closing.
              </p>
              <label className="shift-field">
                <span>Counted cash (₦)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={counted}
                  onChange={(event) => setCounted(event.target.value)}
                  placeholder="0.00"
                />
              </label>
              <label className="shift-field">
                <span>Notes</span>
                <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional" />
              </label>
              <button type="button" className="btn danger sm" disabled={busy} onClick={endShift}>
                {busy ? 'Closing…' : 'Close shift'}
              </button>
            </>
          ) : (
            <>
              <div className="shift-panel-head">Start shift</div>
              <p className="muted small">Record the opening float so the cash-up report balances.</p>
              <label className="shift-field">
                <span>Opening float (₦)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={float}
                  onChange={(event) => setFloat(event.target.value)}
                />
              </label>
              <button type="button" className="btn primary sm" disabled={busy} onClick={startShift}>
                {busy ? 'Opening…' : 'Open shift'}
              </button>
            </>
          )}
          {error ? <div className="inline-error">{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [property, setProperty] = useState({});
  const [roles, setRoles] = useState(null);
  const [installReady, setInstallReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const toasts = useToasts();
  const location = useLocation();

  const loadSession = useCallback(async () => {
    try {
      const data = await api.get('/auth/me');
      setUser(data.user);
      setProperty(data.property || {});
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRoles = useCallback(async () => {
    try {
      const data = await api.get('/roles');
      setRoles(data.roles || []);
    } catch {
      setRoles([]);
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (user) loadRoles();
  }, [user, loadRoles]);

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault();
      window.__pchInstallPrompt = event;
      setInstallReady(true);
    };
    const onInstalled = () => {
      window.__pchInstallPrompt = null;
      setInstallReady(false);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (window.__pchInstallPrompt) setInstallReady(true);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const refreshProperty = useCallback(async () => {
    try {
      const data = await api.get('/property');
      setProperty(data.property || {});
    } catch {
      /* keep previous settings */
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* session may already be gone */
    }
    setUser(null);
    setProperty({});
    setRoles(null);
  }, []);

  const can = useCallback(
    (...roleKeys) => {
      if (!user) return false;
      if (user.role === 'admin') return true;
      if (roleKeys.includes(user.role)) return true;
      const mine = (roles || []).find((role) => role.key === user.role);
      return Boolean(mine && roleKeys.includes(mine.base));
    },
    [user, roles]
  );

  const allowed = useCallback(
    (perm) => {
      if (!perm) return true;
      if (!user) return false;
      if (user.role === 'admin') return true;
      if (!roles) return true;
      const mine = roles.find((role) => role.key === user.role);
      if (!mine) return true;
      return (mine.permissions || []).includes(perm);
    },
    [user, roles]
  );

  const install = useCallback(async () => {
    const prompt = window.__pchInstallPrompt;
    if (!prompt) return;
    prompt.prompt();
    try {
      await prompt.userChoice;
    } catch {
      /* dismissed */
    }
    window.__pchInstallPrompt = null;
    setInstallReady(false);
  }, []);

  const currency = property.currency || 'NGN';
  const context = useMemo(
    () => ({
      user,
      property,
      currency,
      roles,
      can,
      allowed,
      logout,
      refresh: refreshProperty,
      refreshProperty,
      reloadRoles: loadRoles,
      toast: toasts.push,
      money: (value) => money(value, currency)
    }),
    [user, property, currency, roles, can, allowed, logout, refreshProperty, loadRoles, toasts.push]
  );

  if (location.pathname === '/book') {
    return <BookingSite />;
  }

  if (loading) {
    return (
      <div className="centered-page">
        <Spinner /> <span style={{ marginLeft: 8 }}>Loading property…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Login
          onSignedIn={(data) => {
            setUser(data.user);
            setProperty(data.property || {});
          }}
        />
        {toasts.view}
      </>
    );
  }

  const [title, subtitle] = TITLES[location.pathname] || ['PCH PMS', 'Hotel property management'];
  const guard = (perm, element) => (allowed(perm) ? element : <Navigate to="/" replace />);

  return (
    <AppContext.Provider value={context}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">PCH</div>
            <div>
              <div className="brand-name">PCH PMS</div>
              <div className="brand-sub">{property.property_name || 'Richgates Apartments'}</div>
            </div>
          </div>
          <nav className="nav-scroll">
            {NAV_GROUPS.map((group) => {
              const items = group.items.filter((item) => allowed(item.perm));
              if (!items.length) return null;
              return (
                <div key={group.label} className="nav-group">
                  <div className="nav-label">{group.label}</div>
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                    >
                      <span className="nav-icon" aria-hidden="true">
                        {item.icon}
                      </span>
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              );
            })}
            <div className="nav-group">
              <div className="nav-label">Guest facing</div>
              <a className="nav-link" href="/book" target="_blank" rel="noreferrer">
                <span className="nav-icon" aria-hidden="true">
                  ↗
                </span>
                Booking website
              </a>
            </div>
          </nav>
          <div className="sidebar-footer">
            <div className="user-chip">
              <span className="avatar">{initials(user.name)}</span>
              <div>
                <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{user.name}</div>
                <div style={{ fontSize: 11 }}>{user.role_name || roleLabel(user.role)}</div>
              </div>
            </div>
            <button type="button" className="btn sm" style={{ width: '100%' }} onClick={logout}>
              Sign out
            </button>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <div>
              <h1>{title}</h1>
              <div className="topbar-sub">{subtitle}</div>
            </div>
            <div className="topbar-actions">
              <ShiftWidget />
              {installReady ? (
                <button type="button" className="btn sm ghost install-btn" onClick={install}>
                  ⬇ Install app
                </button>
              ) : null}
              <span className="badge info">
                {property.check_in_time || '14:00'} → {property.check_out_time || '12:00'}
              </span>
              <span className="badge neutral">{currency}</span>
            </div>
          </header>

          <main className="content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/front-desk" element={guard('front_desk', <FrontDesk />)} />
              <Route path="/reservations" element={guard('reservations', <Reservations />)} />
              <Route path="/guests" element={guard('guests', <Guests />)} />
              <Route path="/calendar" element={guard('calendar', <TapeChart />)} />
              <Route path="/shifts" element={guard('shifts', <Shifts />)} />
              <Route path="/channels" element={guard('channels', <Channels />)} />
              <Route path="/rooms" element={guard('rooms', <Rooms />)} />
              <Route path="/reports" element={guard('reports', <Reports />)} />
              <Route path="/website" element={guard('website', <Website />)} />
              <Route path="/staff" element={guard('staff', <Staff />)} />
              <Route path="/roles" element={guard('roles', <Roles />)} />
              <Route path="/settings" element={guard('settings', <Settings />)} />
              <Route path="/help" element={<Help />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
      {toasts.view}
    </AppContext.Provider>
  );
}
