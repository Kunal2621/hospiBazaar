import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api.js';
import { dateText, inr, label, useLoad } from '../../lib.js';
import { Alert, AreaField, CheckField, Loading, SelectField, TextField, focusFirstError, useToast } from '../../components/ui.jsx';
import { Empty, Facts, PageHead, ReasonDialog, StateBadge } from '../../components/common.jsx';

export function RfqList() {
  const { data, error } = useLoad('/rfqs');
  return (
    <>
      <PageHead title="RFQs and quotations" sub="Describe what you need. Verified suppliers send quotations you can compare."><Link className="btn btn--small" to="/hospital/rfqs/new">New RFQ</Link></PageHead>
      <Alert>{error}</Alert>
      {!data && !error && <Loading />}
      {data && data.rfqs.length === 0 && <Empty title="No RFQs yet">Use an RFQ for bulk or custom needs. For a single catalogue item, the marketplace is quicker.</Empty>}
      {data && data.rfqs.length > 0 && (
        <div className="rowlist">{data.rfqs.map((r) => (
          <Link key={r.id} to={`/hospital/rfqs/${r.id}`} className="rowlist__item">
            <span className="rowlist__title">{r.rfq_number}: {r.title}</span>
            <span className="rowlist__meta">{r.item_count} {r.item_count === 1 ? 'item' : 'items'} · sent to {r.recipient_count} suppliers · {r.quotation_count} {r.quotation_count === 1 ? 'quotation' : 'quotations'} · {dateText(r.created_at)}</span>
            <span className="rowlist__side"><StateBadge status={r.status} /></span>
          </Link>
        ))}</div>
      )}
    </>
  );
}

const newItem = (over = {}) => ({ key: Math.random(), category_id: '', product_id: '', item_name: '', quantity: '1', specifications: '', ...over });

export function RfqNew() {
  const [params] = useSearchParams();
  const { data: cats } = useLoad('/categories');
  const navigate = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ title: '', delivery_address: '', delivery_city: '', delivery_state: '', delivery_pincode: '', required_within_days: '', warranty_years_required: '', installation_required: false, notes: '', quotes_due_days: '' });
  const [items, setItems] = useState([newItem(params.get('product') ? { product_id: params.get('product'), category_id: params.get('category') || '', item_name: params.get('name') || '', quantity: params.get('qty') || '1' } : {})]);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  if (!cats) return <Loading />;
  const subs = cats.categories.flatMap((g) => g.children.map((c) => ({ ...c, group: g.name })));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setItem = (key, k, v) => setItems(items.map((i) => (i.key === key ? { ...i, [k]: v } : i)));

  async function submit(e) {
    e.preventDefault(); setErrs({}); setBusy(true);
    try {
      const body = { ...f, installation_required: f.installation_required, items: items.map(({ key, ...i }) => ({ ...i, product_id: i.product_id || undefined })) };
      const r = await api('/rfqs', { method: 'POST', body });
      toast(`RFQ sent to ${r.recipients ?? 'matching'} suppliers`); navigate(`/hospital/rfqs/${r.id}`);
    } catch (err) { setErrs(err instanceof ApiError && Object.keys(err.fields).length ? err.fields : { form: err.message }); focusFirstError(); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHead title="New RFQ" sub="The more specific you are, the better the quotations." />
      <form className="stack stack--lg" onSubmit={submit} noValidate>
        <Alert>{errs.form}</Alert>
        <section className="panel">
          <h2 style={{ fontSize: '1.15rem' }}>What you need</h2>
          <TextField label="Title" value={f.title} onChange={set('title')} error={errs.title} placeholder="ICU beds for the new wing" />
          <div className="items-edit">
            {items.map((it, idx) => (
              <div key={it.key} className="item-card">
                <div className="form-grid">
                  <SelectField label="Category" value={it.category_id} onChange={(e) => setItem(it.key, 'category_id', e.target.value)} error={errs[`items.${idx}.category_id`]}>
                    <option value="">Choose</option>
                    {cats.categories.map((g) => <optgroup key={g.id} label={g.name}>{g.children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
                  </SelectField>
                  <TextField label="Item" value={it.item_name} onChange={(e) => setItem(it.key, 'item_name', e.target.value)} error={errs[`items.${idx}.item_name`]} />
                  <TextField label="Quantity" inputMode="numeric" value={it.quantity} onChange={(e) => setItem(it.key, 'quantity', e.target.value.replace(/\D/g, ''))} error={errs[`items.${idx}.quantity`]} />
                </div>
                <AreaField label="Specifications" optional value={it.specifications} onChange={(e) => setItem(it.key, 'specifications', e.target.value)} hint="Size, features, standards, brand preferences" />
                {items.length > 1 && <div><button type="button" className="text-button small" onClick={() => setItems(items.filter((x) => x.key !== it.key))}><Trash2 size={14} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} /> Remove item</button></div>}
              </div>
            ))}
          </div>
          {errs.items && <span className="field__error">{errs.items}</span>}
          <div><button type="button" className="btn btn--quiet btn--small" onClick={() => setItems([...items, newItem()])}><Plus size={16} aria-hidden /> Add another item</button></div>
        </section>

        <section className="panel">
          <h2 style={{ fontSize: '1.15rem' }}>Delivery and terms</h2>
          <div className="form-grid">
            <div style={{ gridColumn: '1 / -1' }}><TextField label="Delivery address" value={f.delivery_address} onChange={set('delivery_address')} error={errs.delivery_address} /></div>
            <TextField label="City" value={f.delivery_city} onChange={set('delivery_city')} error={errs.delivery_city} />
            <TextField label="State" value={f.delivery_state} onChange={set('delivery_state')} error={errs.delivery_state} />
            <TextField label="Pincode" inputMode="numeric" maxLength={6} value={f.delivery_pincode} onChange={set('delivery_pincode')} error={errs.delivery_pincode} />
            <TextField label="Needed within (days)" optional inputMode="numeric" value={f.required_within_days} onChange={set('required_within_days')} error={errs.required_within_days} />
            <TextField label="Warranty needed (years)" optional inputMode="decimal" value={f.warranty_years_required} onChange={set('warranty_years_required')} error={errs.warranty_years_required} />
            <TextField label="Quotes due in (days)" optional inputMode="numeric" value={f.quotes_due_days} onChange={set('quotes_due_days')} error={errs.quotes_due_days} hint="Default is 7 days" />
          </div>
          <CheckField checked={f.installation_required} onChange={(e) => setF({ ...f, installation_required: e.target.checked })}>Installation needed</CheckField>
          <AreaField label="Notes for suppliers" optional value={f.notes} onChange={set('notes')} />
        </section>
        <div><button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send RFQ to suppliers'}</button></div>
      </form>
    </>
  );
}

export function RfqDetail() {
  const { id } = useParams();
  const { data, error, reload } = useLoad(`/rfqs/${id}`);
  const toast = useToast();
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [manual, setManual] = useState('');
  const navigate = useNavigate();
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const { rfq, items, quotations, recipients } = data;
  const live = quotations.filter((q) => q.status === 'submitted' && !q.expired);
  const lowest = live.length ? Math.min(...live.map((q) => q.total_amount)) : null;
  const canAward = ['open', 'quotes_received'].includes(rfq.status);

  async function accept(q) {
    setBusy(true); setProblem('');
    try {
      const r = await api(`/rfqs/${id}/accept`, { method: 'POST', body: { quotation_id: q.id } });
      if (r.manual) { setManual(r.message); await reload(); return; }
      toast('Order placed'); navigate(`/hospital/orders/${r.order.id}`);
    } catch (e) { setProblem(e.message); } finally { setBusy(false); }
  }

  const cell = (q, i) => q.items.find((x) => x.rfq_item_id === i.id);
  return (
    <>
      <PageHead title={rfq.rfq_number} sub={rfq.title}><StateBadge status={rfq.status} /></PageHead>
      <Link to="/hospital/rfqs" className="small">Back to RFQs</Link>
      <Alert>{problem}</Alert>
      {manual && <Alert kind="info">{manual}</Alert>}
      {data.manual_request && !manual && <Alert kind="info">This quotation is above the online order limit. Our team is arranging the order with you.</Alert>}
      {data.order && <Alert kind="info">An order was placed from this RFQ. <Link to={`/hospital/orders/${data.order.id}`}>Open {data.order.order_number}</Link></Alert>}

      <section className="panel">
        <Facts rows={[['Sent to', `${recipients.sent} suppliers (${recipients.viewed} viewed, ${recipients.quoted} quoted, ${recipients.declined} declined)`], ['Quotes due', dateText(rfq.quotes_due_by)], ['Deliver to', `${rfq.delivery_address || ''}, ${rfq.delivery_city}, ${rfq.delivery_state} ${rfq.delivery_pincode}`],
          ['Needed within', rfq.required_within_days ? `${rfq.required_within_days} days` : ''], ['Warranty', rfq.warranty_years_required ? `${rfq.warranty_years_required} years` : ''], ['Installation', rfq.installation_required ? 'Needed' : 'Not needed'], ['Notes', rfq.notes]]} />
        <div className="table-wrap"><table className="table"><thead><tr><th>Item</th><th>Category</th><th className="is-num">Quantity</th></tr></thead>
          <tbody>{items.map((i) => <tr key={i.id}><td>{i.item_name}{i.specifications && <span className="muted small"><br />{i.specifications}</span>}</td><td>{i.category_name}</td><td className="is-num">{i.quantity}</td></tr>)}</tbody></table></div>
      </section>

      <section className="stack">
        <h2 style={{ fontSize: '1.3rem' }}>Quotations</h2>
        {quotations.length === 0 ? <Empty title="No quotations yet">Suppliers have until {dateText(rfq.quotes_due_by)} to respond. You will be notified for each one.</Empty> : (
          <div className="compare"><table>
            <thead><tr><th>Compare</th>{quotations.map((q) => <th key={q.id}>{q.company_name}<span className="rfq__who">{q.supplier_city}</span>{q.status !== 'submitted' && <StateBadge status={q.status} />}</th>)}</tr></thead>
            <tbody>
              {items.map((i) => <tr key={i.id}><td>{i.item_name} × {i.quantity}</td>{quotations.map((q) => { const c = cell(q, i); return <td key={q.id}>{c ? <>{inr(c.unit_price)}<span className="rfq__who">{c.brand_model}</span></> : '—'}</td>; })}</tr>)}
              <tr><td>Freight, installation and service</td>{quotations.map((q) => <td key={q.id} className="num">{inr(q.freight_charge + q.installation_charge + q.service_charge)}</td>)}</tr>
              <tr><td>Delivery time</td>{quotations.map((q) => <td key={q.id}>{q.delivery_days} days</td>)}</tr>
              <tr><td>Warranty</td>{quotations.map((q) => <td key={q.id}>{q.warranty_months ? `${q.warranty_months} months` : '—'}</td>)}</tr>
              <tr><td>Payment terms</td>{quotations.map((q) => <td key={q.id}>{q.payment_terms || '—'}</td>)}</tr>
              <tr><td>Valid until</td>{quotations.map((q) => <td key={q.id}>{dateText(q.valid_until)}{q.expired ? ' (expired)' : ''}</td>)}</tr>
              <tr><td><strong>Total with GST</strong></td>{quotations.map((q) => <td key={q.id} className={q.total_amount === lowest && live.includes(q) ? 'is-best num' : 'num'}><strong>{inr(q.total_amount)}</strong>{q.total_amount === lowest && live.includes(q) && live.length > 1 ? <span className="rfq__who">Lowest</span> : null}</td>)}</tr>
              {canAward && <tr><td />{quotations.map((q) => <td key={q.id}>{q.status === 'submitted' && !q.expired ? <button className="btn btn--small" disabled={busy} onClick={() => accept(q)}>Accept</button> : null}</td>)}</tr>}
            </tbody>
          </table></div>
        )}
        {quotations.some((q) => q.notes || q.service_terms) && quotations.filter((q) => q.notes || q.service_terms).map((q) => <p key={q.id} className="small"><strong>{q.company_name}:</strong> {[q.notes, q.service_terms && `Service terms: ${q.service_terms}`].filter(Boolean).join(' ')}</p>)}
        {canAward && <p className="muted small">Orders above {inr(data.online_order_cap)} are arranged with our team instead of being paid online.</p>}
      </section>

      {canAward && <div><button className="btn btn--quiet" onClick={() => setCancel(true)}>Cancel this RFQ</button></div>}
      <ReasonDialog open={cancel} onClose={() => setCancel(false)} title="Cancel this RFQ" prompt="Reason (optional)" minLength={0} confirmText="Cancel RFQ" danger onSubmit={() => api(`/rfqs/${id}/cancel`, { method: 'POST' }).then(() => { toast('RFQ cancelled'); reload(); })} />
    </>
  );
}
