import React, { useCallback, useEffect, useState } from 'react';
import { api, dateTime } from '../api.js';
import { Banner, Card, Empty, Field, Spinner, useApp } from '../components/ui.jsx';

export default function Settings() {
  const { user, property, refresh, toast, can } = useApp();
  const manage = can('admin', 'manager');
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [activity, setActivity] = useState([]);
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '' });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaved, setPasswordSaved] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.get('/property');
      setForm(data.property);
      setError('');
    } catch (err) {
      setError(err.message);
    }
    if (can('admin', 'manager')) {
      try {
        const data = await api.get('/activity');
        setActivity(data.activity);
      } catch {
        setActivity([]);
      }
    }
  }, [can]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.put('/property', {
        property_name: form.property_name,
        property_address: form.property_address,
        property_phone: form.property_phone,
        currency: form.currency,
        check_in_time: form.check_in_time,
        check_out_time: form.check_out_time,
        timezone: form.timezone
      });
      toast('Property settings saved');
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setPasswordError('');
    setPasswordSaved('');
    try {
      await api.post('/auth/password', passwords);
      setPasswords({ current_password: '', new_password: '' });
      setPasswordSaved('Password updated');
      toast('Password updated');
    } catch (err) {
      setPasswordError(err.message);
    }
  };

  if (!form) return <Spinner />;

  return (
    <>
      <Banner kind="error">{error}</Banner>

      <Card
        title="Property profile"
        subtitle={manage ? 'Shown on guest documents and used for the iCal feed names' : 'Only administrators and managers can change these values'}
        padded={false}
      >
        <form className="card-body" onSubmit={save}>
          <div className="grid two">
            <Field label="Property name">
              <input
                value={form.property_name || ''}
                onChange={(e) => setForm({ ...form, property_name: e.target.value })}
                disabled={!manage}
              />
            </Field>
            <Field label="Phone">
              <input
                value={form.property_phone || ''}
                onChange={(e) => setForm({ ...form, property_phone: e.target.value })}
                disabled={!manage}
              />
            </Field>
          </div>
          <Field label="Address">
            <input
              value={form.property_address || ''}
              onChange={(e) => setForm({ ...form, property_address: e.target.value })}
              disabled={!manage}
            />
          </Field>
          <div className="grid three">
            <Field label="Currency" hint="ISO code, e.g. EUR">
              <input
                value={form.currency || 'EUR'}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                maxLength={3}
                disabled={!manage}
              />
            </Field>
            <Field label="Check-in time">
              <input
                type="time"
                value={form.check_in_time || '15:00'}
                onChange={(e) => setForm({ ...form, check_in_time: e.target.value })}
                disabled={!manage}
              />
            </Field>
            <Field label="Check-out time">
              <input
                type="time"
                value={form.check_out_time || '11:00'}
                onChange={(e) => setForm({ ...form, check_out_time: e.target.value })}
                disabled={!manage}
              />
            </Field>
          </div>
          <Field label="Timezone">
            <input
              value={form.timezone || ''}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              disabled={!manage}
            />
          </Field>
          {manage ? (
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          ) : null}
        </form>
      </Card>

      <Card title="Your account" subtitle={`${user.name} · ${user.email}`}>
        <form className="inline-form" onSubmit={changePassword}>
          <Field label="Current password">
            <input
              type="password"
              value={passwords.current_password}
              onChange={(e) => setPasswords({ ...passwords, current_password: e.target.value })}
              required
              autoComplete="current-password"
            />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <input
              type="password"
              value={passwords.new_password}
              onChange={(e) => setPasswords({ ...passwords, new_password: e.target.value })}
              minLength={8}
              required
              autoComplete="new-password"
            />
          </Field>
          <button type="submit" className="btn">
            Update password
          </button>
        </form>
        <Banner kind="error">{passwordError}</Banner>
        <Banner kind="ok">{passwordSaved}</Banner>
      </Card>

      {can('admin', 'manager') ? (
        <Card title="Activity log" subtitle="Audit trail of account, reservation, housekeeping and channel changes" padded={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Area</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {activity.length ? (
                  activity.slice(0, 40).map((entry) => (
                    <tr key={entry.id}>
                      <td className="small">{dateTime(entry.created_at)}</td>
                      <td className="small">{entry.user_name || 'system'}</td>
                      <td>
                        <span className="badge neutral">{entry.action}</span>
                      </td>
                      <td className="small">{entry.detail}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4">
                      <Empty>No activity recorded yet</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
}
