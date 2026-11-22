import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { Link } from 'react-router-dom';
import { Alert, Loading, StatusBadge, Timeline, useToast } from '../components/ui.jsx';
import { Stat } from '../components/common.jsx';
import { useAutoRefresh, useLoad } from '../lib.js';

const STATUS_COPY = {
  unverified: 'You can browse, request quotes and negotiate now. Ask for verification before you place your first order.',
  under_review: 'Our team is reviewing your hospital details. You will be able to place orders once this is approved.',
  verified: 'Your hospital is verified and can place orders.',
  rejected: 'Verification was not approved. Read the reason below, then request verification again.',
};

function timeline(status) {
  const bad = status === 'rejected';
  return [
    { label: 'Registered', state: 'done' },
    { label: 'Verification requested', state: status === 'unverified' ? 'current' : 'done' },
    { label: bad ? 'Not approved' : 'Verified', state: status === 'verified' ? 'done' : bad ? 'bad' : status === 'under_review' ? 'current' : 'todo' },
  ];
}

export default function HospitalDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { data: summary } = useLoad('/summary');

  const load = () => api('/hospitals/me').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  useAutoRefresh(load);

  async function requestVerification() {
    setBusy(true); setError('');
    try {
      await api('/hospitals/me/request-verification', { method: 'POST' });
      await load();
      toast('Verification requested');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'); }
    finally { setBusy(false); }
  }

  if (!data) return error ? <Alert>{error}</Alert> : <Loading />;
  const h = data.hospital;
  const canAsk = ['unverified', 'rejected'].includes(h.verification_status) && ['hospital_admin', 'purchase_manager'].includes(data.role);

  return (
    <>
      <header className="page-head">
        <div className="page-head__row">
          <h1 style={{ fontSize: '1.9rem' }}>{h.hospital_name}</h1>
          <StatusBadge status={h.verification_status} />
        </div>
        <p className="page-head__sub">{h.city}, {h.state}</p>
      </header>

      <Alert>{error}</Alert>

      <section className="panel" aria-labelledby="verif">
        <div className="panel__head"><h2 id="verif" style={{ fontSize: '1.2rem' }}>Hospital verification</h2></div>
        <Timeline label="Verification progress" steps={timeline(h.verification_status)} />
        <p>{STATUS_COPY[h.verification_status]}</p>
        {h.rejection_reason && <Alert>Reason from our team: {h.rejection_reason}</Alert>}
        {canAsk && (
          <div>
            <button className="btn" onClick={requestVerification} disabled={busy}>
              {busy ? 'Sending…' : h.verification_status === 'rejected' ? 'Request verification again' : 'Request verification'}
            </button>
          </div>
        )}
      </section>

      {summary && (
        <section aria-labelledby="today" className="stack">
          <h2 id="today" style={{ fontSize: '1.2rem' }}>Where things stand</h2>
          <div className="stats">
            <Stat to="/hospital/orders" value={summary.orders_need_action} label="Orders needing you" hot />
            <Stat to="/hospital/negotiations" value={summary.negotiations_awaiting_you} label="Offers waiting for your reply" hot />
            <Stat to="/hospital/rfqs" value={summary.new_quotations} label="Quotations to compare" hot />
            <Stat to="/hospital/rfqs" value={summary.open_rfqs} label="Open RFQs" />
            <Stat to="/hospital/orders" value={summary.orders_in_progress} label="Orders in progress" />
            <Stat to="/hospital/cart" value={summary.cart_items} label="Items in your cart" />
            <Stat to="/hospital/warranty" value={summary.warranties_expiring} label="Warranties ending in 60 days" />
            <Stat to="/hospital/service" value={summary.open_tickets} label="Open service requests" />
          </div>
          <div className="row"><Link className="btn" to="/marketplace">Browse products</Link><Link className="btn btn--quiet" to="/hospital/rfqs/new">New RFQ</Link></div>
        </section>
      )}
    </>
  );
}
