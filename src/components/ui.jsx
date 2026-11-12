import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { STATUS_LABELS } from '../api.js';

export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function Modal({ title, subtitle, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, span2 = false }) {
  return (
    <label className={`field${span2 ? ' span-2' : ''}`}>
      <span>{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Banner({ kind = 'info', children }) {
  if (!children) return null;
  return <div className={`banner ${kind}`}>{children}</div>;
}

const BADGE_KIND = {
  confirmed: 'info',
  checked_in: 'ok',
  checked_out: 'neutral',
  pending: 'warn',
  cancelled: 'neutral',
  no_show: 'danger',
  clean: 'ok',
  inspected: 'info',
  dirty: 'warn',
  out_of_order: 'danger'
};

export function StatusBadge({ status }) {
  const kind = BADGE_KIND[status] || 'neutral';
  return (
    <span className={`badge ${kind}`}>
      <span className="dot" />
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function Card({ title, subtitle, actions, children, padded = true, className = '' }) {
  return (
    <section className={`card ${className}`.trim()}>
      {title || actions ? (
        <div className="card-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <div className="sub">{subtitle}</div> : null}
          </div>
          {actions ? <div className="row">{actions}</div> : null}
        </div>
      ) : null}
      {padded ? <div className="card-body">{children}</div> : children}
    </section>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function useToasts() {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((current) => [...current, { id, message, kind }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  }, []);

  const view = (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast${toast.kind === 'error' ? ' error' : ''}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );

  return { push, view };
}

export function roleLabel(role) {
  return (
    {
      admin: 'Administrator',
      manager: 'Manager',
      front_desk: 'Front desk',
      housekeeping: 'Housekeeping'
    }[role] || role
  );
}
