import React, { useCallback, useEffect, useState } from 'react';
import { api, dateTime } from '../api.js';
import { Banner, Card, Empty, Field, Modal, Spinner, roleLabel, useApp } from '../components/ui.jsx';

const ROLE_HINTS = {
  admin: 'Full access: accounts, property settings, channels, front desk',
  manager: 'Operations: rooms, rates, channels, reservations, reports',
  front_desk: 'Check-in/out, reservations, folios, blocks',
  housekeeping: 'Room status board only'
};

export default function Staff() {
  const { user, toast, can } = useApp();
  const isAdmin = can('admin');
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/users');
      setUsers(data.users);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (account) => {
    try {
      await api.patch(`/users/${account.id}`, { active: !account.active });
      toast(`${account.email} ${account.active ? 'deactivated' : 'reactivated'}`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <>
      <Banner kind="error">{error}</Banner>

      <Card
        title="Staff accounts"
        subtitle={isAdmin ? 'Create accounts for front desk, housekeeping and managers' : 'Read-only view — only administrators can change accounts'}
        padded={false}
        actions={
          isAdmin ? (
            <button type="button" className="btn primary sm" onClick={() => setShowForm(true)}>
              + New account
            </button>
          ) : null
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Last sign-in</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users === null ? (
                <tr>
                  <td colSpan="6">
                    <Spinner />
                  </td>
                </tr>
              ) : users.length ? (
                users.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <span className="row-strong">{account.name}</span>
                      {account.id === user.id ? <span className="badge muted" style={{ marginLeft: 8 }}>you</span> : null}
                    </td>
                    <td className="mono small">{account.email}</td>
                    <td>
                      <span className="badge">{roleLabel(account.role)}</span>
                    </td>
                    <td className="small muted">{account.last_login ? dateTime(account.last_login) : 'Never'}</td>
                    <td>
                      <span className={`badge ${account.active ? 'ok' : 'danger'}`}>{account.active ? 'Active' : 'Disabled'}</span>
                    </td>
                    <td className="actions">
                      {isAdmin ? (
                        <>
                          <button type="button" className="btn sm" onClick={() => setEditing(account)}>
                            Edit
                          </button>{' '}
                          <button
                            type="button"
                            className="btn sm"
                            disabled={account.id === user.id}
                            onClick={() => toggle(account)}
                          >
                            {account.active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </>
                      ) : (
                        <span className="small muted">—</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6">
                    <Empty>No accounts yet</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Roles" subtitle="What each account can reach inside the PMS">
        <div className="grid two">
          {Object.entries(ROLE_HINTS).map(([role, hint]) => (
            <div className="mini-card" key={role}>
              <strong>{roleLabel(role)}</strong>
              <div className="small muted">{hint}</div>
            </div>
          ))}
        </div>
      </Card>

      {showForm ? (
        <AccountForm
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      ) : null}
      {editing ? (
        <AccountForm
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : null}
    </>
  );
}

function AccountForm({ account, onClose, onSaved }) {
  const { toast } = useApp();
  const [form, setForm] = useState({
    name: account?.name || '',
    email: account?.email || '',
    password: '',
    role: account?.role || 'front_desk'
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (account) {
        const payload = { name: form.name, role: form.role };
        if (form.password) payload.password = form.password;
        await api.patch(`/users/${account.id}`, payload);
        toast('Account updated');
      } else {
        await api.post('/users', form);
        toast('Account created');
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={account ? `Edit ${account.name}` : 'New staff account'}
      subtitle={account ? 'Change the role or set a new password' : 'The person can sign in immediately with this password'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="account-form" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : account ? 'Save changes' : 'Create account'}
          </button>
        </>
      }
    >
      <form id="account-form" onSubmit={submit}>
        <Banner kind="error">{error}</Banner>
        <Field label="Full name">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            disabled={Boolean(account)}
            required
          />
        </Field>
        <Field label={account ? 'New password (optional)' : 'Temporary password'} hint="Minimum 8 characters">
          <input
            type="text"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            minLength={8}
            required={!account}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Role" hint={ROLE_HINTS[form.role]}>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {Object.keys(ROLE_HINTS).map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
        </Field>
      </form>
    </Modal>
  );
}
