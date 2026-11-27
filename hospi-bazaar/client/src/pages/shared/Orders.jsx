import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api.js';
import { dateText, dateTimeText, inr, label, useLoad } from '../../lib.js';
import { Alert, Dialog, Loading, SelectField, TextField, Timeline, useToast } from '../../components/ui.jsx';
import { Empty, Facts, FileField,FileLink, PageHead, ReasonDialog, StateBadge } from '../../components/common.jsx';

const FILTERS = [['', 'All'], ['pending_supplier_confirmation', 'Waiting for supplier'], ['payment_pending', 'Payment due'], ['paid', 'Paid'], ['dispatched', 'Dispatched'], ['delivered', 'Delivered'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];

export function OrdersList({ base, party }) {
  const [status, setStatus] = useState('');
  const { data, error } = useLoad(`/orders${status ? `?status=${status}` : ''}`);
  return (
    <>
      <PageHead title="Orders" sub={party === 'hospital' ? 'Everything you have ordered, and where it is now.' : party === 'admin' ? 'All orders on the platform.' : 'Orders from hospitals.'} />
      <div className="segmented" role="group" aria-label="Filter by status">
        {FILTERS.map(([v, t]) => <button key={v} className="segmented__item" aria-pressed={status === v} onClick={() => setStatus(v)}>{t}</button>)}
      </div>
      <Alert>{error}</Alert>
      {!data && !error && <Loading />}
      {data && data.orders.length === 0 && <Empty title="No orders here">{party === 'hospital' ? 'Orders appear here after you check out your cart or accept a quotation.' : 'Orders show up when a hospital buys from you.'}</Empty>}
      {data && data.orders.length > 0 && (
        <div className="rowlist">
          {data.orders.map((o) => (
            <Link key={o.id} to={`${base}/orders/${o.id}`} className="rowlist__item">
              <span className="rowlist__title">{o.order_number}: {o.first_item}{o.item_count > 1 ? ` and ${o.item_count - 1} more` : ''}</span>
              <span className="rowlist__meta">{party === 'hospital' ? o.company_name : party === 'admin' ? `${o.hospital_name} buying from ${o.company_name}` : o.hospital_name} · {dateText(o.created_at)}{o.created_via === 'manual_admin' ? ' · Arranged by our team' : ''}</span>
              <span className="rowlist__side"><strong className="num">{inr(o.total_amount)}</strong><StateBadge status={o.status} /></span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function steps(o, installRequired) {
  const order = ['pending_supplier_confirmation', 'payment_pending', 'paid', 'dispatched', 'delivered', ...(installRequired ? ['installed'] : []), 'completed'];
  const names = { pending_supplier_confirmation: 'Placed', payment_pending: 'Confirmed', paid: 'Paid', dispatched: 'Dispatched', delivered: 'Delivered', installed: 'Installed', completed: 'Completed' };
  if (o.status === 'cancelled') return [{ label: 'Placed', state: 'done' }, { label: 'Cancelled', state: 'bad' }];
  const at = order.indexOf(o.status);
  return order.map((s, i) => ({ label: names[s], state: i < at ? 'done' : i === at ? (s === 'completed' ? 'done' : 'current') : 'todo' }));
}

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve; s.onerror = () => reject(new Error('Could not load the payment window. Check your connection.'));
    document.body.appendChild(s);
  });
}

export function OrderDetail({ base }) {
  const { id } = useParams();
  const { data, error, reload } = useLoad(`/orders/${id}`);
  const toast = useToast();
  const [dialog, setDialog] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [pay, setPay] = useState(null);
  const [ship, setShip] = useState({ carrier_name: '', tracking_reference: '', supplier_invoice_number: '', supplier_invoice_url: '' });
  const [shipErr, setShipErr] = useState({});
  const [rec, setRec] = useState({ amount: '', reference: '', method: 'bank_transfer' });
  const [recErr, setRecErr] = useState({});

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const { order: o, items, hospital, supplier, history, delivery, payments, payout, dispute, actions, side } = data;
  const has = (a) => actions.includes(a);
  const paidSoFar = payments.filter((p) => p.status === 'captured').reduce((s, p) => s + p.amount, 0);
  const balance = Math.round((o.total_amount - paidSoFar) * 100) / 100;

  async function run(path, body, message) {
    setBusy(true); setProblem('');
    try { await api(`/orders/${id}/${path}`, { method: 'POST', body: body || {} }); toast(message); await reload(); setDialog(''); }
    catch (e) { setProblem(e.message); setDialog(''); } finally { setBusy(false); }
  }

  async function startPayment() {
    setBusy(true); setProblem('');
    try {
      const p = await api(`/orders/${id}/pay`, { method: 'POST' });
      if (p.mode === 'mock') { setPay(p); setDialog('mockpay'); return; }
      await loadRazorpay();
      new window.Razorpay({
        key: p.key_id, amount: p.amount_paise, currency: p.currency, order_id: p.razorpay_order_id, name: 'Hospi Bazaar', description: p.order_number, prefill: p.prefill,
        theme: { color: '#0b5d4f' },
        handler: async (r) => {
          try { await api('/payments/verify', { method: 'POST', body: r }); toast('Payment received'); await reload(); } catch (e) { setProblem(e.message); }
        },
      }).open();
    } catch (e) { setProblem(e.message); } finally { setBusy(false); }
  }
  async function mockPay() {
    setBusy(true);
    try { await api('/payments/mock-capture', { method: 'POST', body: { razorpay_order_id: pay.razorpay_order_id } }); toast('Test payment received'); setDialog(''); await reload(); }
    catch (e) { setProblem(e.message); setDialog(''); } finally { setBusy(false); }
  }
  async function dispatch(e) {
    e.preventDefault(); setShipErr({});
    const errs = {};
    if (!ship.carrier_name.trim()) errs.carrier_name = 'Enter the carrier';
    if (!ship.supplier_invoice_number.trim()) errs.supplier_invoice_number = 'Enter your invoice number';
    if (Object.keys(errs).length) { setShipErr(errs); return; }
    await run('dispatch', { ...ship }, 'Marked as dispatched');
  }
  async function recordPayment(e) {
    e.preventDefault(); setRecErr({}); setBusy(true);
    try {
      const r = await api(`/admin/orders/${id}/payments`, { method: 'POST', body: { ...rec, amount: Number(rec.amount) } });
      toast(r.paid ? 'Payment recorded. The order is now paid' : `Payment recorded. Balance ${inr(r.balance)}`); setDialog(''); await reload();
    } catch (err) { setRecErr(err instanceof ApiError && Object.keys(err.fields).length ? err.fields : { form: err.message }); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHead title={o.order_number} sub={`${side === 'supplier' ? hospital.hospital_name : supplier.company_name} · placed ${dateText(o.created_at)}`}>
        <StateBadge status={o.status} />
        {o.created_via === 'manual_admin' && <span className="badge">Arranged by our team</span>}
      </PageHead>
      <Link to={`${base}/orders`} className="small">Back to orders</Link>
      <Alert>{problem}</Alert>
      {dispute && dispute.status === 'open' && <Alert kind="warn">A dispute is open on this order: {dispute.reason}. Our team will decide the outcome.</Alert>}
      {dispute && dispute.status !== 'open' && <Alert kind="info">{{ resolved_release: 'Dispute resolved in the supplier\'s favour', resolved_refund: 'Dispute resolved with a refund', closed: 'Dispute closed' }[dispute.status]}: {dispute.resolution_note}</Alert>}
      {data.manual_payment_note && o.status === 'payment_pending' && <Alert kind="info">{data.manual_payment_note}</Alert>}

      <section className="panel"><Timeline label="Order progress" steps={steps(o, o.installation_required)} /></section>

      {(actions.length > 0 || (side === 'admin' && o.status === 'payment_pending')) && (
        <section className="panel" aria-label="What to do next">
          <h2 style={{ fontSize: '1.15rem' }}>What to do next</h2>
          <div className="row">
            {has('confirm') && <button className="btn" onClick={() => run('confirm', {}, 'Order confirmed')} disabled={busy}>Confirm order</button>}
            {has('reject') && <button className="btn btn--quiet" onClick={() => setDialog('reject')}>Decline order</button>}
            {has('pay') && <button className="btn" onClick={startPayment} disabled={busy}>Pay {inr(balance)}</button>}
            {has('dispatch') && <button className="btn" onClick={() => setDialog('dispatch')}>Mark as dispatched</button>}
            {has('mark_delivered') && <button className="btn" onClick={() => run('mark-delivered', {}, 'Marked as delivered')} disabled={busy}>Mark as delivered</button>}
            {has('mark_installed') && <button className="btn" onClick={() => run('mark-installed', {}, 'Marked as installed')} disabled={busy}>Mark as installed</button>}
            {has('confirm_delivery') && <button className="btn" onClick={() => run('confirm-delivery', {}, 'Delivery confirmed')} disabled={busy}>Confirm delivery</button>}
            {has('confirm_installation') && <button className="btn" onClick={() => run('confirm-installation', {}, 'Installation confirmed')} disabled={busy}>Confirm installation</button>}
            {has('dispute') && <button className="btn btn--quiet" onClick={() => setDialog('dispute')}>Report a problem</button>}
            {has('cancel') && <button className="btn btn--quiet" onClick={() => setDialog('cancel')}>Cancel order</button>}
            {side === 'admin' && o.status === 'payment_pending' && <button className="btn" onClick={() => { setRec({ amount: String(balance), reference: '', method: 'bank_transfer' }); setRecErr({}); setDialog('record'); }}>Record a payment</button>}
          </div>
          {has('confirm_delivery') && <p className="muted small">{data.dispute_note} {delivery?.auto_confirm_at && `If you do nothing, delivery is confirmed on ${dateText(delivery.auto_confirm_at)}.`}</p>}
          {has('confirm_installation') && delivery?.auto_confirm_at && <p className="muted small">If you do nothing, installation is confirmed on {dateText(delivery.auto_confirm_at)}.</p>}
        </section>
      )}

      <section className="stack">
        <h2 style={{ fontSize: '1.2rem' }}>Items</h2>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Item</th><th className="is-num">Quantity</th><th className="is-num">Unit price</th><th className="is-num">GST</th><th className="is-num">Amount</th></tr></thead>
          <tbody>{items.map((i) => (
            <tr key={i.id}><td>{i.item_name}{i.model_number && <span className="muted small"><br />Model {i.model_number}</span>}</td><td className="is-num">{i.quantity}</td><td className="is-num">{inr(i.unit_price)}</td><td className="is-num">{i.gst_rate}%</td><td className="is-num">{inr(i.line_subtotal + i.line_gst)}</td></tr>
          ))}</tbody>
        </table></div>
        <div className="totals num">
          <div className="totals__row"><span>Goods</span><span>{inr(o.subtotal)}</span></div>
          {o.freight_charge > 0 && <div className="totals__row"><span>Freight</span><span>{inr(o.freight_charge)}</span></div>}
          {o.installation_charge > 0 && <div className="totals__row"><span>Installation</span><span>{inr(o.installation_charge)}</span></div>}
          {o.service_charge > 0 && <div className="totals__row"><span>Service</span><span>{inr(o.service_charge)}</span></div>}
          {o.gst_type === 'intra_state' ? (
            <>
              <div className="totals__row"><span>CGST</span><span>{inr(o.cgst_total)}</span></div>
              <div className="totals__row"><span>SGST</span><span>{inr(o.sgst_total)}</span></div>
            </>
          ) : <div className="totals__row"><span>IGST</span><span>{inr(o.igst_total)}</span></div>}
          <div className="totals__row totals__row--grand"><span>Total</span><span>{inr(o.total_amount)}</span></div>
        </div>
      </section>

      <div className="form-grid" style={{ alignItems: 'start' }}>
        <section className="panel"><h2 style={{ fontSize: '1.1rem' }}>Delivery</h2>
          <Facts rows={[['Address', `${o.delivery_address}, ${o.delivery_city}, ${o.delivery_state} ${o.delivery_pincode}`], ['Installation', o.installation_required ? 'Needed' : 'Not needed'],
            ['Carrier', delivery?.carrier_name], ['Tracking', delivery?.tracking_reference], ['Dispatched', dateText(delivery?.dispatched_at)], ['Delivered', dateText(delivery?.delivered_at)],
            ['Installed', dateText(delivery?.installed_at)], ['Supplier invoice', o.supplier_invoice_number], ['Payment terms', o.payment_terms]]} />
          {o.supplier_invoice_url && <FileLink url={o.supplier_invoice_url}>View supplier invoice</FileLink>}
        </section>
        <section className="panel"><h2 style={{ fontSize: '1.1rem' }}>Payment</h2>
          {payments.length === 0 ? <p className="muted">No payment yet.</p> : (
            <div className="doc-list">{payments.map((p) => <div key={p.id} className="doc-list__item"><span>{inr(p.amount)} <span className="muted small">{label(p.method || 'online')} · {dateText(p.captured_at || p.created_at)}</span></span><StateBadge status={p.status} /></div>)}</div>
          )}
          {o.status !== 'cancelled' && balance > 0 && payments.some((p) => p.status === 'captured') && <p className="small">Balance due {inr(balance)}</p>}
          {payout && (
            <Facts rows={[['Platform fee', `${inr(payout.platform_fee)} (${payout.platform_fee_rate}% of goods)`], [side === 'supplier' ? 'Your payout' : 'Supplier payout', `${inr(payout.net_amount)}, ${label(payout.status).toLowerCase()}`], ['Bank reference', payout.bank_reference]]} />
          )}
        </section>
      </div>

      <section className="panel"><h2 style={{ fontSize: '1.1rem' }}>History</h2>
        <div className="history">{history.map((h, i) => <div key={i} className="history__item"><span className="history__when">{dateTimeText(h.changed_at)}</span><span>{h.note || label(h.to_status)}</span></div>)}</div>
      </section>

      <ReasonDialog open={dialog === 'reject'} onClose={() => setDialog('')} title="Decline this order" prompt="Why are you declining?" confirmText="Decline order" danger onSubmit={(r) => api(`/orders/${id}/reject`, { method: 'POST', body: { reason: r } }).then(() => { toast('Order declined'); reload(); })} />
      <ReasonDialog open={dialog === 'cancel'} onClose={() => setDialog('')} title="Cancel this order" prompt="Reason (optional)" minLength={0} confirmText="Cancel order" danger onSubmit={(r) => api(`/orders/${id}/cancel`, { method: 'POST', body: { reason: r } }).then(() => { toast('Order cancelled'); reload(); })} />
      <ReasonDialog open={dialog === 'dispute'} onClose={() => setDialog('')} title="Report a problem" prompt="What is wrong with this order?" minLength={10} confirmText="Send to our team" onSubmit={(r) => api(`/orders/${id}/dispute`, { method: 'POST', body: { reason: r } }).then(() => { toast('Your report was sent. The supplier payout is on hold'); reload(); })} />

      <Dialog open={dialog === 'dispatch'} onClose={() => setDialog('')} title="Dispatch details">
        <form onSubmit={dispatch} className="stack">
          <TextField label="Carrier or transporter" value={ship.carrier_name} onChange={(e) => setShip({ ...ship, carrier_name: e.target.value })} error={shipErr.carrier_name} autoFocus />
          <TextField label="Tracking or LR number" optional value={ship.tracking_reference} onChange={(e) => setShip({ ...ship, tracking_reference: e.target.value })} />
          <TextField label="Your invoice number" value={ship.supplier_invoice_number} onChange={(e) => setShip({ ...ship, supplier_invoice_number: e.target.value })} error={shipErr.supplier_invoice_number} />
          <FileField label="Invoice copy (optional)" value={ship.supplier_invoice_url} onChange={(url) => setShip({ ...ship, supplier_invoice_url: url })} />
          <div className="dialog__actions"><button type="button" className="btn btn--quiet" onClick={() => setDialog('')}>Back</button><button className="btn" disabled={busy}>Mark as dispatched</button></div>
        </form>
      </Dialog>

      <Dialog open={dialog === 'mockpay'} onClose={() => setDialog('')} title="Test payment">
        <div className="stack">
          <Alert kind="info">Razorpay keys are not set, so this runs in test mode. No money moves. Add your keys in the server settings to take real payments.</Alert>
          <p>Pay <strong className="num">{inr(pay?.amount)}</strong> for {o.order_number}?</p>
          <div className="dialog__actions"><button className="btn btn--quiet" onClick={() => setDialog('')}>Back</button><button className="btn" onClick={mockPay} disabled={busy}>Simulate payment</button></div>
        </div>
      </Dialog>

      <Dialog open={dialog === 'record'} onClose={() => setDialog('')} title="Record a payment">
        <form onSubmit={recordPayment} className="stack">
          <Alert>{recErr.form}</Alert>
          <p className="muted">Balance due {inr(balance)}. You can record a part payment and add the rest later.</p>
          <TextField label="Amount received" inputMode="decimal" value={rec.amount} onChange={(e) => setRec({ ...rec, amount: e.target.value })} error={recErr.amount} autoFocus />
          <TextField label="Bank reference or cheque number" value={rec.reference} onChange={(e) => setRec({ ...rec, reference: e.target.value })} error={recErr.reference} />
          <SelectField label="Method" value={rec.method} onChange={(e) => setRec({ ...rec, method: e.target.value })}><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option><option value="cash">Cash</option></SelectField>
          <div className="dialog__actions"><button type="button" className="btn btn--quiet" onClick={() => setDialog('')}>Back</button><button className="btn" disabled={busy}>Record payment</button></div>
        </form>
      </Dialog>
    </>
  );
}
