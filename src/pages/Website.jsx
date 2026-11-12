import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, money } from '../api.js';

const TABS = [
  { key: 'copy', label: 'Brand & copy', hint: 'Names, headline and the notice bar' },
  { key: 'images', label: 'Images', hint: 'Hero banner and photo gallery' },
  { key: 'rooms', label: 'Rooms & amenities', hint: 'Photos, amenities and descriptions' },
  { key: 'domain', label: 'Domain & payments', hint: 'Own web address and card deposits' }
];

async function uploadImage(file, kind) {
  const response = await fetch('/api/media', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': file.type, 'X-Filename': file.name, 'X-Kind': kind },
    body: file
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!response.ok) throw new Error(data.error || 'Upload failed');
  return data.media;
}

function Uploader({ label, kind, onUploaded, busyText = 'Uploading…' }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const media = await uploadImage(file, kind);
      onUploaded(media);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="uploader">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml" onChange={pick} hidden />
      <button type="button" className="btn" disabled={busy} onClick={() => input.current && input.current.click()}>
        {busy ? busyText : label}
      </button>
      {error ? <div className="inline-error">{error}</div> : null}
    </div>
  );
}

export default function Website() {
  const [tab, setTab] = useState('copy');
  const [site, setSite] = useState(null);
  const [roomTypes, setRoomTypes] = useState([]);
  const [media, setMedia] = useState([]);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busyType, setBusyType] = useState(null);

  const load = useCallback(async () => {
    try {
      const [siteData, types, library] = await Promise.all([
        api.get('/site'),
        api.get('/room-types'),
        api.get('/media').catch(() => ({ media: [] }))
      ]);
      setSite(siteData.site);
      setForm({
        brand_name: siteData.site.brand_name || 'PCH PMS',
        site_headline: siteData.site.site_headline || '',
        site_tagline: siteData.site.site_tagline || '',
        site_about: siteData.site.site_about || '',
        site_notice: siteData.site.site_notice || '',
        site_accent: siteData.site.site_accent || '#0f766e',
        site_hero_image: siteData.site.site_hero_image || '/hero.svg',
        site_facilities: (siteData.site.facilities || []).join('|'),
        site_whatsapp: siteData.site.site_whatsapp || '',
        site_map_url: siteData.site.site_map_url || '',
        site_domain: siteData.site.site_domain || '',
        site_domain_note: siteData.site.site_domain_note || '',
        payment_card_enabled: siteData.site.payment_card_enabled,
        payment_deposit_percent: siteData.site.payment_deposit_percent
      });
      setRoomTypes(types.room_types || types || []);
      setMedia(library.media || []);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch, message = 'Website updated — changes are live on /book') => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const data = await api.put('/site', patch);
      setSite(data.site);
      setNotice(message);
      return true;
    } catch (saveError) {
      setError(saveError.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const gallery = (site && site.gallery) || [];

  const addGalleryImage = async (mediaItem) => {
    const next = [...gallery, { url: mediaItem.url, caption: '' }];
    const ok = await save({ site_gallery: next }, 'Photo added to the public gallery');
    if (ok) setMedia((current) => [mediaItem, ...current]);
  };

  const updateRoomType = async (type, patch) => {
    setBusyType(type.id);
    setError('');
    setNotice('');
    try {
      await api.patch(`/room-types/${type.id}`, patch);
      setNotice(`${type.name} updated — the booking site shows the new details`);
      const types = await api.get('/room-types');
      setRoomTypes(types.room_types || types || []);
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setBusyType(null);
    }
  };

  if (!site) {
    return (
      <div className="page">
        {error ? <div className="inline-error">{error}</div> : <p className="muted">Loading website settings…</p>}
      </div>
    );
  }

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h2 className="page-title">Booking website</h2>
          <p className="muted small">
            Edit the public site at <a href="/book" target="_blank" rel="noreferrer">/book</a> — every change publishes
            instantly. PCH PMS licenses this engine to each property you onboard.
          </p>
        </div>
        <div className="page-head-actions">
          <a className="btn ghost" href="/book" target="_blank" rel="noreferrer">
            Open website
          </a>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`tab${tab === item.key ? ' active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            <strong>{item.label}</strong>
            <span>{item.hint}</span>
          </button>
        ))}
      </div>

      {notice ? <div className="inline-ok">{notice}</div> : null}
      {error ? <div className="inline-error">{error}</div> : null}

      {tab === 'copy' ? (
        <div className="split-grid">
          <section className="card">
            <h3>Identity</h3>
            <div className="form-grid">
              <label>
                <span>Software brand</span>
                <input value={form.brand_name} onChange={(event) => setForm({ ...form, brand_name: event.target.value })} />
                <em>Shown as “Powered by …” on the guest site.</em>
              </label>
              <label>
                <span>Accent colour</span>
                <input
                  type="color"
                  value={form.site_accent}
                  onChange={(event) => setForm({ ...form, site_accent: event.target.value })}
                />
              </label>
              <label className="span-2">
                <span>Hero headline</span>
                <input
                  value={form.site_headline}
                  onChange={(event) => setForm({ ...form, site_headline: event.target.value })}
                />
              </label>
              <label className="span-2">
                <span>Hero sub-text</span>
                <input value={form.site_tagline} onChange={(event) => setForm({ ...form, site_tagline: event.target.value })} />
              </label>
              <label className="span-2">
                <span>About the property</span>
                <textarea
                  rows={4}
                  value={form.site_about}
                  onChange={(event) => setForm({ ...form, site_about: event.target.value })}
                />
              </label>
              <label className="span-2">
                <span>Notice bar</span>
                <input value={form.site_notice} onChange={(event) => setForm({ ...form, site_notice: event.target.value })} />
              </label>
              <label>
                <span>WhatsApp number</span>
                <input
                  placeholder="+234 801 234 5678"
                  value={form.site_whatsapp}
                  onChange={(event) => setForm({ ...form, site_whatsapp: event.target.value })}
                />
              </label>
              <label>
                <span>Map link</span>
                <input
                  placeholder="https://maps.google.com/…"
                  value={form.site_map_url}
                  onChange={(event) => setForm({ ...form, site_map_url: event.target.value })}
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn primary"
                disabled={saving}
                onClick={() => save({ ...form })}
              >
                {saving ? 'Saving…' : 'Publish changes'}
              </button>
            </div>
          </section>

          <section className="card">
            <h3>Property facilities</h3>
            <p className="muted small">One per line — these appear as chips on the website.</p>
            <textarea
              rows={9}
              value={form.site_facilities.split('|').join('\n')}
              onChange={(event) => setForm({ ...form, site_facilities: event.target.value.split('\n').join('|') })}
            />
            <div className="chip-preview">
              {form.site_facilities
                .split('|')
                .map((item) => item.trim())
                .filter(Boolean)
                .map((item) => (
                  <span className="chip" key={item}>
                    {item}
                  </span>
                ))}
            </div>
            <div className="form-actions">
              <button type="button" className="btn primary" disabled={saving} onClick={() => save({ site_facilities: form.site_facilities })}>
                {saving ? 'Saving…' : 'Save facilities'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'images' ? (
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h3>Hero banner</h3>
              <Uploader
                label="Upload hero image"
                kind="hero"
                onUploaded={(item) => {
                  setForm({ ...form, site_hero_image: item.url });
                  save({ site_hero_image: item.url }, 'Hero image updated');
                }}
              />
            </div>
            <div className="hero-preview" style={{ backgroundImage: `url('${form.site_hero_image || '/hero.svg'}')` }}>
              <div>
                <strong>{form.site_headline || 'Your headline'}</strong>
                <span>{form.site_tagline}</span>
              </div>
            </div>
            <div className="form-grid">
              <label className="span-2">
                <span>Or paste an image URL</span>
                <input
                  value={form.site_hero_image}
                  onChange={(event) => setForm({ ...form, site_hero_image: event.target.value })}
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => save({ site_hero_image: form.site_hero_image }, 'Hero image updated')}
              >
                Save hero image
              </button>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Photo gallery</h3>
              <Uploader label="Upload gallery photo" kind="gallery" onUploaded={addGalleryImage} />
            </div>
            {!gallery.length ? <p className="muted small">No gallery photos yet. Upload a few to showcase the property.</p> : null}
            <div className="media-grid">
              {gallery.map((item, index) => (
                <figure className="media-tile" key={`${item.url}-${index}`}>
                  <img src={item.url} alt={item.caption || `Gallery photo ${index + 1}`} loading="lazy" />
                  <input
                    placeholder="Caption"
                    value={item.caption || ''}
                    onChange={(event) => {
                      const next = gallery.map((photo, position) =>
                        position === index ? { ...photo, caption: event.target.value } : photo
                      );
                      setSite({ ...site, gallery: next });
                    }}
                  />
                  <div className="media-actions">
                    <button
                      type="button"
                      className="btn sm"
                      disabled={saving}
                      onClick={() => save({ site_gallery: gallery }, 'Gallery captions saved')}
                    >
                      Save caption
                    </button>
                    <button
                      type="button"
                      className="btn sm danger"
                      disabled={saving}
                      onClick={() => save({ site_gallery: gallery.filter((_, position) => position !== index) }, 'Photo removed')}
                    >
                      Remove
                    </button>
                  </div>
                </figure>
              ))}
            </div>
          </section>

          <section className="card">
            <h3>Media library</h3>
            <p className="muted small">Every image uploaded for this property. Click one to use it as the hero.</p>
            <div className="media-grid small-tiles">
              {media.map((item) => (
                <button
                  type="button"
                  className="media-tile pick"
                  key={item.id}
                  onClick={() => {
                    setForm({ ...form, site_hero_image: item.url });
                    save({ site_hero_image: item.url }, 'Hero image updated from the library');
                  }}
                >
                  <img src={item.url} alt={item.filename} loading="lazy" />
                  <span className="small muted">{item.filename}</span>
                </button>
              ))}
              {!media.length ? <p className="muted small">No uploads yet.</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'rooms' ? (
        <div className="stack">
          <p className="muted small">
            Photos and amenities here drive the room cards on the booking website and the front desk.
          </p>
          {roomTypes.map((type) => (
            <section className="card room-type-editor" key={type.id}>
              <div className="room-type-editor-media">
                {type.image_url ? <img src={type.image_url} alt={type.name} /> : <span className="placeholder">{type.code}</span>}
                <Uploader
                  label="Change photo"
                  kind="room"
                  onUploaded={(item) => updateRoomType(type, { image_url: item.url })}
                />
              </div>
              <div className="room-type-editor-body">
                <div className="card-head">
                  <h3>
                    {type.code} · {type.name}
                  </h3>
                  <span className="badge neutral">{type.section === 'serviced' ? 'Serviced apartment' : 'Hotel room'}</span>
                </div>
                <div className="form-grid">
                  <label className="span-2">
                    <span>Photo URL</span>
                    <input
                      defaultValue={type.image_url || ''}
                      onBlur={(event) => {
                        if (event.target.value !== (type.image_url || '')) updateRoomType(type, { image_url: event.target.value });
                      }}
                    />
                  </label>
                  <label className="span-2">
                    <span>Amenities (comma separated)</span>
                    <input
                      defaultValue={type.amenities || ''}
                      onBlur={(event) => {
                        if (event.target.value !== (type.amenities || '')) updateRoomType(type, { amenities: event.target.value });
                      }}
                    />
                  </label>
                  <label>
                    <span>Bed</span>
                    <input
                      defaultValue={type.bed || ''}
                      onBlur={(event) => {
                        if (event.target.value !== (type.bed || '')) updateRoomType(type, { bed: event.target.value });
                      }}
                    />
                  </label>
                  <label>
                    <span>Size (m²)</span>
                    <input
                      type="number"
                      min="0"
                      defaultValue={type.size_sqm || ''}
                      onBlur={(event) => {
                        const value = Number(event.target.value) || null;
                        if (value !== (type.size_sqm || null)) updateRoomType(type, { size_sqm: value });
                      }}
                    />
                  </label>
                  <label>
                    <span>Rate per night</span>
                    <input
                      type="number"
                      min="0"
                      defaultValue={type.base_rate}
                      onBlur={(event) => {
                        const value = Number(event.target.value);
                        if (value && value !== type.base_rate) updateRoomType(type, { base_rate: value });
                      }}
                    />
                    <em>{money(type.base_rate, 'NGN')}</em>
                  </label>
                  <label>
                    <span>Section</span>
                    <select
                      defaultValue={type.section || 'hotel'}
                      onChange={(event) => updateRoomType(type, { section: event.target.value })}
                    >
                      <option value="serviced">Serviced apartment</option>
                      <option value="hotel">Hotel room</option>
                    </select>
                  </label>
                  <label className="span-2">
                    <span>Description</span>
                    <textarea
                      rows={2}
                      defaultValue={type.description || ''}
                      onBlur={(event) => {
                        if (event.target.value !== (type.description || '')) updateRoomType(type, { description: event.target.value });
                      }}
                    />
                  </label>
                </div>
                {busyType === type.id ? <p className="muted small">Saving…</p> : null}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {tab === 'domain' ? (
        <div className="split-grid">
          <section className="card">
            <h3>Your own web address</h3>
            <p className="muted small">
              Serve the booking website from a domain you own, for example <span className="mono">bookings.richgates.com</span>.
              Saving here records the domain for this property; pointing DNS at the hosted app requires a paid hosting plan
              (Starter or Pro) from Settings → Billing.
            </p>
            <div className="form-grid">
              <label className="span-2">
                <span>Custom domain</span>
                <input
                  placeholder="bookings.richgates.com"
                  value={form.site_domain}
                  onChange={(event) => setForm({ ...form, site_domain: event.target.value })}
                />
              </label>
              <label className="span-2">
                <span>DNS note (internal)</span>
                <input
                  placeholder="Who manages the DNS for this property"
                  value={form.site_domain_note}
                  onChange={(event) => setForm({ ...form, site_domain_note: event.target.value })}
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn primary"
                disabled={saving}
                onClick={() => save({ site_domain: form.site_domain, site_domain_note: form.site_domain_note }, 'Domain saved')}
              >
                {saving ? 'Saving…' : 'Save domain'}
              </button>
            </div>
            <div className="callout">
              <strong>Setup steps</strong>
              <ol>
                <li>Add the domain in your hosting provider and copy the target hostname it gives you.</li>
                <li>
                  At your DNS provider create a <span className="mono">CNAME</span> record:{' '}
                  <span className="mono">{form.site_domain || 'bookings.yourproperty.com'}</span> →{' '}
                  <span className="mono">your-app-host</span>.
                </li>
                <li>Wait for DNS to propagate (usually under an hour), then request the certificate from your provider.</li>
                <li>Staff sign-in keeps working on the same domain at <span className="mono">/</span>; guests use <span className="mono">/book</span>.</li>
              </ol>
            </div>
          </section>

          <section className="card">
            <h3>Card payments</h3>
            <p className="muted small">
              Guests can pay by card at checkout. PCH PMS validates the card and records the payment against the booking
              and the open shift. Connect a live payment provider before taking real money — until then payments are
              recorded for reconciliation only.
            </p>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={Boolean(form.payment_card_enabled)}
                onChange={(event) => setForm({ ...form, payment_card_enabled: event.target.checked })}
              />
              <span>Accept card payments on the website</span>
            </label>
            <div className="form-grid">
              <label>
                <span>Deposit taken at booking (%)</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={form.payment_deposit_percent}
                  onChange={(event) => setForm({ ...form, payment_deposit_percent: event.target.value })}
                />
                <em>100 charges the full stay, 30 charges a 30% deposit.</em>
              </label>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn primary"
                disabled={saving}
                onClick={() =>
                  save(
                    {
                      payment_card_enabled: form.payment_card_enabled,
                      payment_deposit_percent: form.payment_deposit_percent
                    },
                    'Payment settings saved'
                  )
                }
              >
                {saving ? 'Saving…' : 'Save payment settings'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
