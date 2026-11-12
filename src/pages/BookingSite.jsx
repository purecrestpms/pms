import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, money } from '../api.js';

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (iso, days) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

function prettyDate(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
}

export default function BookingSite() {
  const [property, setProperty] = useState(null);
  const [roomTypes, setRoomTypes] = useState([]);
  const [loadError, setLoadError] = useState('');

  const [checkIn, setCheckIn] = useState(plusDays(today(), 1));
  const [checkOut, setCheckOut] = useState(plusDays(today(), 3));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);

  const [quote, setQuote] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', country: '', marketing_opt_in: true });
  const [booking, setBooking] = useState(null);
  const [bookingError, setBookingError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [lookupCode, setLookupCode] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupError, setLookupError] = useState('');

  const currency = quote?.currency || property?.currency || 'EUR';
  const accent = property?.accent || '#0f766e';

  useEffect(() => {
    let active = true;
    api
      .get('/public/property')
      .then((data) => {
        if (!active) return;
        setProperty(data.property || null);
        setRoomTypes(data.room_types || []);
      })
      .catch((error) => active && setLoadError(error.message));
    return () => {
      active = false;
    };
  }, []);

  const search = useCallback(
    async (event) => {
      if (event) event.preventDefault();
      setSearchError('');
      setSearching(true);
      setSelected(null);
      setBooking(null);
      try {
        const query = new URLSearchParams({
          check_in: checkIn,
          check_out: checkOut,
          adults: String(adults)
        }).toString();
        const data = await api.get(`/public/availability?${query}`);
        setQuote(data);
      } catch (error) {
        setQuote(null);
        setSearchError(error.message);
      } finally {
        setSearching(false);
      }
    },
    [checkIn, checkOut, adults]
  );

  useEffect(() => {
    search();
  }, [search]);

  const submitBooking = async (event) => {
    event.preventDefault();
    setBookingError('');
    setSubmitting(true);
    try {
      const data = await api.post('/public/bookings', {
        ...form,
        room_type_id: selected.id,
        check_in: checkIn,
        check_out: checkOut,
        adults,
        children
      });
      setBooking(data.reservation);
      setSelected(null);
      search();
    } catch (error) {
      setBookingError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const lookup = async (event) => {
    event.preventDefault();
    setLookupError('');
    setLookupResult(null);
    try {
      const data = await api.get(`/public/bookings/${encodeURIComponent(lookupCode.trim())}`);
      setLookupResult(data.reservation);
    } catch (error) {
      setLookupError(error.message);
    }
  };

  const results = quote?.room_types || [];
  const nights = quote?.nights || 0;

  const heroStyle = useMemo(
    () => ({
      '--site-accent': accent,
      background: `linear-gradient(135deg, ${accent} 0%, #0b1220 100%)`
    }),
    [accent]
  );

  return (
    <div className="site">
      <header className="site-nav">
        <div className="site-brand">
          <span className="site-mark">{property?.name ? property.name.slice(0, 3).toUpperCase() : 'PCH'}</span>
          <div>
            <div className="site-brand-name">{property?.name || 'PCH Hotel'}</div>
            <div className="site-brand-sub">{property?.address || 'Book direct'}</div>
          </div>
        </div>
        <nav className="site-links">
          <a href="#rooms">Rooms</a>
          <a href="#book">Book</a>
          <a href="#find">My booking</a>
          <a className="site-staff-link" href="/">
            Staff sign in
          </a>
        </nav>
      </header>

      <section className="site-hero" style={heroStyle}>
        <div className="site-hero-inner">
          <span className="site-eyebrow">Book direct · best available rate</span>
          <h1>{property?.headline || 'Boutique stays, booked direct'}</h1>
          <p>{property?.tagline || 'Reserve the best room in the house and skip the middleman.'}</p>
          {property?.notice ? <div className="site-notice">{property.notice}</div> : null}
        </div>
      </section>

      {loadError ? <div className="site-error">{loadError}</div> : null}

      <section className="site-search-card" id="book">
        <form className="site-search-grid" onSubmit={search}>
          <label>
            <span>Arrival</span>
            <input type="date" value={checkIn} min={today()} onChange={(event) => setCheckIn(event.target.value)} />
          </label>
          <label>
            <span>Departure</span>
            <input
              type="date"
              value={checkOut}
              min={plusDays(checkIn, 1)}
              onChange={(event) => setCheckOut(event.target.value)}
            />
          </label>
          <label>
            <span>Adults</span>
            <select value={adults} onChange={(event) => setAdults(Number(event.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Children</span>
            <select value={children} onChange={(event) => setChildren(Number(event.target.value))}>
              {[0, 1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="site-cta" disabled={searching}>
            {searching ? 'Checking…' : 'Check availability'}
          </button>
        </form>
        {searchError ? <div className="site-error">{searchError}</div> : null}
        {quote ? (
          <div className="site-quote-line">
            {nights} night{nights === 1 ? '' : 's'} · {prettyDate(quote.check_in)} → {prettyDate(quote.check_out)} ·{' '}
            {quote.adults} adult{quote.adults === 1 ? '' : 's'} · prices in {currency}
          </div>
        ) : null}
      </section>

      {booking ? (
        <section className="site-confirm">
          <h2>Booking confirmed</h2>
          <p>
            Reference <strong className="mono">{booking.code}</strong> · {prettyDate(booking.check_in)} →{' '}
            {prettyDate(booking.check_out)}
          </p>
          <p className="muted">
            {booking.room_type_name || booking.room_type?.name || 'Your room'} · {money(booking.total ?? booking.rate, currency)}{' '}
            total. A confirmation email is on its way to {booking.guest_email || form.email}.
          </p>
          <button type="button" className="site-ghost" onClick={() => window.print()}>
            Print confirmation
          </button>
        </section>
      ) : null}

      <section className="site-rooms" id="rooms">
        <h2>Choose your room</h2>
        {searching && !results.length ? <p className="muted">Looking for the best available rooms…</p> : null}
        {!searching && !results.length ? <p className="muted">Pick your dates to see live availability.</p> : null}
        <div className="site-room-grid">
          {results.map((type) => (
            <article className={`site-room${type.fits ? '' : ' soldout'}`} key={type.id}>
              <div className="site-room-media" style={{ background: `linear-gradient(135deg, ${accent}22, #0f172a12)` }}>
                <span>{type.code || type.name.slice(0, 2).toUpperCase()}</span>
              </div>
              <div className="site-room-body">
                <div className="site-room-head">
                  <h3>{type.name}</h3>
                  <span className={`site-pill${type.available > 0 ? '' : ' out'}`}>
                    {type.available > 0 ? `${type.available} left` : 'Sold out'}
                  </span>
                </div>
                <p className="muted small">{type.description || `Sleeps up to ${type.capacity} guests.`}</p>
                <div className="site-room-facts">
                  <span>Sleeps {type.capacity}</span>
                  <span>{money(type.nightly_rate, currency)} / night</span>
                </div>
                <div className="site-room-foot">
                  <div>
                    <div className="site-room-total">{money(type.total_price, currency)}</div>
                    <div className="muted small">
                      total for {nights} night{nights === 1 ? '' : 's'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="site-cta"
                    disabled={!type.fits}
                    onClick={() => {
                      setSelected(type);
                      setBooking(null);
                      setBookingError('');
                      document.getElementById('guest-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                  >
                    {type.fits ? 'Book now' : 'Not available'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {selected ? (
        <section className="site-form-card" id="guest-details">
          <h2>
            Guest details · {selected.name} · {money(selected.total_price, currency)}
          </h2>
          <form className="site-form" onSubmit={submitBooking}>
            <label>
              <span>First name</span>
              <input
                required
                value={form.first_name}
                onChange={(event) => setForm({ ...form, first_name: event.target.value })}
              />
            </label>
            <label>
              <span>Last name</span>
              <input
                required
                value={form.last_name}
                onChange={(event) => setForm({ ...form, last_name: event.target.value })}
              />
            </label>
            <label>
              <span>Email</span>
              <input
                required
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>
            <label>
              <span>Phone</span>
              <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </label>
            <label>
              <span>Country</span>
              <input value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} />
            </label>
            <label className="site-check">
              <input
                type="checkbox"
                checked={form.marketing_opt_in}
                onChange={(event) => setForm({ ...form, marketing_opt_in: event.target.checked })}
              />
              <span>Email me offers from {property?.name || 'the hotel'}</span>
            </label>
            {bookingError ? <div className="site-error">{bookingError}</div> : null}
            <div className="site-form-actions">
              <button type="submit" className="site-cta" disabled={submitting}>
                {submitting ? 'Confirming…' : 'Confirm booking'}
              </button>
              <button type="button" className="site-ghost" onClick={() => setSelected(null)}>
                Cancel
              </button>
            </div>
            <p className="muted small">
              Rooms are held in the property management system the moment you confirm — no double bookings, no waiting
              for a manual sync.
            </p>
          </form>
        </section>
      ) : null}

      <section className="site-find" id="find">
        <h2>Find my booking</h2>
        <form className="site-find-form" onSubmit={lookup}>
          <input
            placeholder="Booking reference, e.g. PCH-482913"
            value={lookupCode}
            onChange={(event) => setLookupCode(event.target.value)}
          />
          <button type="submit" className="site-ghost">
            Look up
          </button>
        </form>
        {lookupError ? <div className="site-error">{lookupError}</div> : null}
        {lookupResult ? (
          <div className="site-lookup-result">
            <div>
              <strong className="mono">{lookupResult.code}</strong> · {lookupResult.status?.replace('_', ' ')}
            </div>
            <div className="muted small">
              {prettyDate(lookupResult.check_in)} → {prettyDate(lookupResult.check_out)} ·{' '}
              {lookupResult.room_type_name || 'Room'} · {lookupResult.guest_name}
            </div>
          </div>
        ) : null}
      </section>

      <footer className="site-footer">
        <div>
          <strong>{property?.name || 'PCH Hotel'}</strong>
          <div className="muted small">{property?.address}</div>
        </div>
        <div className="muted small">
          {property?.phone} · {property?.email}
          <br />
          Check-in {property?.check_in_time || '15:00'} · Check-out {property?.check_out_time || '11:00'}
        </div>
        <div className="muted small">
          Powered by <strong>PCH PMS</strong> · availability synced live with the front desk
        </div>
      </footer>
    </div>
  );
}
