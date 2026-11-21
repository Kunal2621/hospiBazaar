import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api.js';
import { dateText, inr, label, useLoad } from '../../lib.js';
import { Alert, AreaField, Dialog, Loading, SelectField, TextField, useToast } from '../../components/ui.jsx';
import { Empty, Facts, PageHead, ReasonDialog, Stat, StateBadge } from '../../components/common.jsx';

/* ---------------- Overview ---------------- */
export function AdminHome() {
  const { data, error } = useLoad('/admin/stats');
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  return (
    <>
      <PageHead title="Overview" sub="What needs a decision today." />
      <div className="stats">
        <Stat to="/admin/suppliers" value={data.suppliers_pending} label="Suppliers to verify" hot />
        <Stat to="/admin/hospitals" value={data.hospitals_pending} label="Hospitals to verify" hot />
        <Stat to="/admin/products" value={data.products_pending} label="Products to approve" hot />
        <Stat to="/admin/manual" value={data.manual_requests_open} label="Manual order requests" hot />
        <Stat to="/admin/disputes" value={data.disputes_open} label="Open disputes" hot />
        <Stat to="/admin/payouts" value={data.payouts_ready} label={`Payouts ready (${inr(data.payouts_ready_amount)})`} hot />
        <Stat to="/admin/orders" value={data.orders_in_progress} label="Orders in progress" />
        <Stat value={inr(data.completed_value)} label="Completed order value" />
      </div>
    </>
  );
}

/* ---------------- Product approval ---------------- */
export function ProductApproval() {
  const [status, setStatus] = useState('pending_approval');
  const { data, error, reload } = useLoad(`/admin/products?status=${status}`);
  const [sel, setSel] = useState(null);
  return (
    <>
      <PageHead title="Product approval" sub="Check the listing and photos, then approve or send it back with a reason." />
      <div className="segmented" role="group" aria-label="Filter">{[['pending_approval', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Sent back']].map(([v, t]) => <button key={v} className="segmented__item" aria-pressed={status === v} onClick={() => { setStatus(v); setSel(null); }}>{t}</button>)}</div>
      <Alert>{error}</Alert>
      <div className="queue">
        <div>
          {!data && !error && <Loading />}
          {data && data.products.length === 0 && <Empty title="Nothing here" />}
          {data && data.products.length > 0 && <div className="queue__list">{data.products.map((p) => (
            <button key={p.id} className="queue__item" aria-current={sel === p.id} onClick={() => setSel(p.id)}>
              <span className="queue__name">{p.name}</span><span className="queue__meta">{p.company_name} · {p.category}</span><span className="queue__meta">{inr(p.unit_price)}</span>
            </button>))}</div>}
        </div>
        {sel ? <ProductReview key={sel} id={sel} onDone={() => { setSel(null); reload(); }} /> : <div className="review__empty">Select a product to review.</div>}
      </div>
    </>
  );
}

function ProductReview({ id, onDone }) {
  const { data, error } = useLoad(`/admin/products/${id}`);
  const toast = useToast();
  const [reject, setReject] = useState(false);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const p = data.product;
  const specs = typeof p.specifications === 'string' ? JSON.parse(p.specifications || '{}') : p.specifications || {};
  return (
    <div className="panel review">
      <div className="review__block"><h2 style={{ fontSize: '1.3rem' }}>{p.name}</h2><StateBadge status={p.status} /></div>
      {data.images.length > 0 && <div className="tag-list">{data.images.map((i) => <a key={i.image_url} href={i.image_url} target="_blank" rel="noreferrer"><img src={i.image_url} alt="" style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 6 }} /></a>)}</div>}
      <Facts rows={[['Supplier', p.company_name], ['Category', p.category], ['Model', p.model_number], ['Price', `${inr(p.unit_price)} + ${p.gst_rate}% GST`], ['HSN', p.hsn_code], ['Stock', label(p.stock_status)], ['Warranty', p.warranty_months ? `${p.warranty_months} months` : ''], ['Summary', p.short_description], ['Description', p.description],
        ...Object.entries(specs)]} />
      {data.documents.length > 0 && <div className="doc-list">{data.documents.map((d) => <div key={d.file_url} className="doc-list__item"><a className="doc-list__link" href={d.file_url} target="_blank" rel="noreferrer">{label(d.document_type)}</a></div>)}</div>}
      {p.status === 'pending_approval' && (
        <div className="review__actions">
          <button className="btn" onClick={() => api(`/admin/products/${id}/approve`, { method: 'POST' }).then(() => { toast('Product approved'); onDone(); }).catch((e) => toast(e.message, 'bad'))}>Approve</button>
          <button className="btn btn--quiet" onClick={() => setReject(true)}>Send back</button>
        </div>
      )}
      <ReasonDialog open={reject} onClose={() => setReject(false)} title="Send back to the supplier" prompt="What should they fix?" confirmText="Send back" onSubmit={(r) => api(`/admin/products/${id}/reject`, { method: 'POST', body: { reason: r } }).then(() => { toast('Sent back'); onDone(); })} />
    </div>
  );
}

/* ---------------- Manual orders ---------------- */
export function ManualOrders() {
  const [status, setStatus] = useState('');
  const { data, error, reload } = useLoad(`/admin/manual-requests${status ? `?status=${status}` : ''}`);
  const [convert, setConvert] = useState(null);
  const [custom, setCustom] = useState(false);
  const toast = useToast();
  const mark = (r, s) => api(`/admin/manual-requests/${r.id}`, { method: 'PATCH', body: { status: s } }).then(() => { toast('Updated'); reload(); }).catch((e) => toast(e.message, 'bad'));
  return (
    <>
      <PageHead title="Manual orders" sub="Orders above the online limit, and anything you arrange on a hospital's behalf."><button className="btn btn--small" onClick={() => setCustom(true)}><Plus size={16} aria-hidden /> Create an order</button></PageHead>
      <div className="segmented" role="group" aria-label="Filter">{[['', 'All'], ['new', 'New'], ['contacted', 'Contacted'], ['converted', 'Converted'], ['closed', 'Closed']].map(([v, t]) => <button key={v} className="segmented__item" aria-pressed={status === v} onClick={() => setStatus(v)}>{t}</button>)}</div>
      <Alert>{error}</Alert>
      {!data && !error && <Loading />}
      {data && data.requests.length === 0 && <Empty title="No requests">Requests appear when a cart or an accepted quotation is above the online limit.</Empty>}
      {data && data.requests.length > 0 && <div className="rowlist">{data.requests.map((r) => (
        <div key={r.id} className="rowlist__item">
          <span className="rowlist__title">{r.hospital_name}: {r.source === 'rfq' ? `from RFQ ${r.rfq_number}` : 'from a cart'}</span>
          <span className="rowlist__meta">{inr(r.total_amount)} · asked by {r.requested_by_name} · {dateText(r.created_at)}{r.admin_notes ? ` · ${r.admin_notes}` : ''}</span>
          <span className="rowlist__side"><StateBadge status={r.status} />
            {['new', 'contacted'].includes(r.status) && <span className="row" style={{ justifyContent: 'flex-end' }}>
              {r.status === 'new' && <button className="btn btn--quiet btn--small" onClick={() => mark(r, 'contacted')}>Mark contacted</button>}
              <button className="btn btn--small" onClick={() => setConvert(r)}>Create order</button>
              <button className="btn btn--quiet btn--small" onClick={() => mark(r, 'closed')}>Close</button></span>}
            {r.converted_order_id && <Link to={`/admin/orders/${r.converted_order_id}`} className="small">Open order</Link>}
          </span>
        </div>))}</div>}
      <ConvertDialog request={convert} onClose={() => setConvert(null)} onDone={() => { setConvert(null); reload(); }} />
      <CustomOrder open={custom} onClose={() => setCustom(false)} onDone={() => { setCustom(false); reload(); }} />
    </>
  );
}

function ConvertDialog({ request, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ freight: '0', installation: '0', service: '0', payment_terms: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function go(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api('/admin/orders', { method: 'POST', body: { manual_request_id: request.id, freight: Number(f.freight), installation: Number(f.installation), service: Number(f.service), payment_terms: f.payment_terms || undefined } }); toast(`${r.orders.length} order created. The hospital pays by bank transfer`); onDone(); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  const rfq = request?.source === 'rfq';
  return (
    <Dialog open={Boolean(request)} onClose={onClose} title="Create the order">
      <form className="stack" onSubmit={go}>
        <Alert>{err}</Alert>
        <p className="muted">{rfq ? 'The accepted quotation becomes the order, with its own charges and terms.' : 'One order is created for each supplier in the cart. Add any charges to include.'} It skips supplier confirmation and waits for a payment you record.</p>
        {!rfq && <div className="form-grid"><TextField label="Freight (₹)" inputMode="decimal" value={f.freight} onChange={(e) => setF({ ...f, freight: e.target.value })} /><TextField label="Installation (₹)" inputMode="decimal" value={f.installation} onChange={(e) => setF({ ...f, installation: e.target.value })} /><TextField label="Service (₹)" inputMode="decimal" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} /></div>}
        {!rfq && <TextField label="Payment terms" optional value={f.payment_terms} onChange={(e) => setF({ ...f, payment_terms: e.target.value })} />}
        <div className="dialog__actions"><button type="button" className="btn btn--quiet" onClick={onClose}>Back</button><button className="btn" disabled={busy}>Create order</button></div>
      </form>
    </Dialog>
  );
}

const blankItem = () => ({ key: Math.random(), item_name: '', model_number: '', quantity: '1', unit_price: '', gst_rate: '12', warranty_months: '12' });
function CustomOrder({ open, onClose, onDone }) {
  const { data: h } = useLoad(open ? '/admin/lookup/hospitals' : null);
  const { data: s } = useLoad(open ? '/admin/lookup/suppliers' : null);
  const toast = useToast();
  const [f, setF] = useState({ hospital_id: '', supplier_id: '', delivery_address: '', delivery_city: '', delivery_state: '', delivery_pincode: '', freight: '0', installation: '0', service: '0', installation_required: false, payment_terms: '' });
  const [items, setItems] = useState([blankItem()]);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setItem = (key, k, v) => setItems(items.map((i) => (i.key === key ? { ...i, [k]: v } : i)));
  async function go(e) {
    e.preventDefault(); setErrs({}); setBusy(true);
    try {
      await api('/admin/orders', { method: 'POST', body: { ...f, freight: Number(f.freight), installation: Number(f.installation), service: Number(f.service), items: items.map(({ key, ...i }) => ({ ...i, model_number: i.model_number || undefined })) } });
      toast('Order created'); onDone();
    } catch (err) { setErrs(err instanceof ApiError && Object.keys(err.fields).length ? err.fields : { form: err.message }); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Create an order">
      <form className="stack" onSubmit={go} noValidate>
        <Alert>{errs.form}</Alert>
        {!h || !s ? <Loading rows={2} /> : (
          <>
            <SelectField label="Hospital" value={f.hospital_id} onChange={set('hospital_id')} error={errs.hospital_id}><option value="">Choose</option>{h.hospitals.map((x) => <option key={x.id} value={x.id}>{x.hospital_name}, {x.city}</option>)}</SelectField>
            <SelectField label="Supplier" value={f.supplier_id} onChange={set('supplier_id')} error={errs.supplier_id}><option value="">Choose</option>{s.suppliers.map((x) => <option key={x.id} value={x.id}>{x.company_name}, {x.city}</option>)}</SelectField>
            {items.map((it, idx) => (
              <div key={it.key} className="item-card">
                <TextField label="Item" value={it.item_name} onChange={(e) => setItem(it.key, 'item_name', e.target.value)} error={errs[`items.${idx}.item_name`]} />
                <div className="form-grid"><TextField label="Quantity" inputMode="numeric" value={it.quantity} onChange={(e) => setItem(it.key, 'quantity', e.target.value)} /><TextField label="Unit price (₹)" inputMode="decimal" value={it.unit_price} onChange={(e) => setItem(it.key, 'unit_price', e.target.value)} error={errs[`items.${idx}.unit_price`]} /><TextField label="GST (%)" inputMode="decimal" value={it.gst_rate} onChange={(e) => setItem(it.key, 'gst_rate', e.target.value)} /><TextField label="Warranty (months)" inputMode="numeric" value={it.warranty_months} onChange={(e) => setItem(it.key, 'warranty_months', e.target.value)} /></div>
                {items.length > 1 && <div><button type="button" className="text-button small" onClick={() => setItems(items.filter((x) => x.key !== it.key))}><Trash2 size={14} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} /> Remove</button></div>}
              </div>))}
            <div><button type="button" className="btn btn--quiet btn--small" onClick={() => setItems([...items, blankItem()])}><Plus size={16} aria-hidden /> Add an item</button></div>
            <TextField label="Delivery address" value={f.delivery_address} onChange={set('delivery_address')} />
            <div className="form-grid"><TextField label="City" value={f.delivery_city} onChange={set('delivery_city')} /><TextField label="State" value={f.delivery_state} onChange={set('delivery_state')} /><TextField label="Pincode" inputMode="numeric" value={f.delivery_pincode} onChange={set('delivery_pincode')} error={errs.delivery_pincode} /></div>
            <div className="form-grid"><TextField label="Freight (₹)" inputMode="decimal" value={f.freight} onChange={set('freight')} /><TextField label="Installation (₹)" inputMode="decimal" value={f.installation} onChange={set('installation')} /><TextField label="Service (₹)" inputMode="decimal" value={f.service} onChange={set('service')} /></div>
            <label className="check"><input type="checkbox" checked={f.installation_required} onChange={(e) => setF({ ...f, installation_required: e.target.checked })} /><span>Installation needed</span></label>
          </>
        )}
        <div className="dialog__actions"><button type="button" className="btn btn--quiet" onClick={onClose}>Back</button><button className="btn" disabled={busy || !h || !s}>Create order</button></div>
      </form>
    </Dialog>
  );
}

/* ---------------- Payouts ---------------- */
export function Payouts() {
  const [status, setStatus] = useState('eligible');
  const { data, error, reload } = useLoad(`/admin/payouts?status=${status}`);
  const [sel, setSel] = useState(null);
  const [ref, setRef] = useState('');
  const [err, setErr] = useState('');
  const toast = useToast();
  async function release(e) {
    e.preventDefault(); setErr('');
    try { await api(`/admin/payouts/${sel.id}/release`, { method: 'POST', body: { bank_reference: ref } }); toast('Payout released'); setSel(null); reload(); } catch (e2) { setErr(e2.fields?.bank_reference || e2.message); }
  }
  return (
    <>
      <PageHead title="Supplier payouts" sub="Funds are held until the hospital confirms delivery. Pay the supplier from your bank, then record the reference here." />
      <div className="segmented" role="group" aria-label="Filter">{[['eligible', 'Ready to release'], ['held', 'On hold'], ['released', 'Released'], ['reversed', 'Reversed']].map(([v, t]) => <button key={v} className="segmented__item" aria-pressed={status === v} onClick={() => setStatus(v)}>{t}</button>)}</div>
      <Alert>{error}</Alert>
      {!data && !error && <Loading />}
      {data && data.payouts.length === 0 && <Empty title="Nothing here" />}
      {data && data.payouts.length > 0 && <div className="table-wrap"><table className="table"><thead><tr><th>Order</th><th>Supplier and bank account</th><th className="is-num">Order total</th><th className="is-num">Fee</th><th className="is-num">Pay supplier</th><th /></tr></thead>
        <tbody>{data.payouts.map((p) => (
          <tr key={p.id}><td><Link to={`/admin/orders/${p.order_id}`}>{p.order_number}</Link></td>
            <td>{p.company_name}<span className="muted small"><br />{p.account_holder_name}, {p.account_number}, {p.ifsc}</span></td>
            <td className="is-num">{inr(p.gross_amount)}</td><td className="is-num">{inr(p.platform_fee)}</td><td className="is-num"><strong>{inr(p.net_amount)}</strong></td>
            <td className="is-num">{p.status === 'eligible' ? <button className="btn btn--small" onClick={() => { setSel(p); setRef(''); setErr(''); }}>Release</button> : <span className="muted small">{p.bank_reference || label(p.status)}</span>}</td></tr>))}</tbody></table></div>}
      <Dialog open={Boolean(sel)} onClose={() => setSel(null)} title="Release payout">
        <form className="stack" onSubmit={release}>
          <p>Pay <strong className="num">{inr(sel?.net_amount)}</strong> to {sel?.company_name}, then enter the bank reference.</p>
          <TextField label="Bank reference (UTR)" value={ref} onChange={(e) => setRef(e.target.value)} error={err} autoFocus />
          <div className="dialog__actions"><button type="button" className="btn btn--quiet" onClick={() => setSel(null)}>Back</button><button className="btn">Mark as released</button></div>
        </form>
      </Dialog>
    </>
  );
}

/* ---------------- Disputes ---------------- */
export function Disputes() {
  const [status, setStatus] = useState('open');
  const { data, error, reload } = useLoad(`/admin/disputes?status=${status}`);
  const [sel, setSel] = useState(null);
  const [resolution, setResolution] = useState('release');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const toast = useToast();
  async function go(e) {
    e.preventDefault(); setErr('');
    try { await api(`/admin/disputes/${sel.id}/resolve`, { method: 'POST', body: { resolution, note } }); toast('Dispute resolved'); setSel(null); reload(); } catch (e2) { setErr(e2.fields?.note || e2.message); }
  }
  return (
    <>
      <PageHead title="Disputes" sub="A dispute holds the supplier payout until you decide." />
      <div className="segmented" role="group" aria-label="Filter">{[['open', 'Open'], ['resolved_release', 'Released'], ['resolved_refund', 'Refunded'], ['closed', 'Closed']].map(([v, t]) => <button key={v} className="segmented__item" aria-pressed={status === v} onClick={() => setStatus(v)}>{t}</button>)}</div>
      <Alert>{error}</Alert>
      {!data && !error && <Loading />}
      {data && data.disputes.length === 0 && <Empty title="No disputes here" />}
      {data && data.disputes.length > 0 && <div className="rowlist">{data.disputes.map((d) => (
        <div key={d.id} className="rowlist__item">
          <span className="rowlist__title"><Link to={`/admin/orders/${d.order_id}`}>{d.order_number}</Link>: {d.hospital_name} and {d.company_name}</span>
          <span className="rowlist__meta">{inr(d.total_amount)} · {dateText(d.created_at)} · “{d.reason}”{d.resolution_note ? ` Decision: ${d.resolution_note}` : ''}</span>
          <span className="rowlist__side"><StateBadge status={d.status} />{d.status === 'open' && <button className="btn btn--small" onClick={() => { setSel(d); setResolution('release'); setNote(''); setErr(''); }}>Decide</button>}</span>
        </div>))}</div>}
      <Dialog open={Boolean(sel)} onClose={() => setSel(null)} title={`Decide ${sel?.order_number || ''}`}>
        <form className="stack" onSubmit={go}>
          <p className="muted">“{sel?.reason}”</p>
          <SelectField label="Outcome" value={resolution} onChange={(e) => setResolution(e.target.value)}>
            <option value="release">Supplier is right: complete the order and make the payout ready</option>
            <option value="refund">Hospital is right: refund the payment and cancel the order</option>
            <option value="close">Close with no change: the order continues as it was</option>
          </SelectField>
          <AreaField label="Note for both sides" value={note} onChange={(e) => setNote(e.target.value)} error={err} />
          <div className="dialog__actions"><button type="button" className="btn btn--quiet" onClick={() => setSel(null)}>Back</button><button className={`btn${resolution === 'refund' ? ' btn--danger' : ''}`}>Save decision</button></div>
        </form>
      </Dialog>
    </>
  );
}

/* ---------------- Settings ---------------- */
export function PlatformSettings() {
  const { data, error, reload } = useLoad('/admin/settings');
  const toast = useToast();
  const [vals, setVals] = useState({});
  const [errs, setErrs] = useState({});
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  async function save(k) {
    setErrs({ ...errs, [k]: '' });
    try { await api(`/admin/settings/${k}`, { method: 'PUT', body: { value: vals[k] } }); toast('Saved'); setVals((v) => { const { [k]: _, ...rest } = v; return rest; }); reload(); }
    catch (e) { setErrs((x) => ({ ...x, [k]: e.message })); }
  }
  return (
    <>
      <PageHead title="Settings" sub="Business rules. Changes apply within a few seconds, no restart needed." />
      <div className="rowlist">{data.settings.map((s) => (
        <div key={s.setting_key} className="rowlist__item" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(10rem, 16rem) auto', alignItems: 'end' }}>
          <div><div className="rowlist__title">{label(s.setting_key)}</div><div className="rowlist__meta">{s.description}</div></div>
          <TextField label="Value" value={vals[s.setting_key] ?? s.setting_value} onChange={(e) => setVals({ ...vals, [s.setting_key]: e.target.value })} error={errs[s.setting_key]} />
          <button className="btn btn--small" disabled={vals[s.setting_key] === undefined || vals[s.setting_key] === s.setting_value} onClick={() => save(s.setting_key)}>Save</button>
        </div>))}</div>
    </>
  );
}
