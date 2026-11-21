import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Paperclip, Upload } from 'lucide-react';
import { api, ApiError, uploadFile } from '../api.js';
import { label, dateTimeText } from '../lib.js';
import { Alert, AreaField, Dialog, Loading, useToast } from './ui.jsx';

export function PageHead({ title, sub, children }) {
  return (
    <header className="page-head">
      <div className="page-head__row">
        <h1 style={{ fontSize: '1.9rem' }}>{title}</h1>
        {children}
      </div>
      {sub && <p className="page-head__sub">{sub}</p>}
    </header>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <span className="empty__title">{title}</span>
      {children && <span className="muted">{children}</span>}
      {action}
    </div>
  );
}

/** One badge for every status in the app. Unknown values fall back to readable text. */
const TONES = {
  ok: ['completed', 'approved', 'agreed', 'accepted', 'resolved', 'closed', 'released', 'processed', 'verified', 'captured', 'resolved_release', 'live'],
  wait: ['pending_supplier_confirmation', 'payment_pending', 'pending_approval', 'open', 'submitted', 'new', 'contacted', 'eligible', 'held', 'dispatched', 'delivered', 'installed',
    'acknowledged', 'in_progress', 'quotes_received', 'paid', 'draft', 'sent', 'viewed', 'created'],
  bad: ['cancelled', 'rejected', 'declined', 'closed_no_deal', 'expired', 'withdrawn', 'reversed', 'failed', 'refunded', 'resolved_refund'],
};
const TEXT = {
  pending_supplier_confirmation: 'Waiting for supplier', payment_pending: 'Payment due', paid: 'Paid', pending_approval: 'Waiting for approval',
  closed_no_deal: 'No deal', awarded: 'Awarded', quotes_received: 'Quotes received', eligible: 'Ready to release', held: 'On hold',
  resolved_release: 'Released to supplier', resolved_refund: 'Refunded', manual_admin: 'Arranged by our team', in_progress: 'In progress',
};
export function StateBadge({ status }) {
  const tone = Object.keys(TONES).find((t) => TONES[t].includes(status));
  return <span className={`badge${tone ? ` badge--${tone}` : ''}`}>{TEXT[status] || label(status)}</span>;
}

export function Stat({ to, value, label: text, hot }) {
  const body = (<><span className="stat__value">{value}</span><span className="stat__label">{text}</span></>);
  const cls = `stat${hot && value > 0 ? ' is-hot' : ''}`;
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Simple definition list. rows: [[label, value]] — empty values are skipped. */
export function Facts({ rows }) {
  return (
    <dl className="facts">
      {rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

/** Ask for a reason, then run an action. */
export function ReasonDialog({ open, onClose, title, prompt, confirmText, danger, minLength = 5, onSubmit }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setText(''); setError(''); } }, [open]);
  async function submit(e) {
    e.preventDefault();
    if (text.trim().length < minLength) { setError('Add a few more words'); return; }
    setBusy(true); setError('');
    try { await onSubmit(text.trim()); onClose(); } catch (err) { setError(err instanceof ApiError ? err.message : 'Something went wrong'); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="dialog__body" style={{ padding: 0 }}>
        <AreaField label={prompt} value={text} onChange={(e) => setText(e.target.value)} error={error} autoFocus />
        <div className="dialog__actions">
          <button type="button" className="btn btn--quiet" onClick={onClose}>Back</button>
          <button className={`btn${danger ? ' btn--danger' : ''}`} disabled={busy}>{busy ? 'Working…' : confirmText}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** File picker that uploads straight away and reports the stored URL. */
export function FileField({ label: text, value, onChange, hint, accept = '.pdf,.jpg,.jpeg,.png,.webp', error }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setProblem('');
    try { const out = await uploadFile(file); onChange(out.url, file.name); } catch (err) { setProblem(err.message); } finally { setBusy(false); e.target.value = ''; }
  }
  return (
    <div className="field">
      <span className="field__label">{text}</span>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--quiet btn--small" onClick={() => ref.current?.click()} disabled={busy}>
          <Upload size={16} aria-hidden /> {busy ? 'Uploading…' : value ? 'Replace file' : 'Choose file'}
        </button>
        {value && <a href={value} target="_blank" rel="noreferrer" className="doc-list__link"><Paperclip size={16} aria-hidden /> View file</a>}
        <input ref={ref} type="file" accept={accept} onChange={pick} hidden />
      </div>
      {hint && !problem && !error && <span className="field__hint">{hint}</span>}
      {(problem || error) && <span className="field__error">{problem || error}</span>}
    </div>
  );
}

/** Bell in the top bar with unread count and the latest notifications. */
export function NotificationBell({ homePath }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [unread, setUnread] = useState(0);
  const box = useRef(null);

  useEffect(() => {
    let alive = true;
    const tick = () => api('/notifications/unread-count').then((d) => { if (alive) setUnread(d.unread); }).catch(() => {});
    tick();
    const t = setInterval(tick, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    api('/notifications').then((d) => { setData(d.notifications); setUnread(d.unread); }).catch(() => setData([]));
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const markAll = () => api('/notifications/read-all', { method: 'POST' }).then(() => { setUnread(0); setData((l) => l && l.map((n) => ({ ...n, is_read: true }))); });
  const target = (n) => {
    const base = homePath;
    const map = { order: `${base}/orders/${n.entity_id}`, rfq: `${base}/rfqs/${n.entity_id}`, negotiation: `${base}/negotiations/${n.entity_id}`, service_request: `${base}/service/${n.entity_id}`, product: `${base}/products`, dispute: `${base}/disputes`, manual_order_request: `${base}/manual` };
    return map[n.entity_type] || base;
  };

  return (
    <div className="bell" ref={box}>
      <button className="icon-button" onClick={() => setOpen((o) => !o)} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open}>
        <Bell size={20} />
        {unread > 0 && <span className="bell__count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell__panel" role="dialog" aria-label="Notifications">
          <div className="bell__head"><strong>Notifications</strong>{unread > 0 && <button className="text-button small" onClick={markAll}>Mark all as read</button>}</div>
          {data === null ? <div style={{ padding: '1rem' }}><Loading rows={2} /></div> : data.length === 0 ? <p className="muted" style={{ padding: '1rem' }}>Nothing yet. Updates about your orders and requests show up here.</p> : (
            <ul className="bell__list">
              {data.map((n) => (
                <li key={n.id} className={n.is_read ? '' : 'is-unread'}>
                  <Link to={target(n)} onClick={() => { setOpen(false); if (!n.is_read) api(`/notifications/${n.id}/read`, { method: 'POST' }).then(() => setUnread((u) => Math.max(0, u - 1))); }}>
                    <span className="bell__title">{n.title}</span>
                    {n.body && <span className="muted small">{n.body}</span>}
                    <span className="muted small">{dateTimeText(n.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export { useToast };
