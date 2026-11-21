import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api.js';
import { dateText, inr, useLoad } from '../../lib.js';
import { Alert, AreaField, Loading, TextField, focusFirstError, useToast } from '../../components/ui.jsx';
import { Empty, Facts, PageHead, ReasonDialog, StateBadge } from '../../components/common.jsx';

export function SupplierRfqList() {
  const { data, error } = useLoad('/supplier/rfqs');
  return (
    <>
      <PageHead title="RFQs and quotations" sub="Requests from hospitals that match what you supply." />
      <Alert>{error}</Alert>
      {!data && !error && <Loading />}
      {data && data.rfqs.length === 0 && <Empty title="No RFQs yet">RFQs for your categories appear here as soon as hospitals send them.</Empty>}
      {data && data.rfqs.length > 0 && (
        <div className="rowlist">{data.rfqs.map((r) => (
          <Link key={r.id} to={`/supplier/rfqs/${r.id}`} className="rowlist__item">
            <span className="rowlist__title">{r.rfq_number}: {r.title}</span>
            <span className="rowlist__meta">{r.hospital_name} · {r.item_count} items · deliver to {r.delivery_city} · quotes due {dateText(r.quotes_due_by)}</span>
            <span className="rowlist__side">
              {r.quotation_id ? <><StateBadge status={r.quotation_status} /><span className="num small">{inr(r.total_amount)}</span></> : <StateBadge status={r.my_status === 'declined' ? 'declined' : r.status === 'open' ? 'new' : r.status} />}
            </span>
          </Link>
        ))}</div>
      )}
    </>
  );
}

export function SupplierRfqDetail() {
  const { id } = useParams();
  const { data, error, reload } = useLoad(`/supplier/rfqs/${id}`);
  const toast = useToast();
  const [decline, setDecline] = useState(false);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const { rfq, items, quotation } = data;
  const open = ['open', 'quotes_received'].includes(rfq.status);
  const editable = open && rfq.my_status !== 'declined' && (!quotation || quotation.status === 'submitted' || quotation.status === 'withdrawn');

  return (
    <>
      <PageHead title={rfq.rfq_number} sub={rfq.title}><StateBadge status={rfq.status} /></PageHead>
      <Link to="/supplier/rfqs" className="small">Back to RFQs</Link>
      {!open && <Alert kind="info">This RFQ is {rfq.status.replace('_', ' ')}. You can no longer send a quotation.</Alert>}
      {quotation && quotation.status === 'accepted' && <Alert kind="info">Your quotation was accepted. Look for the new order under Orders.</Alert>}
      {quotation && quotation.status === 'rejected' && <Alert kind="warn">The hospital chose another supplier.</Alert>}
      <section className="panel">
        <Facts rows={[['Hospital', `${rfq.hospital_name}`], ['Deliver to', `${rfq.delivery_address || ''}, ${rfq.delivery_city}, ${rfq.delivery_state} ${rfq.delivery_pincode}`], ['Quotes due', dateText(rfq.quotes_due_by)],
          ['Needed within', rfq.required_within_days ? `${rfq.required_within_days} days` : ''], ['Warranty wanted', rfq.warranty_years_required ? `${rfq.warranty_years_required} years` : ''], ['Installation', rfq.installation_required ? 'Needed' : 'Not needed'], ['Notes', rfq.notes]]} />
      </section>
      {editable ? <QuoteForm rfqId={id} items={items} existing={quotation && quotation.status === 'submitted' ? quotation : null} onDone={() => { toast('Quotation sent'); reload(); }} onDecline={() => setDecline(true)} canDecline={!quotation || quotation.status !== 'submitted'} /> : quotation && <QuoteView q={quotation} items={items} />}
      {quotation && quotation.status === 'submitted' && open && <div><button className="btn btn--quiet" onClick={() => api(`/supplier/rfqs/${id}/withdraw`, { method: 'POST' }).then(() => { toast('Quotation withdrawn'); reload(); }).catch((e) => toast(e.message, 'bad'))}>Withdraw my quotation</button></div>}
      <ReasonDialog open={decline} onClose={() => setDecline(false)} title="Decline this RFQ" prompt="Reason (optional)" minLength={0} confirmText="Decline RFQ" onSubmit={() => api(`/supplier/rfqs/${id}/decline`, { method: 'POST' }).then(() => { toast('RFQ declined'); reload(); })} />
    </>
  );
}

function QuoteView({ q, items }) {
  return (
    <section className="panel"><h2 style={{ fontSize: '1.15rem' }}>Your quotation</h2>
      <div className="table-wrap"><table className="table"><thead><tr><th>Item</th><th className="is-num">Unit price</th><th className="is-num">GST</th></tr></thead>
        <tbody>{items.map((i) => { const c = q.items?.find((x) => x.rfq_item_id === i.id); return <tr key={i.id}><td>{i.item_name} × {i.quantity}</td><td className="is-num">{c ? inr(c.unit_price) : '—'}</td><td className="is-num">{c ? `${c.gst_rate}%` : ''}</td></tr>; })}</tbody></table></div>
      <p className="num"><strong>Total {inr(q.total_amount)}</strong></p>
    </section>
  );
}

function QuoteForm({ rfqId, items, existing, onDone, onDecline, canDecline }) {
  const plus7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const [f, setF] = useState({
    freight_charge: existing ? String(existing.freight_charge) : '0', installation_charge: existing ? String(existing.installation_charge) : '0', service_charge: existing ? String(existing.service_charge) : '0',
    warranty_months: existing?.warranty_months ? String(existing.warranty_months) : '12', delivery_days: existing ? String(existing.delivery_days) : '', valid_until: existing ? String(existing.valid_until).slice(0, 10) : plus7,
    payment_terms: existing?.payment_terms || '', service_terms: existing?.service_terms || '', notes: existing?.notes || '',
  });
  const [rows, setRows] = useState(items.map((i) => { const c = existing?.items?.find((x) => x.rfq_item_id === i.id); return { rfq_item_id: i.id, unit_price: c ? String(c.unit_price) : '', gst_rate: c ? String(c.gst_rate) : '12', brand_model: c?.brand_model || '' }; }));
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setRow = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const goods = rows.reduce((s, r, i) => s + (Number(r.unit_price) || 0) * items[i].quantity, 0);
  const gst = rows.reduce((s, r, i) => s + ((Number(r.unit_price) || 0) * items[i].quantity * (Number(r.gst_rate) || 0)) / 100, 0);
  const extras = (Number(f.freight_charge) || 0) + (Number(f.installation_charge) || 0) + (Number(f.service_charge) || 0);

  async function submit(e) {
    e.preventDefault(); setErrs({}); setBusy(true);
    try { await api(`/supplier/rfqs/${rfqId}/quote`, { method: 'POST', body: { ...f, items: rows.map((r) => ({ ...r, brand_model: r.brand_model || undefined })) } }); onDone(); }
    catch (err) { setErrs(err instanceof ApiError && Object.keys(err.fields).length ? err.fields : { form: err.message }); focusFirstError(); } finally { setBusy(false); }
  }

  return (
    <form className="stack stack--lg" onSubmit={submit} noValidate>
      <Alert>{errs.form}</Alert>
      <section className="panel">
        <h2 style={{ fontSize: '1.15rem' }}>{existing ? 'Update your quotation' : 'Your quotation'}</h2>
        <p className="muted">Price every item, per unit, before GST.</p>
        {items.map((i, idx) => (
          <div key={i.id} className="item-card">
            <div><strong>{i.item_name}</strong> × {i.quantity}{i.specifications && <span className="muted small"><br />{i.specifications}</span>}</div>
            <div className="form-grid">
              <TextField label="Unit price (₹)" inputMode="decimal" value={rows[idx].unit_price} onChange={(e) => setRow(idx, 'unit_price', e.target.value)} error={errs[`items.${idx}.unit_price`]} />
              <TextField label="GST rate (%)" inputMode="decimal" value={rows[idx].gst_rate} onChange={(e) => setRow(idx, 'gst_rate', e.target.value)} error={errs[`items.${idx}.gst_rate`]} />
              <TextField label="Brand and model" optional value={rows[idx].brand_model} onChange={(e) => setRow(idx, 'brand_model', e.target.value)} />
            </div>
          </div>
        ))}
        {errs.items && <span className="field__error">{errs.items}</span>}
      </section>
      <section className="panel">
        <h2 style={{ fontSize: '1.15rem' }}>Charges and terms</h2>
        <div className="form-grid">
          <TextField label="Freight (₹, GST included)" inputMode="decimal" value={f.freight_charge} onChange={set('freight_charge')} error={errs.freight_charge} />
          <TextField label="Installation (₹, GST included)" inputMode="decimal" value={f.installation_charge} onChange={set('installation_charge')} error={errs.installation_charge} />
          <TextField label="Service (₹, GST included)" inputMode="decimal" value={f.service_charge} onChange={set('service_charge')} error={errs.service_charge} />
          <TextField label="Delivery time (days)" inputMode="numeric" value={f.delivery_days} onChange={set('delivery_days')} error={errs.delivery_days} />
          <TextField label="Warranty (months)" optional inputMode="numeric" value={f.warranty_months} onChange={set('warranty_months')} error={errs.warranty_months} />
          <TextField label="Quotation valid until" type="date" value={f.valid_until} onChange={set('valid_until')} error={errs.valid_until} />
        </div>
        <TextField label="Payment terms" optional value={f.payment_terms} onChange={set('payment_terms')} />
        <AreaField label="Service terms" optional value={f.service_terms} onChange={set('service_terms')} />
        <AreaField label="Notes for the hospital" optional value={f.notes} onChange={set('notes')} />
      </section>
      <div className="totals num">
        <div className="totals__row"><span>Goods</span><span>{inr(goods)}</span></div>
        <div className="totals__row"><span>GST on goods</span><span>{inr(gst)}</span></div>
        <div className="totals__row"><span>Charges</span><span>{inr(extras)}</span></div>
        <div className="totals__row totals__row--grand"><span>Total</span><span>{inr(goods + gst + extras)}</span></div>
      </div>
      <div className="row"><button className="btn" disabled={busy}>{busy ? 'Sending…' : existing ? 'Update quotation' : 'Send quotation'}</button>{canDecline && <button type="button" className="btn btn--quiet" onClick={onDecline}>Not for us</button>}</div>
    </form>
  );
}
