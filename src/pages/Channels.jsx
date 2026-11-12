import React, { useCallback, useEffect, useState } from 'react';
import { api, addDays, dateTime, isoToday, shortDate } from '../api.js';
import { Banner, Card, Empty, Field, Modal, Spinner, useApp } from '../components/ui.jsx';

export default function Channels() {
  const { toast, can } = useApp();
  const [channels, setChannels] = useState([]);
  const [feeds, setFeeds] = useState([]);
  const [exportData, setExportData] = useState({ rooms: [], feeds: [] });
  const [blocks, setBlocks] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [syncReport, setSyncReport] = useState(null);
  const [showChannel, setShowChannel] = useState(false);
  const [showFeed, setShowFeed] = useState(null);
  const [showBlock, setShowBlock] = useState(false);

  const manage = can('admin', 'manager');

  const load = useCallback(async () => {
    try {
      const [channelData, feedData, exportRes, blockData, roomData, typeData] = await Promise.all([
        api.get('/channels'),
        api.get('/channels/feeds'),
        api.get('/channels/export'),
        api.get(`/channels/blocks?from=${isoToday()}&to=${addDays(isoToday(), 30)}`),
        api.get('/rooms'),
        api.get('/room-types')
      ]);
      setChannels(channelData.channels);
      setFeeds(feedData.feeds);
      setExportData(exportRes);
      setBlocks(blockData.blocks);
      setRooms(roomData.rooms);
      setRoomTypes(typeData.room_types);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const syncOne = async (feed) => {
    setBusy(`feed-${feed.id}`);
    try {
      const { result } = await api.post(`/channels/feeds/${feed.id}/sync`);
      setSyncReport({ results: [result], conflicts: result.conflicts || [], synced: 1 });
      toast(result.error ? result.error : result.message || 'Feed synced', result.error ? 'error' : 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const syncAll = async () => {
    setBusy('all');
    try {
      const report = await api.post('/channels/sync');
      setSyncReport(report);
      toast(`${report.synced} feed(s) synced · ${report.conflicts} conflict(s)`);
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Calendar URL copied');
    } catch {
      toast('Copy failed — select the URL manually', 'error');
    }
  };

  const toggleFeed = async (feed) => {
    try {
      await api.patch(`/channels/feeds/${feed.id}`, { active: !feed.active });
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const removeFeed = async (feed) => {
    if (!window.confirm(`Remove feed "${feed.name}" and its imported blocks?`)) return;
    try {
      await api.del(`/channels/feeds/${feed.id}`);
      toast('Feed removed');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const removeBlock = async (block) => {
    try {
      await api.del(`/channels/blocks/${block.id}`);
      toast('Block removed');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (loading) return <Spinner />;

  return (
    <>
      <Banner kind="error">{error}</Banner>

      <Card
        title="Channel manager"
        subtitle="Two-way iCal sync: export room availability to OTAs, import their bookings as blocks"
        actions={
          <>
            <button type="button" className="btn primary sm" disabled={busy === 'all'} onClick={syncAll}>
              {busy === 'all' ? 'Syncing…' : 'Sync all feeds'}
            </button>
            {manage ? (
              <button type="button" className="btn sm" onClick={() => setShowChannel(true)}>
                + Channel
              </button>
            ) : null}
          </>
        }
      >
        <div className="grid three">
          {channels.map((channel) => (
            <div className="mini-card" key={channel.id}>
              <div className="mini-head">
                <span className="dot" style={{ background: channel.color }} />
                <strong>{channel.name}</strong>
                <span className={`badge ${channel.active ? 'ok' : 'muted'}`}>{channel.active ? 'Connected' : 'Paused'}</span>
              </div>
              <div className="small muted">
                {channel.kind.toUpperCase()} · commission {Number(channel.commission).toFixed(1)}%
              </div>
              <div className="small">
                {channel.feeds} feed(s) · {channel.active_reservations} active booking(s)
              </div>
              {manage ? (
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn sm"
                    onClick={async () => {
                      await api.patch(`/channels/${channel.id}`, { active: !channel.active });
                      load();
                    }}
                  >
                    {channel.active ? 'Pause' : 'Activate'}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Import feeds"
        subtitle="Paste the iCal export URL from each OTA. Bookings are blocked on the mapped rooms."
        padded={false}
        actions={
          manage ? (
            <button type="button" className="btn primary sm" onClick={() => setShowFeed({})}>
              + Add feed
            </button>
          ) : null
        }
      >
        {syncReport ? (
          <div className="card-body" style={{ paddingBottom: 0 }}>
            <Banner kind={syncReport.conflicts ? 'warn' : 'ok'}>
              Synced {syncReport.synced} feed(s).
              {syncReport.conflicts
                ? ` ${syncReport.conflicts} imported date range(s) clash with an existing reservation — see the results below.`
                : ' No conflicts detected.'}
              <ul className="report">
                {(syncReport.results || []).map((result, index) => (
                  <li key={index}>
                    <strong>{result.feed || result.name || `Feed ${index + 1}`}</strong>: {result.error || result.message}
                  </li>
                ))}
              </ul>
            </Banner>
          </div>
        ) : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Feed</th>
                <th>Channel</th>
                <th>Applies to</th>
                <th>Last sync</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {feeds.length ? (
                feeds.map((feed) => (
                  <tr key={feed.id}>
                    <td>
                      <span className="row-strong">{feed.name}</span>
                      <div className="small muted mono truncate" title={feed.url}>
                        {feed.url}
                      </div>
                    </td>
                    <td>
                      <span className="dot" style={{ background: feed.channel_color }} /> {feed.channel_name}
                    </td>
                    <td>{feed.scope}</td>
                    <td>{feed.last_synced_at ? dateTime(feed.last_synced_at) : 'Never'}</td>
                    <td>
                      <span className={`badge ${feed.active ? 'ok' : 'muted'}`}>{feed.active ? 'Active' : 'Paused'}</span>
                      {feed.last_status ? (
                        <div className="small muted" title={feed.last_message || ''}>
                          {feed.last_status}
                        </div>
                      ) : null}
                    </td>
                    <td className="actions">
                      <button type="button" className="btn sm" disabled={busy === `feed-${feed.id}`} onClick={() => syncOne(feed)}>
                        {busy === `feed-${feed.id}` ? '…' : 'Sync'}
                      </button>
                      {manage ? (
                        <>
                          {' '}
                          <button type="button" className="btn sm" onClick={() => setShowFeed(feed)}>
                            Edit
                          </button>{' '}
                          <button type="button" className="btn sm" onClick={() => toggleFeed(feed)}>
                            {feed.active ? 'Pause' : 'Resume'}
                          </button>{' '}
                          <button type="button" className="btn sm danger" onClick={() => removeFeed(feed)}>
                            Delete
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6">
                    <Empty>No import feeds yet — add your first OTA iCal URL</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Export calendars"
        subtitle="Give these URLs to your OTAs so their availability stays in sync with this PMS"
        padded={false}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Room</th>
                <th>Type</th>
                <th>iCal URL</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {exportData.rooms.map((room) => (
                <tr key={room.id}>
                  <td className="row-strong">{room.number}</td>
                  <td>{room.room_type_name}</td>
                  <td>
                    <code className="mono small truncate" title={room.url}>
                      {room.url}
                    </code>
                  </td>
                  <td className="actions">
                    <button type="button" className="btn sm" onClick={() => copy(room.url)}>
                      Copy
                    </button>{' '}
                    <a className="btn sm" href={room.url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                    {manage ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="btn sm"
                          onClick={async () => {
                            if (!window.confirm(`Rotate the link for room ${room.number}? OTAs will need the new URL.`)) return;
                            await api.post(`/rooms/${room.id}/rotate-ical`);
                            toast('Calendar link rotated');
                            load();
                          }}
                        >
                          Rotate
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Blocked dates"
        subtitle="Imported channel blocks and manual closures for the next 30 days"
        padded={false}
        actions={
          <button type="button" className="btn sm" onClick={() => setShowBlock(true)}>
            + Block dates
          </button>
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Room</th>
                <th>Dates</th>
                <th>Reason</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {blocks.length ? (
                blocks.map((block) => (
                  <tr key={block.id}>
                    <td className="row-strong">{block.room_number}</td>
                    <td>
                      {shortDate(block.start_date)} → {shortDate(block.end_date)}
                    </td>
                    <td>{block.summary || '—'}</td>
                    <td>
                      <span className={`badge ${block.source === 'ical' ? 'warn' : 'muted'}`}>
                        {block.source === 'ical' ? `iCal · ${block.channel_name || 'channel'}` : 'Manual'}
                      </span>
                    </td>
                    <td className="actions">
                      {block.source === 'ical' ? (
                        <span className="small muted">Managed by feed</span>
                      ) : (
                        <button type="button" className="btn sm danger" onClick={() => removeBlock(block)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5">
                    <Empty>No blocked dates in the next 30 days</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {showChannel ? (
        <ChannelForm
          onClose={() => setShowChannel(false)}
          onSaved={() => {
            setShowChannel(false);
            load();
          }}
        />
      ) : null}

      {showFeed ? (
        <FeedForm
          feed={showFeed.id ? showFeed : null}
          channels={channels}
          rooms={rooms}
          roomTypes={roomTypes}
          onClose={() => setShowFeed(null)}
          onSaved={() => {
            setShowFeed(null);
            load();
          }}
        />
      ) : null}

      {showBlock ? (
        <BlockForm
          rooms={rooms}
          onClose={() => setShowBlock(false)}
          onSaved={() => {
            setShowBlock(false);
            load();
          }}
        />
      ) : null}
    </>
  );
}

function ChannelForm({ onClose, onSaved }) {
  const { toast } = useApp();
  const [form, setForm] = useState({ name: '', kind: 'ota', color: '#2563eb', commission: 15 });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post('/channels', form);
      toast('Channel added');
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title="New channel"
      subtitle="Connect an OTA or booking site"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="channel-form" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : 'Add channel'}
          </button>
        </>
      }
    >
      <form id="channel-form" onSubmit={submit}>
        <Banner kind="error">{error}</Banner>
        <Field label="Channel name">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </Field>
        <div className="grid two">
          <Field label="Type">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="ota">OTA</option>
              <option value="booking_engine">Booking engine</option>
              <option value="direct">Direct</option>
            </select>
          </Field>
          <Field label="Commission %">
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={form.commission}
              onChange={(e) => setForm({ ...form, commission: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Colour">
          <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}

function FeedForm({ feed, channels, rooms, roomTypes, onClose, onSaved }) {
  const { toast } = useApp();
  const [form, setForm] = useState({
    name: feed?.name || '',
    channel_id: feed?.channel_id || (channels[0] ? channels[0].id : ''),
    url: feed?.url || '',
    scope: feed?.room_id ? 'room' : 'room_type',
    room_id: feed?.room_id || '',
    room_type_id: feed?.room_type_id || (roomTypes[0] ? roomTypes[0].id : '')
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    const payload = {
      name: form.name,
      channel_id: Number(form.channel_id),
      url: form.url,
      room_id: form.scope === 'room' ? Number(form.room_id) : null,
      room_type_id: form.scope === 'room_type' ? Number(form.room_type_id) : null
    };
    try {
      if (feed) {
        await api.patch(`/channels/feeds/${feed.id}`, { name: payload.name, url: payload.url });
      } else {
        await api.post('/channels/feeds', payload);
      }
      toast(feed ? 'Feed updated' : 'Feed added — sync it to import blocks');
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={feed ? `Edit ${feed.name}` : 'Add iCal import feed'}
      subtitle="In Booking.com, Airbnb or Expedia copy the “export calendar” link and paste it here"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="feed-form" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : feed ? 'Save feed' : 'Add feed'}
          </button>
        </>
      }
    >
      <form id="feed-form" onSubmit={submit}>
        <Banner kind="error">{error}</Banner>
        <Field label="Feed name">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </Field>
        <Field label="Channel">
          <select value={form.channel_id} onChange={(e) => setForm({ ...form, channel_id: e.target.value })}>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="iCal URL" hint="https://…/calendar.ics">
          <input
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="https://example.com/ical/room.ics"
            required
          />
        </Field>
        {feed ? null : (
          <>
            <Field label="Applies to">
              <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                <option value="room_type">All rooms of a type</option>
                <option value="room">A single room</option>
              </select>
            </Field>
            {form.scope === 'room_type' ? (
              <Field label="Room type">
                <select value={form.room_type_id} onChange={(e) => setForm({ ...form, room_type_id: e.target.value })}>
                  {roomTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Room">
                <select value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })}>
                  <option value="">Choose a room…</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.number} · {room.room_type_name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </>
        )}
      </form>
    </Modal>
  );
}

function BlockForm({ rooms, onClose, onSaved }) {
  const { toast } = useApp();
  const [form, setForm] = useState({
    room_id: rooms[0] ? rooms[0].id : '',
    start_date: isoToday(),
    end_date: addDays(isoToday(), 1),
    summary: 'Maintenance'
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post('/channels/blocks', { ...form, room_id: Number(form.room_id) });
      toast('Dates blocked');
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Block dates"
      subtitle="Stop selling a room (maintenance, out of order, owner use)"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="block-form" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : 'Block dates'}
          </button>
        </>
      }
    >
      <form id="block-form" onSubmit={submit}>
        <Banner kind="error">{error}</Banner>
        <Field label="Room">
          <select value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })}>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.number} · {room.room_type_name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid two">
          <Field label="From">
            <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required />
          </Field>
          <Field label="Until (checkout)">
            <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} required />
          </Field>
        </div>
        <Field label="Reason">
          <input value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}
