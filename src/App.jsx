import React, { useCallback, useEffect, useMemo } from 'react';
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
import BookingSite from './pages/BookingSite.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◧', roles: ['admin', 'manager', 'front_desk', 'housekeeping'], end: true },
  { to: '/front-desk', label: 'Front desk', icon: '🛎', roles: ['admin', 'manager', 'front_desk'] },
  { to: '/reservations', label: 'Reservations', icon: '📖', roles: ['admin', 'manager', 'front_desk'] },
  { to: '/guests', label: 'Guest profiles', icon: '👥', roles: ['admin', 'manager', 'front_desk'] },
  { to: '/calendar', label: 'Availability chart', icon: '▦', roles: ['admin', 'manager', 'front_desk', 'housekeeping'] },
  { to: '/shifts', label: 'Shifts & cash-up', icon: '🕒', roles: ['admin', 'manager', 'front_desk'] },
  { to: '/channels', label: 'Channel manager', icon: '⇄', roles: ['admin', 'manager', 'front_desk'] },
  { to: '/rooms', label: 'Rooms & housekeeping', icon: '🛏', roles: ['admin', 'manager', 'front_desk', 'housekeeping'] },
  { to: '/staff', label: 'Staff accounts', icon: '👤', roles: ['admin', 'manager'] },
  { to: '/settings', label: 'Settings', icon: '⚙', roles: ['admin', 'manager', 'front_desk', 'housekeeping'] }
];

const TITLES = {
  '/': ['Front desk dashboard', 'Arrivals, departures and the state of the house today'],
  '/front-desk': ['Front desk', 'Walk-ins, check-in, check-out and guest folios'],
  '/reservations': ['Reservations', 'Every booking with its folio, balance and channel'],
  '/guests': ['Guest profiles', 'Contact details, documents, preferences and stay history'],
  '/calendar': ['Availability calendar', 'Occupancy heat strip, channel blocks and instant booking'],
  '/shifts': ['Shifts & cash-up', 'Open a shift, take payments, count the drawer and print the report'],
  '/channels': ['Channel manager', 'iCal import feeds, export calendars and conflict detection'],
  '/rooms': ['Rooms & housekeeping', 'Inventory, rates and room status board'],
  '/staff': ['Staff accounts', 'Create and manage front desk, housekeeping and admin users'],
  '/settings': ['Settings', 'Property details, your password and the audit trail']
};

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export default function App() {
  const [user, setUser] = React.useState(null);
  const [property, setProperty] = React.useState({});
  const [loading, setLoading] = React.useState(true);
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

  useEffect(() => {
    loadSession();
  }, [loadSession]);

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
  }, []);

  const can = useCallback((...roles) => Boolean(user) && (user.role === 'admin' || roles.includes(user.role)), [user]);

  const currency = property.currency || 'EUR';
  const context = useMemo(
    () => ({
      user,
      property,
      currency,
      can,
      logout,
      refreshProperty,
      toast: toasts.push,
      money: (value) => money(value, currency)
    }),
    [user, property, currency, can, logout, refreshProperty, toasts.push]
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
  const guard = (roles, element) => (can(...roles) ? element : <Navigate to="/" replace />);

  return (
    <AppContext.Provider value={context}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">PCH</div>
            <div>
              <div className="brand-name">PCH PMS</div>
              <div className="brand-sub">{property.property_name || 'Hotel property'}</div>
            </div>
          </div>
          <div className="nav-label">Operations</div>
          {NAV.filter((item) => can(...item.roles)).map((item) => (
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
          <a className="nav-link" href="/book" target="_blank" rel="noreferrer">
            <span className="nav-icon" aria-hidden="true">
              🌐
            </span>
            Booking website
          </a>
          <div className="sidebar-footer">
            <div className="user-chip">
              <span className="avatar">{initials(user.name)}</span>
              <div>
                <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{user.name}</div>
                <div style={{ fontSize: 11 }}>{roleLabel(user.role)}</div>
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
              <span className="badge info">
                {property.check_in_time || '15:00'} → {property.check_out_time || '11:00'}
              </span>
              <span className="badge neutral">{property.currency || 'EUR'}</span>
            </div>
          </header>

          <main className="content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/front-desk" element={guard(['manager', 'front_desk'], <FrontDesk />)} />
              <Route path="/reservations" element={guard(['manager', 'front_desk'], <Reservations />)} />
              <Route path="/guests" element={guard(['manager', 'front_desk'], <Guests />)} />
              <Route path="/calendar" element={<TapeChart />} />
              <Route path="/shifts" element={guard(['manager', 'front_desk'], <Shifts />)} />
              <Route path="/channels" element={guard(['manager', 'front_desk'], <Channels />)} />
              <Route path="/rooms" element={<Rooms />} />
              <Route path="/staff" element={guard(['manager'], <Staff />)} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
      {toasts.view}
    </AppContext.Provider>
  );
}
