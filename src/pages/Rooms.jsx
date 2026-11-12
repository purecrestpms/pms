import React, { useCallback, useEffect, useState } from 'react';
import { api, money, shortDate, STATUS_LABELS } from '../api.js';
import { Banner, Card, Empty, Field, Modal, Spinner, StatusBadge, useApp } from '../components/ui.jsx';

const ROOM_STATUSES = ['clean', 'dirty', 'inspected', 'out_of_order'];

export default function Rooms() {
  const { toast, can } = useApp();
  const manage = can('admin', 'manager');
  const [rooms, setRooms] = useState(null);
  const [types, setTypes] = useState([]);
  const [error, setError] = useState('');
  const [showRoom, setShowRoom] = useState(false);
  const [showType, setShowType] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [roomData, typeData] = await Promise.all([api.get('/rooms'), api.get('/room-types')]);
      setRooms(roomData.rooms);
      setTypes(typeData.room_types);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (room, status) => {
    setBusy(`room-${room.id}`);
    try {
      await api.patch(`/rooms/${room.id}/status`, { status });
      toast(`Room ${room.number} → ${STATUS_LABELS[status]}`);
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const counts = (rooms || []).reduce((acc, room) => {
    acc[room.status] = (acc[room.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <Banner kind="error">{error}</Banner>

      <Card
        title="Housekeeping board"
        subtitle="Mark rooms clean, dirty, inspected or out of order — every change is logged"
        actions={
          manage ? (
            <button type="button" className="btn primary sm" onClick={() => setShowRoom(true)}>
              + New room
            </button>
          ) : null
        }
      >
        <div className="grid four">
          {ROOM_STATUSES.map((status) => (
            <div className="mini-card" key={status}>
              <div className="small muted">{STATUS_LABELS[status]}</div>
              <div className="stat-value">{counts[status] || 0}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Rooms" subtitle={`${rooms ? rooms.length : 0} room(s) in the property`} padded={false}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Room</th>
                <th>Type</th>
                <th>Floor</th>
                <th>Housekeeping</th>
                <th>Current guest</th>
                <th>Next arrival</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rooms === null ? (
                <tr>
                  <td colSpan="7">
                    <Spinner />
                  </td>
                </tr>
              ) : rooms.length ? (
                rooms.map((room) => (
                  <tr key={room.id}>
                    <td>
                      <span className="row-strong">{room.number}</span>
                      {!room.active ? <span className="badge muted" style={{ marginLeft: 8 }}>inactive</span> : null}
                    </td>
                    <td>
                      {room.room_type_name}
                      <div className="small muted">
                        {room.capacity} guest(s) · {money(room.base_rate)}
                      </div>
                    </td>                    <td>{room.floor}</td>
                    <td>
                      <select
                        value={room.status}
                        disabled={busy === `room-${room.id}`}
                        onChange={(event) => setStatus(room, event.target.value)}
                        style={{ maxWidth: 160 }}
                      >
                        {ROOM_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {room.current_guest ? (
                        <>
                          <span className="row-strong">{room.current_guest}</span>
                          <div className="small muted">until {shortDate(room.current_check_out)}</div>
                        </>
                      ) : (
                        <span className="small muted">—</span>
                      )}
                    </td>
                    <td className="small">{room.next_arrival ? shortDate(room.next_arrival) : '—'}</td>
                    <td className="actions">
                      <StatusBadge status={room.status} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7">
                    <Empty>No rooms yet</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Room types & rates"
        subtitle="Base nightly rate and tonight's availability per type"
        actions={
          manage ? (
            <button type="button" className="btn sm" onClick={() => setShowType({})}>
              + New type
            </button>
          ) : null
        }
      >
        <div className="grid three">
          {types.map((type) => (
            <div className="mini-card room-type-card" key={type.id}>
              {type.image_url ? (
                <img className="room-type-image" src={type.image_url} alt={`${type.name} at Richgates Apartments`} loading="lazy" />
              ) : null}
              <div className="mini-head">
                <strong>{type.name}</strong>
                <span className="badge ok">{type.available_tonight} free</span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span className={`badge ${type.section === 'serviced' ? 'info' : 'neutral'}`}>
                  {type.section === 'serviced' ? 'Serviced apartment' : 'Hotel room'}
                </span>
                {type.size_sqm ? <span className="small muted">{type.size_sqm} m²</span> : null}
              </div>
              <div className="small muted">{type.description || '—'}</div>
              <div className="small">
                {type.rooms_total} room(s) · sleeps {type.capacity} · {money(type.base_rate)} / night
              </div>
              {manage ? (
                <div className="row-actions">
                  <button type="button" className="btn sm" onClick={() => setShowType(type)}>
                    Edit
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      {showRoom ? (
        <RoomForm
          types={types}
          onClose={() => setShowRoom(false)}
          onSaved={() => {
            setShowRoom(false);
            load();
          }}
        />
      ) : null}
      {showType ? (
        <TypeForm
          type={showType.id ? showType : null}
          onClose={() => setShowType(null)}
          onSaved={() => {
            setShowType(null);
            load();
          }}
        />
      ) : null}
    </>
  );
}

function RoomForm({ types, onClose, onSaved }) {
  const { toast } = useApp();
  const [form, setForm] = useState({
    number: '',
    room_type_id: types[0] ? types[0].id : '',
    floor: 1,
    status: 'clean'
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post('/rooms', { ...form, room_type_id: Number(form.room_type_id), floor: Number(form.floor) });
      toast('Room added');
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title="New room"
      subtitle="Add a bookable unit to the property"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="room-form" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : 'Add room'}
          </button>
        </>
      }
    >
      <form id="room-form" onSubmit={submit}>
        <Banner kind="error">{error}</Banner>
        <div className="grid two">
          <Field label="Room number">
            <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} required />
          </Field>
          <Field label="Floor">
            <input
              type="number"
              min="0"
              value={form.floor}
              onChange={(e) => setForm({ ...form, floor: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Room type">
          <select value={form.room_type_id} onChange={(e) => setForm({ ...form, room_type_id: e.target.value })}>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Housekeeping status">
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {ROOM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </Field>
      </form>
    </Modal>
  );
}

function TypeForm({ type, onClose, onSaved }) {
  const { toast } = useApp();
  const [form, setForm] = useState({
    name: type?.name || '',
    code: type?.code || '',
    capacity: type?.capacity || 2,
    base_rate: type?.base_rate ?? 95000,
    description: type?.description || '',
    section: type?.section || 'hotel',
    bed: type?.bed || '',
    size_sqm: type?.size_sqm || '',
    amenities: type?.amenities || '',
    image_url: type?.image_url || ''
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        code: form.code,
        capacity: Number(form.capacity),
        base_rate: Number(form.base_rate),
        description: form.description,
        section: form.section,
        bed: form.bed,
        size_sqm: form.size_sqm === '' ? null : Number(form.size_sqm),
        amenities: form.amenities,
        image_url: form.image_url
      };
      if (type) await api.patch(`/room-types/${type.id}`, payload);
      else await api.post('/room-types', payload);
      toast(type ? 'Room type updated' : 'Room type created');
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={type ? `Edit ${type.name}` : 'New room type'}
      subtitle="Rates are per night in the property currency"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="type-form" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="type-form" onSubmit={submit}>
        <Banner kind="error">{error}</Banner>
        <div className="grid two">
          <Field label="Name">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Code">
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="DLX" />
          </Field>
          <Field label="Capacity">
            <input
              type="number"
              min="1"
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            />
          </Field>
          <Field label="Base rate / night">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.base_rate}
              onChange={(e) => setForm({ ...form, base_rate: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            rows="3"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <div className="grid two">
          <Field label="Section" hint="Serviced apartments show first on the website">
            <select value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })}>
              <option value="serviced">Serviced apartment</option>
              <option value="hotel">Hotel room</option>
            </select>
          </Field>
          <Field label="Bed">
            <input value={form.bed} onChange={(e) => setForm({ ...form, bed: e.target.value })} placeholder="Queen bed" />
          </Field>
          <Field label="Size (m²)">
            <input
              type="number"
              min="0"
              value={form.size_sqm}
              onChange={(e) => setForm({ ...form, size_sqm: e.target.value })}
            />
          </Field>
          <Field label="Photo URL" hint="e.g. /rooms/deluxe-studio.svg">
            <input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} />
          </Field>
        </div>
        <Field label="Amenities" hint="Comma separated, shown on the booking website">
          <textarea rows="2" value={form.amenities} onChange={(e) => setForm({ ...form, amenities: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}
