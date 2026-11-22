import { useCallback, useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Check, ExternalLink, FileText } from 'lucide-react';
import { api, ApiError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, AreaField, Dialog, Loading, StatusBadge, useToast } from '../components/ui.jsx';
import { useAutoRefresh } from '../lib.js';

const label = (s) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const canDecide = (u) => u.adminRole === 'super_admin' || u.adminRole === 'verifier';

export function AdminHome() { return <Navigate to="/admin/suppliers" replace />; }

/** Page for /admin/suppliers and /admin/hospitals. */
export default function AdminQueue() {
  const { kind } = useParams();
  if (kind !== 'suppliers' && kind !== 'hospitals') return <Navigate to="/admin/suppliers" replace />;
  return <Queue key={kind} kind={kind} />;
}

const FILTERS = {
  suppliers: [['pending', 'Waiting'], ['under_verification', 'In review'], ['verified', 'Verified'], ['rejected', 'Not approved']],
  hospitals: [['under_review', 'In review'], ['unverified', 'Not requested'], ['verified', 'Verified'], ['rejected', 'Not approved']],
};

function Queue({ kind }) {
  const isSupplier = kind === 'suppliers';
  const [status, setStatus] = useState(FILTERS[kind][0][0]);
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    return api(`/admin/${kind}?status=${status}`).then((d) => setRows(d[kind])).catch((e) => setError(e.message));
  }, [kind, status]);

  useEffect(() => { setRows(null); setSelected(null); load(); }, [load]);
  useAutoRefresh(load);

  return (
    <>
      <header className="page-head">
        <h1 style={{ fontSize: '1.9rem' }}>{isSupplier ? 'Supplier verification' : 'Hospital verification'}</h1>
        <p className="page-head__sub">
          {isSupplier ? 'Review applications, check documents and decide.' : 'Hospitals are verified before their first order.'}
        </p>
      </header>

      <div className="queue">
        <div className="queue__toolbar">
          <div className="segmented" role="group" aria-label="Filter by status">
            {FILTERS[kind].map(([value, text]) => (
              <button key={value} className="segmented__item" aria-pressed={status === value} onClick={() => setStatus(value)}>{text}</button>
            ))}
          </div>
        </div>

        <div>
          <Alert>{error}</Alert>
          {rows === null ? <Loading /> : rows.length === 0 ? (
            <div className="empty"><span className="empty__title">Nothing here</span><span className="muted">No {isSupplier ? 'suppliers' : 'hospitals'} with this status.</span></div>
          ) : (
            <div className="queue__list" role="list">
              {rows.map((r) => (
                <button key={r.id} role="listitem" className="queue__item" aria-current={selected === r.id} onClick={() => setSelected(r.id)}>
                  <span className="queue__name">{isSupplier ? r.company_name : r.hospital_name}</span>
                  <span className="queue__meta">{label(isSupplier ? r.supplier_type : r.hospital_type)} in {r.city}</span>
                  <span className="queue__meta">GSTIN {r.gstin}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected ? (
          isSupplier
            ? <SupplierReview key={selected} id={selected} onDone={() => { setSelected(null); load(); }} />
            : <HospitalReview key={selected} id={selected} onDone={() => { setSelected(null); load(); }} />
        ) : (
          <div className="review__empty">Select {isSupplier ? 'a supplier' : 'a hospital'} to review.</div>
        )}
      </div>
    </>
  );
}

/* ---------------- Decision dialogs ---------------- */
function RejectDialog({ open, onClose, onConfirm, busy, subject }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title={`Reject ${subject}?`}>
      <p className="muted">They will see this reason and can apply again, so say what to fix.</p>
      <AreaField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} hint="At least 5 characters" />
      <div className="dialog__actions">
        <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--danger" disabled={busy || reason.trim().length < 5} onClick={() => onConfirm(reason.trim())}>
          {busy ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </Dialog>
  );
}

/* ---------------- Supplier review ---------------- */
function SupplierReview({ id, onDone }) {
  const { user } = useAuth();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [checklist, setChecklist] = useState({});
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api(`/admin/suppliers/${id}`).then(setD).catch((e) => setError(e.message)); }, [id]);

  async function act(path, body, done) {
    setBusy(true); setError('');
    try { await api(`/admin/suppliers/${id}/${path}`, { method: 'POST', body }); toast(done); setRejecting(false); onDone(); }
    catch (e) {
      const failed = e instanceof ApiError && e.details?.failed;
      setError(failed ? `${e.message}. Still unchecked: ${failed.map((k) => d.required_checks.find((c) => c.key === k)?.label || k).join('; ')}` : e.message);
      setRejecting(false);
    } finally { setBusy(false); }
  }

  if (!d) return error ? <Alert>{error}</Alert> : <Loading rows={4} />;
  const s = d.supplier;
  const st = d.verification.verification_status;
  const done = d.required_checks.filter((c) => checklist[c.key]).length;

  return (
    <article className="review panel" aria-label={`Review ${s.company_name}`}>
      <div className="panel__head">
        <h2 style={{ fontSize: '1.35rem' }}>{s.company_name}</h2>
        <StatusBadge status={st} />
      </div>
      <Alert>{error}</Alert>

      <dl className="facts">
        <dt>Type</dt><dd>{label(s.supplier_type)}{s.has_own_factory ? ', own factory' : ''}</dd>
        <dt>PAN</dt><dd>{s.pan}</dd>
        <dt>GSTIN</dt><dd>{s.gstin}</dd>
        <dt>Business proof</dt><dd>{label(s.business_proof_type)}, {s.business_proof_number}</dd>
        <dt>Address</dt><dd>{s.registered_address}, {s.city}, {s.state} {s.pincode}</dd>
        <dt>Contact</dt><dd>{s.phone}, {s.email}</dd>
        <dt>Bank</dt><dd>{d.bank_accounts.map((b) => `${b.account_holder_name}, ${b.account_number}, ${b.ifsc}`).join('; ') || 'None'}</dd>
        <dt>Terms accepted</dt><dd>{d.terms_acceptances.map((t) => `Version ${t.version} on ${new Date(t.accepted_at).toLocaleDateString('en-IN')}`).join(', ') || 'Not accepted'}</dd>
      </dl>

      <div className="review__block">
        <h3 className="review__block-title">Supplies</h3>
        <div className="tag-list">{d.categories.map((c) => <span key={c.id} className="tag">{c.name}</span>)}</div>
        {d.brands.length > 0 && <div className="tag-list">{d.brands.map((b) => <span key={b.name} className="tag">{b.name}</span>)}</div>}
      </div>

      <div className="review__block">
        <h3 className="review__block-title">Documents</h3>
        <ul className="doc-list">
          {d.documents.map((x) => (
            <li key={x.id} className="doc-list__item">
              <a className="doc-list__link" href={x.file_url} target="_blank" rel="noreferrer"><FileText size={16} aria-hidden /> {label(x.document_type)}</a>
              <ExternalLink size={14} aria-hidden className="muted" />
            </li>
          ))}
        </ul>
      </div>

      {d.verification.rejection_reason && <Alert kind="warn">Earlier rejection: {d.verification.rejection_reason}</Alert>}

      {canDecide(user) && st === 'pending' && (
        <div className="review__actions">
          <button className="btn" disabled={busy} onClick={() => act('start-verification', undefined, 'Verification started')}>Start verification</button>
        </div>
      )}

      {canDecide(user) && st === 'under_verification' && (
        <div className="review__block">
          <h3 className="review__block-title">Checklist <span className="muted" style={{ fontWeight: 400 }}>({done} of {d.required_checks.length} passed)</span></h3>
          <div className="progress" aria-hidden><div className="progress__bar" style={{ width: `${(done / d.required_checks.length) * 100}%` }} /></div>
          <p className="muted small">Cross-check the GSTIN on the GST portal before ticking it. Every item must pass to verify.</p>
          {d.required_checks.map((c) => (
            <label key={c.key} className="check">
              <input type="checkbox" checked={Boolean(checklist[c.key])} onChange={(e) => setChecklist((x) => ({ ...x, [c.key]: e.target.checked }))} />
              <span>{c.label}</span>
            </label>
          ))}
          <div className="review__actions">
            <button className="btn" disabled={busy || done < d.required_checks.length} onClick={() => act('verify', { checklist }, 'Supplier verified')}>
              <Check size={16} aria-hidden /> Verify supplier
            </button>
            <button className="btn btn--quiet" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
          </div>
        </div>
      )}

      <RejectDialog open={rejecting} busy={busy} subject="this supplier" onClose={() => setRejecting(false)}
        onConfirm={(reason) => act('reject', { reason, checklist }, 'Supplier rejected')} />
    </article>
  );
}

/* ---------------- Hospital review ---------------- */
function HospitalReview({ id, onDone }) {
  const { user } = useAuth();
  const toast = useToast();
  const [h, setH] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api(`/admin/hospitals/${id}`).then((d) => setH(d.hospital)).catch((e) => setError(e.message)); }, [id]);

  async function act(path, body, done) {
    setBusy(true); setError('');
    try { await api(`/admin/hospitals/${id}/${path}`, { method: 'POST', body }); toast(done); setRejecting(false); onDone(); }
    catch (e) { setError(e.message); setRejecting(false); }
    finally { setBusy(false); }
  }

  if (!h) return error ? <Alert>{error}</Alert> : <Loading rows={4} />;

  return (
    <article className="review panel" aria-label={`Review ${h.hospital_name}`}>
      <div className="panel__head">
        <h2 style={{ fontSize: '1.35rem' }}>{h.hospital_name}</h2>
        <StatusBadge status={h.verification_status} />
      </div>
      <Alert>{error}</Alert>
      <dl className="facts">
        <dt>Type</dt><dd>{label(h.hospital_type)}</dd>
        <dt>Registration no.</dt><dd>{h.registration_number}</dd>
        <dt>GSTIN</dt><dd>{h.gstin}</dd>
        <dt>PAN</dt><dd>{h.pan}</dd>
        <dt>Address</dt><dd>{h.registered_address}, {h.city}, {h.state} {h.pincode}</dd>
        <dt>Hospital contact</dt><dd>{h.phone}, {h.email}</dd>
        <dt>Contact person</dt><dd>{h.contact_person_name}, {h.contact_person_designation}, {h.contact_person_mobile}, {h.contact_person_email}</dd>
      </dl>
      {canDecide(user) && h.verification_status === 'under_review' && (
        <div className="review__actions">
          <button className="btn" disabled={busy} onClick={() => act('verify', undefined, 'Hospital verified')}><Check size={16} aria-hidden /> Verify hospital</button>
          <button className="btn btn--quiet" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
        </div>
      )}
      {h.verification_status === 'unverified' && <Alert kind="info">This hospital has not asked for verification yet.</Alert>}
      <RejectDialog open={rejecting} busy={busy} subject="this hospital" onClose={() => setRejecting(false)}
        onConfirm={(reason) => act('reject', { reason }, 'Hospital rejected')} />
    </article>
  );
}
