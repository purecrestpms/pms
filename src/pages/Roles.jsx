import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const BASE_OPTIONS = [
  { key: 'admin', label: 'Admin-level access' },
  { key: 'manager', label: 'Manager-level access' },
  { key: 'front_desk', label: 'Front desk access' },
  { key: 'housekeeping', label: 'Housekeeping access' }
];

export default function Roles() {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [roleData, userData] = await Promise.all([api.get('/roles'), api.get('/users')]);
      setRoles(roleData.roles || []);
      setPermissions(roleData.permissions || []);
      setUsers(userData.users || userData || []);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startNew = () =>
    setEditing({ key: '', name: '', description: '', base: 'front_desk', permissions: ['dashboard', 'front_desk', 'reservations'], builtin: false });

  const saveRole = async () => {
    if (!editing) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        name: editing.name,
        description: editing.description,
        base: editing.base,
        permissions: editing.permissions
      };
      const data = editing.key ? await api.patch(`/roles/${editing.key}`, payload) : await api.post('/roles', payload);
      setRoles(data.roles || []);
      setEditing(null);
      setNotice(editing.key ? 'Role updated' : 'Role created — assign it to staff below');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteRole = async (role) => {
    setError('');
    setNotice('');
    try {
      const data = await api.delete(`/roles/${role.key}`);
      setRoles(data.roles || []);
      setNotice(`${role.name} deleted`);
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };

  const assign = async (user, roleKey) => {
    setError('');
    setNotice('');
    try {
      await api.patch(`/users/${user.id}`, { role: roleKey });
      setUsers((current) => current.map((item) => (item.id === user.id ? { ...item, role: roleKey } : item)));
      const role = roles.find((item) => item.key === roleKey);
      setNotice(`${user.name} is now ${role ? role.name : roleKey}`);
    } catch (assignError) {
      setError(assignError.message);
    }
  };

  const togglePermission = (key) => {
    const current = editing.permissions || [];
    setEditing({
      ...editing,
      permissions: current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    });
  };

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h2 className="page-title">Roles & permissions</h2>
          <p className="muted small">
            Build roles for your property, then assign them to staff. A role decides which pages and actions a person can use.
          </p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn primary" onClick={startNew}>
            New role
          </button>
        </div>
      </div>

      {notice ? <div className="inline-ok">{notice}</div> : null}
      {error ? <div className="inline-error">{error}</div> : null}

      <div className="role-grid">
        {roles.map((role) => (
          <article className="card role-card" key={role.key}>
            <div className="card-head">
              <h3>{role.name}</h3>
              {role.builtin ? <span className="badge neutral">Built in</span> : <span className="badge info">Custom</span>}
            </div>
            <p className="muted small">{role.description || 'No description'}</p>
            <div className="role-meta">
              <span className="mono small">{role.key}</span>
              <span className="badge neutral small">{BASE_OPTIONS.find((item) => item.key === role.base)?.label || role.base}</span>
            </div>
            <div className="chip-preview">
              {role.permissions.map((key) => (
                <span className="chip tiny" key={key}>
                  {permissions.find((item) => item.key === key)?.label || key}
                </span>
              ))}
              {!role.permissions.length ? <span className="muted small">No pages granted</span> : null}
            </div>
            <div className="card-actions">
              <button type="button" className="btn sm" onClick={() => setEditing({ ...role })}>
                Edit
              </button>
              {!role.builtin ? (
                <button type="button" className="btn sm danger" onClick={() => deleteRole(role)}>
                  Delete
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      {editing ? (
        <section className="card editor-panel">
          <div className="card-head">
            <h3>{editing.key ? `Edit ${editing.name}` : 'Create a role'}</h3>
            <button type="button" className="btn sm ghost" onClick={() => setEditing(null)}>
              Close
            </button>
          </div>
          <div className="form-grid">
            <label>
              <span>Role name</span>
              <input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
            </label>
            <label>
              <span>Access level</span>
              <select value={editing.base} onChange={(event) => setEditing({ ...editing, base: event.target.value })}>
                {BASE_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              <em>Server permissions follow this level; the pages below control what staff see.</em>
            </label>
            <label className="span-2">
              <span>Description</span>
              <input
                value={editing.description || ''}
                onChange={(event) => setEditing({ ...editing, description: event.target.value })}
              />
            </label>
          </div>
          <h4>Pages this role can open</h4>
          <div className="permission-grid">
            {permissions.map((permission) => (
              <label className="permission" key={permission.key}>
                <input
                  type="checkbox"
                  checked={(editing.permissions || []).includes(permission.key)}
                  onChange={() => togglePermission(permission.key)}
                />
                <span>{permission.label}</span>
              </label>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={saveRole}>
              {busy ? 'Saving…' : editing.key ? 'Save role' : 'Create role'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="card-head">
          <h3>Staff assignments</h3>
          <span className="muted small">{users.length} accounts</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td className="mono small">{user.email}</td>
                <td>
                  <select value={user.role} onChange={(event) => assign(user, event.target.value)}>
                    {roles.map((role) => (
                      <option key={role.key} value={role.key}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="muted small">
                  {user.last_login ? new Date(user.last_login).toLocaleString('en-GB') : 'Never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
