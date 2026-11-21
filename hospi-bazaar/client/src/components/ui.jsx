import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Info, TriangleAlert } from 'lucide-react';

/* ---------------- Toasts ---------------- */
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setItems((list) => [...list, { id, text, kind }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'bad' ? ' toast--bad' : ''}`}>
            {t.kind === 'bad' ? <AlertCircle size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------------- Dialog (native, focus-trapped, closes on Esc) ---------------- */
export function Dialog({ open, onClose, title, children }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={onClose}>
      {open && (
        <div className="dialog__body">
          <h3 id={titleId}>{title}</h3>
          {children}
        </div>
      )}
    </dialog>
  );
}

/* ---------------- Alerts ---------------- */
export function Alert({ kind = 'bad', children }) {
  if (!children) return null;
  const Icon = kind === 'bad' ? AlertCircle : kind === 'warn' ? TriangleAlert : Info;
  return (
    <div className={`alert alert--${kind}`} role={kind === 'bad' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/* ---------------- Fields ---------------- */
function FieldShell({ id, label, optional, hint, error, children }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label} {optional && <span className="field__optional">(optional)</span>}
      </label>
      {children}
      {hint && !error && <span className="field__hint" id={`${id}-hint`}>{hint}</span>}
      {error && <span className="field__error" id={`${id}-err`}>{error}</span>}
    </div>
  );
}

const aria = (id, hint, error) => ({
  'aria-invalid': error ? 'true' : undefined,
  'aria-describedby': error ? `${id}-err` : hint ? `${id}-hint` : undefined,
});

export function TextField({ label, optional, hint, error, ...props }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} optional={optional} hint={hint} error={error}>
      <input id={id} className="input" {...aria(id, hint, error)} {...props} />
    </FieldShell>
  );
}

export function SelectField({ label, optional, hint, error, children, ...props }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} optional={optional} hint={hint} error={error}>
      <select id={id} className="input" {...aria(id, hint, error)} {...props}>{children}</select>
    </FieldShell>
  );
}

export function AreaField({ label, optional, hint, error, ...props }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} optional={optional} hint={hint} error={error}>
      <textarea id={id} className="input" {...aria(id, hint, error)} {...props} />
    </FieldShell>
  );
}

export function CheckField({ children, error, ...props }) {
  return (
    <div className="field">
      <label className="check">
        <input type="checkbox" {...props} />
        <span>{children}</span>
      </label>
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}

/* ---------------- Status ---------------- */
const STATUS = {
  unverified: ['Not verified', 'plain'],
  under_review: ['Under review', 'wait'],
  pending: ['Waiting for review', 'wait'],
  under_verification: ['Under verification', 'wait'],
  verified: ['Verified', 'ok'],
  rejected: ['Not approved', 'bad'],
};

export function StatusBadge({ status }) {
  const [text, tone] = STATUS[status] || [status, 'plain'];
  return <span className={`badge${tone === 'plain' ? '' : ` badge--${tone}`}`}>{text}</span>;
}

/** steps: [{ label, state: 'done' | 'current' | 'todo' | 'bad' }] */
export function Timeline({ steps, label }) {
  return (
    <ol className="timeline" aria-label={label}>
      {steps.map((s, i) => (
        <li key={s.label} className={`timeline__step is-${s.state === 'todo' ? 'todo' : s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="timeline__dot" aria-hidden>
            {s.state === 'done' ? <Check size={14} strokeWidth={3} /> : s.state === 'bad' ? '!' : i + 1}
          </span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

export function Loading({ rows = 3 }) {
  return (
    <div style={{ display: 'grid', gap: '0.75rem' }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" style={{ height: i === 0 ? 28 : 56 }} />)}
    </div>
  );
}

/** After a failed validation, bring the first problem into view and focus it. */
export function focusFirstError() {
  requestAnimationFrame(() => {
    const el = document.querySelector('[aria-invalid="true"]') || document.querySelector('.field__error');
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (typeof el.focus === 'function' && el.matches('input, select, textarea')) el.focus({ preventScroll: true });
  });
}

/** Small controlled-form helper. */
export function useFields(initial) {
  const [values, setValues] = useState(initial);
  const bind = (name) => ({
    name,
    value: values[name],
    onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })),
  });
  return { values, setValues, bind };
}
