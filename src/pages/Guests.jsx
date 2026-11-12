import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dateTime, shortDate } from '../api.js';
import { Banner, Card, Empty, Field, Modal, Spinner, StatusBadge, useApp } from '../components/ui.jsx';

const EMPTY = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  country: '',
  company: '',
  address: '',
  city: '',
  id_type: 'Passport',
  id_number: '',
  birth_date: '',
  preferences: '',
  notes: '',
  vip: false,
  marketing_opt_in: false,
  blacklisted: false
};

function toForm(guest) {
  if (!guest) return { ...EMPTY };
  return {
    first_name: guest.first_name || '',
    last_name: guest.last_name || '',
    email: guest.email || '',
    phone: guest.phone || '',
    country: guest.country || '',
    company: guest.company || '',
    address: guest.address || '',
    city: guest.city || '',
    id_type: guest.id_type || 'Passport',
    id_number: guest.id_number || '',
    birth_date: guest.birth_date || '',
    preferences: guest.preferences || '',
    notes: guest.notes || '',
    vip: Boolean(guest.vip),
    marketing_opt_in: Boolean(guest.marketing_opt_in),
    blacklisted: Boolean(guest.blacklisted)
  };
}

export default function Guests() {
  const { money, toast, can } = useApp();
  const [query, setQuery] = useState('');
  const [guests, setGuests] = useState(null);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async (term) => {
    try {
      const payload = await api.get(`/guests?q=${encodeURIComponent(term || '')}`);
      setGuests(payload.guests || []);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => load(query), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query, load]);

  const openDetail = async (id) => {
    try {
      const payload = await api.get(`/guests/${id}`);
      setDetail(payload);
    } catch (err) {
      setError(err.message);
    }
  };

  const startCreate = () => {
    setForm({ ...EMPTY });
    setFormError('');
    setEditing({});
  };

  const startEdit = (guest) => {
    setForm(toForm(guest));
    setFormError('');
    setEditing(guest);
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const id = editing?.id;
      const payload = id ? await api.patch(`/guests/${id}`, form) : await api.post('/guests', form);
      toast(id ? 'Guest profile updated' : 'Guest profile created');
      setEditing(null);
      await load(query);
      if (id) await openDetail(id);
      else if (payload?.guest?.id) await openDetail(payload.guest.id);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (guest) => {
    if (!window.confirm(`Delete the profile for ${guest.first_name} ${guest.last_name}?`)) return;
    try {
      await api.del(`/guests/${guest.id}`);
      toast('Guest profile deleted');
      setDetail(null);
      await load(query);
    } catch (err) {
      setError(err.message);
    }
  };

  const totals = useMemo(() => {
    const list = guests || [];
    return {
      count: list.length,
      vip: list.filter((guest) => guest.vip).length,
      value: list.reduce((sum, guest) => sum + Number(guest.lifetime_value || 0), 0)
    };
  }, [guests]);

  return (
    <div className="stack">
      <Banner kind="error">{error}</Banner>

      <div className="stat-row">
        <div className="stat-tile">
          <span className="stat-label">Profiles</span>
          <span className="stat-value">{totals.count}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">VIP guests</span>
          <span className="stat-value">{totals.vip}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Recorded revenue</span>
          <span className="stat-value">{money(totals.value)}</span>
        </div>
      </div>

      <Card
        title="Guest profiles"
        subtitle="Contact details, identity documents, preferences and full stay history"
        actions={
          <>
            <input
              placeholder="Search name, email, phone, company or ID"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              style={{ width: 280 }}
            />
            {can('manager', 'front_desk') ? (
              <button type="button" className="btn primary sm" onClick={startCreate}>
                New guest
              </button>
            ) : null}
          </>
        }
        padded={false}
      >
        {guests === null ? (
          <div className="card-body">
            <Spinner />
          </div>
        ) : guests.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Contact</th>
                  <th>Company / country</th>
                  <th style={{ textAlign: 'right' }}>Stays</th>
                  <th style={{ textAlign: 'right' }}>Nights</th>
                  <th style={{ textAlign: 'right' }}>Lifetime value</th>
                  <th>Next stay</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {guests.map((guest) => (
                  <tr key={guest.id} className={guest.blacklisted ? 'row-alert' : ''}>
                    <td>
                      <button type="button" className="link-btn" onClick={() => openDetail(guest.id)}>
                        {guest.vip ? <span className="vip-star" title="VIP">★ </span> : null}
                        {guest.last_name}, {guest.first_name}
                      </button>
                      {guest.blacklisted ? <span className="badge warn">blacklisted</span> : null}
                    </td>
                    <td className="small">
                      {guest.email || '—'}
                      <div className="muted">{guest.phone || ''}</div>
                    </td>
                    <td className="small">
                      {guest.company || '—'}
                      <div className="muted">{guest.country || ''}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{guest.stays}</td>
                    <td style={{ textAlign: 'right' }}>{Math.round(Number(guest.nights_stayed || 0))}</td>
                    <td style={{ textAlign: 'right' }}>{money(guest.lifetime_value)}</td>
                    <td className="small">{guest.next_stay ? shortDate(guest.next_stay) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="btn sm" onClick={() => openDetail(guest.id)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card-body">
            <Empty>No guest profiles match that search.</Empty>
          </div>
        )}
      </Card>

      {detail ? (
        <Modal
          title={`${detail.guest.vip ? '★ ' : ''}${detail.guest.first_name} ${detail.guest.last_name}`}
          subtitle={`${detail.guest.stays} stays · ${Math.round(Number(detail.guest.nights_stayed || 0))} nights · ${money(
            detail.guest.lifetime_value
          )} lifetime value`}
          onClose={() => setDetail(null)}
          wide
          footer={
            <>
              {can('manager', 'front_desk') ? (
                <button type="button" className="btn" onClick={() => startEdit(detail.guest)}>
                  Edit profile
                </button>
              ) : null}
              <button type="button" className="btn" onClick={() => window.print()}>
                Print profile
              </button>
              {can('manager') ? (
                <button type="button" className="btn danger" onClick={() => remove(detail.guest)}>
                  Delete
                </button>
              ) : null}
              <button type="button" className="btn primary" onClick={() => setDetail(null)}>
                Close
              </button>
            </>
          }
        >
          <div className="guest-grid">
            <div>
              <h4>Contact</h4>
              <dl className="kv">
                <dt>Email</dt>
                <dd>{detail.guest.email || '—'}</dd>
                <dt>Phone</dt>
                <dd>{detail.guest.phone || '—'}</dd>
                <dt>Address</dt>
                <dd>
                  {[detail.guest.address, detail.guest.city, detail.guest.country].filter(Boolean).join(', ') || '—'}
                </dd>
                <dt>Company</dt>
                <dd>{detail.guest.company || '—'}</dd>
              </dl>
            </div>
            <div>
              <h4>Identity</h4>
              <dl className="kv">
                <dt>Document</dt>
                <dd>
                  {detail.guest.id_type || '—'} {detail.guest.id_number ? `· ${detail.guest.id_number}` : ''}
                </dd>
                <dt>Date of birth</dt>
                <dd>{detail.guest.birth_date || '—'}</dd>
                <dt>Marketing</dt>
                <dd>{detail.guest.marketing_opt_in ? 'Opted in' : 'Not opted in'}</dd>
                <dt>Created</dt>
                <dd>{dateTime(detail.guest.created_at)}</dd>
              </dl>
            </div>
          </div>

          {detail.guest.preferences ? (
            <div className="note-block">
              <strong>Preferences</strong>
              <p>{detail.guest.preferences}</p>
            </div>
          ) : null}
          {detail.guest.notes ? (
            <div className="note-block">
              <strong>Notes</strong>
              <p>{detail.guest.notes}</p>
            </div>
          ) : null}

          <h4>Stay history</h4>
          {detail.reservations.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Booking</th>
                    <th>Stay</th>
                    <th>Room</th>
                    <th>Channel</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Rate</th>
                    <th>Documents</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.reservations.map((reservation) => (
                    <tr key={reservation.id}>
                      <td className="mono">{reservation.code}</td>
                      <td className="small">
                        {shortDate(reservation.check_in)} → {shortDate(reservation.check_out)}
                      </td>
                      <td>{reservation.room_number || '—'}</td>
                      <td className="small">{reservation.channel_name || 'Direct'}</td>
                      <td>
                        <StatusBadge status={reservation.status} />
                      </td>
                      <td style={{ textAlign: 'right' }}>{money(reservation.rate)}</td>
                      <td className="small">
                        <a href={`/api/reservations/${reservation.id}/registration.pdf`} target="_blank" rel="noreferrer">
                          Registration
                        </a>
                        {' · '}
                        <a href={`/api/reservations/${reservation.id}/folio.pdf`} target="_blank" rel="noreferrer">
                          Folio
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No stays recorded for this guest yet.</Empty>
          )}
        </Modal>
      ) : null}

      {editing ? (
        <Modal
          title={editing.id ? 'Edit guest profile' : 'New guest profile'}
          subtitle="Everything here is searchable from the front desk and the reservations screen"
          onClose={() => setEditing(null)}
          wide
          footer={
            <>
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" form="guest-form" className="btn primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save profile'}
              </button>
            </>
          }
        >
          <form id="guest-form" className="form-grid" onSubmit={save}>
            <Banner kind="error">{formError}</Banner>
            <Field label="First name">
              <input
                required
                value={form.first_name}
                onChange={(event) => setForm({ ...form, first_name: event.target.value })}
              />
            </Field>
            <Field label="Last name">
              <input
                required
                value={form.last_name}
                onChange={(event) => setForm({ ...form, last_name: event.target.value })}
              />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </Field>
            <Field label="Phone">
              <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </Field>
            <Field label="Company">
              <input value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} />
            </Field>
            <Field label="Country">
              <input value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} />
            </Field>
            <Field label="Address">
              <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
            </Field>
            <Field label="City">
              <input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
            </Field>
            <Field label="ID type">
              <select value={form.id_type} onChange={(event) => setForm({ ...form, id_type: event.target.value })}>
                {['Passport', 'National ID', 'Driving licence', 'Other'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ID number">
              <input value={form.id_number} onChange={(event) => setForm({ ...form, id_number: event.target.value })} />
            </Field>
            <Field label="Date of birth">
              <input
                type="date"
                value={form.birth_date}
                onChange={(event) => setForm({ ...form, birth_date: event.target.value })}
              />
            </Field>
            <Field label="Preferences" span2>
              <input
                value={form.preferences}
                onChange={(event) => setForm({ ...form, preferences: event.target.value })}
                placeholder="High floor, extra pillows, late checkout…"
              />
            </Field>
            <Field label="Internal notes" span2>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </Field>
            <label className="check-row">
              <input type="checkbox" checked={form.vip} onChange={(event) => setForm({ ...form, vip: event.target.checked })} />
              <span>VIP guest</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.marketing_opt_in}
                onChange={(event) => setForm({ ...form, marketing_opt_in: event.target.checked })}
              />
              <span>Marketing opt-in</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.blacklisted}
                onChange={(event) => setForm({ ...form, blacklisted: event.target.checked })}
              />
              <span>Blacklisted (warn at booking)</span>
            </label>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
