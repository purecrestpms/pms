import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, addDays, isoToday } from '../api.js';
import { Banner, Field, Modal, useApp } from './ui.jsx';

const emptyGuest = { first_name: '', last_name: '', email: '', phone: '', country: '' };

export default function ReservationForm({ onClose, onSaved, initial = null }) {
  const { money, toast } = useApp();
  const editing = Boolean(initial?.id);

  const [form, setForm] = useState({
    guest_id: initial?.guest_id || '',
    ...emptyGuest,
    first_name: initial?.first_name || '',
    last_name: initial?.last_name || '',
    email: initial?.guest_email || '',
    phone: initial?.guest_phone || '',
    country: initial?.guest_country || '',
    check_in: initial?.check_in || isoToday(),
    check_out: initial?.check_out || addDays(isoToday(), 1),
    room_type_id: initial?.room_type_id ? String(initial.room_type_id) : '',
    room_id: initial?.room_id ? String(initial.room_id) : '',
    adults: initial?.adults || 1,
    children: initial?.children || 0,
    rate: initial?.rate ?? '',
    channel_id: initial?.channel_id ? String(initial.channel_id) : '1',
    status: initial?.status === 'pending' ? 'pending' : 'confirmed',
    notes: initial?.notes || ''
  });
  const [types, setTypes] = useState([]);
  const [channels, setChannels] = useState([]);
  const [freeRooms, setFreeRooms] = useState([]);
  const [available, setAvailable] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [guestQuery, setGuestQuery] = useState('');
  const [guestResults, setGuestResults] = useState([]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  useEffect(() => {
    (async () => {
      try {
        const [typeData, channelData] = await Promise.all([api.get('/room-types'), api.get('/channels')]);
        setTypes(typeData.room_types || []);
        setChannels(channelData.channels || []);
        setForm((current) => {
          if (current.room_type_id) return current;
          const first = (typeData.room_types || [])[0];
          return first ? { ...current, room_type_id: String(first.id), rate: current.rate === '' ? first.base_rate : current.rate } : current;
        });
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  const loadAvailability = useCallback(async () => {
    if (!form.room_type_id || !form.check_in || !form.check_out || form.check_out <= form.check_in) return;
    try {
      const data = await api.get(
        `/availability?from=${form.check_in}&to=${form.check_out}`
      );
      const match = (data.room_types || []).find((type) => String(type.room_type_id) === String(form.room_type_id));
      setAvailable(match ? match.available : null);
      setFreeRooms(match ? match.free_rooms || [] : []);
    } catch {
      setAvailable(null);
    }
  }, [form.room_type_id, form.check_in, form.check_out]);

  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  useEffect(() => {
    if (!guestQuery.trim()) {
      setGuestResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await api.get(`/guests?q=${encodeURIComponent(guestQuery.trim())}`);
        setGuestResults((data.guests || []).slice(0, 5));
      } catch {
        setGuestResults([]);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [guestQuery]);

  const selectedType = useMemo(
    () => types.find((type) => String(type.id) === String(form.room_type_id)),
    [types, form.room_type_id]
  );

  const nights = useMemo(() => {
    if (!form.check_in || !form.check_out) return 0;
    return Math.max(
      0,
      Math.round((new Date(`${form.check_out}T00:00:00Z`) - new Date(`${form.check_in}T00:00:00Z`)) / 86400000)
    );
  }, [form.check_in, form.check_out]);

  const total = Number(form.rate || 0) * nights;

  const pickGuest = (guest) => {
    setForm((current) => ({
      ...current,
      guest_id: guest.id,
      first_name: guest.first_name,
      last_name: guest.last_name,
      email: guest.email || '',
      phone: guest.phone || '',
      country: guest.country || ''
    }));
    setGuestResults([]);
    setGuestQuery('');
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('Guest first and last name are required');
      return;
    }
    if (form.check_out <= form.check_in) {
      setError('Check-out must be after check-in');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        guest_id: form.guest_id || undefined,
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone: form.phone,
        country: form.country,
        check_in: form.check_in,
        check_out: form.check_out,
        room_type_id: Number(form.room_type_id),
        room_id: form.room_id ? Number(form.room_id) : null,
        adults: Number(form.adults),
        children: Number(form.children),
        rate: form.rate === '' ? undefined : Number(form.rate),
        channel_id: Number(form.channel_id) || 1,
        status: form.status,
        notes: form.notes
      };
      const data = editing
        ? await api.patch(`/reservations/${initial.id}`, payload)
        : await api.post('/reservations', payload);
      toast(editing ? 'Reservation updated' : `Reservation ${data.reservation.code} created`);
      onSaved?.(data.reservation);
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      wide
      title={editing ? `Edit ${initial.code}` : 'New reservation'}
      subtitle={editing ? 'Update stay details, room or rate' : 'Walk-in, phone booking or manual channel entry'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="reservation-form" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create reservation'}
          </button>
        </>
      }
    >
      <form id="reservation-form" className="stack" onSubmit={submit}>
        <Banner kind="error">{error}</Banner>

        <div className="form-grid">
          <Field label="Guest search" hint="Find an existing guest by name, email or phone">
            <input
              value={guestQuery}
              onChange={(event) => setGuestQuery(event.target.value)}
              placeholder="Start typing a guest name"
              autoComplete="off"
            />
          </Field>
          <Field label="Channel">
            <select value={form.channel_id} onChange={set('channel_id')}>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {guestResults.length ? (
          <div className="stack" style={{ gap: 6 }}>
            {guestResults.map((guest) => (
              <button
                key={guest.id}
                type="button"
                className="btn sm"
                style={{ justifyContent: 'flex-start' }}
                onClick={() => pickGuest(guest)}
              >
                {guest.first_name} {guest.last_name}
                <span className="muted">
                  {guest.email || guest.phone || 'no contact'} · {guest.stays} stay(s)
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="form-grid">
          <Field label="First name">
            <input value={form.first_name} onChange={set('first_name')} required />
          </Field>
          <Field label="Last name">
            <input value={form.last_name} onChange={set('last_name')} required />
          </Field>
          <Field label="Email">
            <input type="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Phone">
            <input value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Country">
            <input value={form.country} onChange={set('country')} />
          </Field>
          <Field label="Booking status">
            <select value={form.status} onChange={set('status')}>
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending</option>
            </select>
          </Field>
          <Field label="Check-in">
            <input type="date" value={form.check_in} onChange={set('check_in')} required />
          </Field>
          <Field label="Check-out">
            <input type="date" value={form.check_out} onChange={set('check_out')} required />
          </Field>
          <Field label="Room type">
            <select value={form.room_type_id} onChange={set('room_type_id')} required>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name} · {money(type.base_rate)} / night
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Room"
            hint={
              available === null
                ? 'Availability checked against reservations and channel blocks'
                : `${available} room(s) available for these dates`
            }
          >
            <select value={form.room_id} onChange={set('room_id')}>
              <option value="">Unassigned (assign at check-in)</option>
              {freeRooms.map((room) => (
                <option key={room.id} value={room.id}>
                  Room {room.number} · floor {room.floor}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Adults">
            <input type="number" min="1" max="12" value={form.adults} onChange={set('adults')} />
          </Field>
          <Field label="Children">
            <input type="number" min="0" max="12" value={form.children} onChange={set('children')} />
          </Field>
          <Field
            label="Nightly rate"
            hint={selectedType ? `Standard rate ${money(selectedType.base_rate)}` : undefined}
          >
            <input type="number" min="0" step="0.01" value={form.rate} onChange={set('rate')} />
          </Field>
          <Field label="Stay total" hint={`${nights} night(s)`}>
            <input value={money(total)} readOnly />
          </Field>
          <Field label="Notes" span2>
            <textarea value={form.notes} onChange={set('notes')} placeholder="Special requests, arrival time, allergies…" />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
