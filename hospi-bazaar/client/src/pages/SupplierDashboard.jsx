import { useEffect, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { api, ApiError } from '../api.js';
import { Link } from 'react-router-dom';
import { Alert, Loading, StatusBadge, Timeline, useToast } from '../components/ui.jsx';
import { Stat } from '../components/common.jsx';
import { inr, useAutoRefresh, useLoad } from '../lib.js';

const STATUS_COPY = {
  pending: 'We have received your application. A verifier will pick it up soon.',
  under_verification: 'A verifier is checking your documents against the list below.',
  verified: 'You are verified. List products, answer RFQs and handle orders from the menu.',
  rejected: 'Your application was not approved. Read the reason below, fix the issue, then apply again.',
};

function timeline(status) {
  const bad = status === 'rejected';
  return [
    { label: 'Application received', state: 'done' },
    { label: 'Under verification', state: status === 'pending' ? 'current' : 'done' },
    { label: bad ? 'Not approved' : 'Verified', state: status === 'verified' ? 'done' : bad ? 'bad' : status === 'under_verification' ? 'current' : 'todo' },
  ];
}

const label = (s) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export default function SupplierDashboard() {
  const { data: summary } = useLoad('/summary');
  const [data, setData] = useState(null);
  const [checks, setChecks] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () => Promise.all([api('/suppliers/me'), api('/suppliers/me/checklist')])
    .then(([me, cl]) => { setData(me); setChecks(cl.checks); })
    .catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  useAutoRefresh(load);

  async function reapply() {
    setBusy(true); setError('');
    try { await api('/suppliers/me/reapply', { method: 'POST' }); await load(); toast('Application submitted again'); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'); }
    finally { setBusy(false); }
  }

  if (!data) return error ? <Alert>{error}</Alert> : <Loading />;
  const { supplier: s, verification: v } = data;
  const status = v.verification_status;

  return (
    <>
      <header className="page-head">
        <div className="page-head__row">
          <h1 style={{ fontSize: '1.9rem' }}>{s.company_name}</h1>
          <StatusBadge status={status} />
        </div>
        <p className="page-head__sub">{label(s.supplier_type)} in {s.city}, {s.state}</p>
      </header>

      <Alert>{error}</Alert>

      <section className="panel" aria-labelledby="app">
        <div className="panel__head"><h2 id="app" style={{ fontSize: '1.2rem' }}>Application status</h2></div>
        <Timeline label="Verification progress" steps={timeline(status)} />
        <p>{STATUS_COPY[status]}</p>
        {v.rejection_reason && <Alert>Reason from our team: {v.rejection_reason}</Alert>}
        {status === 'rejected' && (
          <div><button className="btn" onClick={reapply} disabled={busy}>{busy ? 'Submitting…' : 'Apply again'}</button></div>
        )}
      </section>

      {status === 'verified' && summary && (
        <section aria-labelledby="today" className="stack">
          <h2 id="today" style={{ fontSize: '1.2rem' }}>Where things stand</h2>
          <div className="stats">
            <Stat to="/supplier/orders" value={summary.orders_to_confirm} label="Orders to confirm" hot />
            <Stat to="/supplier/orders" value={summary.orders_to_dispatch} label="Paid orders to dispatch" hot />
            <Stat to="/supplier/rfqs" value={summary.rfqs_to_quote} label="RFQs waiting for a quote" hot />
            <Stat to="/supplier/negotiations" value={summary.negotiations_awaiting_you} label="Offers waiting for your reply" hot />
            <Stat to="/supplier/service" value={summary.open_tickets} label="Open service requests" />
            <Stat to="/supplier/products" value={summary.live_products} label="Live products" />
            <Stat value={inr(summary.payout_pending)} label="Payouts on the way" />
          </div>
          <div className="row"><Link className="btn" to="/supplier/products/new">Add a product</Link></div>
        </section>
      )}

      {status !== 'verified' && (
        <section className="panel" aria-labelledby="checks">
          <h2 id="checks" style={{ fontSize: '1.2rem' }}>What the verifier checks</h2>
          <p className="muted">This list is based on your supplier type and categories.</p>
          <ul className="checklist">
            {checks.map((c) => (
              <li key={c.key} className="checklist__item">
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--scrub)', marginTop: '0.55rem' }} />
                <span>{c.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))' }}>
        <section className="panel" aria-labelledby="docs">
          <h2 id="docs" style={{ fontSize: '1.2rem' }}>Your documents</h2>
          {data.documents.length === 0 ? (
            <div className="empty"><span className="empty__title">No documents yet</span><span className="muted">Documents you submit appear here.</span></div>
          ) : (
            <ul className="doc-list">
              {data.documents.map((d) => (
                <li key={d.id} className="doc-list__item">
                  <a className="doc-list__link" href={d.file_url} target="_blank" rel="noreferrer"><FileText size={16} aria-hidden /> {label(d.document_type)}</a>
                  <ExternalLink size={14} aria-hidden className="muted" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="prof">
          <h2 id="prof" style={{ fontSize: '1.2rem' }}>What you supply</h2>
          <div>
            <p className="muted small" style={{ marginBottom: '0.4rem' }}>Categories</p>
            <div className="tag-list">{data.categories.map((c) => <span key={c.id} className="tag">{c.name}</span>)}</div>
          </div>
          {data.brands.length > 0 && (
            <div>
              <p className="muted small" style={{ marginBottom: '0.4rem' }}>Brands</p>
              <div className="tag-list">{data.brands.map((b) => <span key={b.id} className="tag">{b.name}</span>)}</div>
            </div>
          )}
          {data.service_locations.length > 0 && (
            <div>
              <p className="muted small" style={{ marginBottom: '0.4rem' }}>Service in</p>
              <div className="tag-list">{data.service_locations.map((l) => <span key={l.id} className="tag">{l.state}</span>)}</div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
