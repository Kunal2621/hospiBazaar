import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ImageOff, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api.js';
import { dateTimeText, inr, useLoad } from '../../lib.js';
import { Alert, CheckField, Loading, TextField, focusFirstError, useToast } from '../../components/ui.jsx';
import { Empty, PageHead } from '../../components/common.jsx';

const BLANK = { delivery_address: '', delivery_city: '', delivery_state: '', delivery_pincode: '', installation_required: false };

export default function Cart() {
  const { data, error, reload } = useLoad('/cart');
  const toast = useToast();
  const navigate = useNavigate();
  const [f, setF] = useState(BLANK);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(null);
  const [gate, setGate] = useState(false);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;

  async function setQty(line, quantity) {
    try { await api(`/cart/items/${line.id}`, { method: 'PATCH', body: { quantity } }); await reload(); } catch (e) { toast(e.message, 'bad'); }
  }
  async function remove(line) { await api(`/cart/items/${line.id}`, { method: 'DELETE' }); await reload(); }

  async function checkout(e) {
    e.preventDefault(); setErrs({}); setGate(false); setBusy(true);
    try {
      const r = await api('/cart/checkout', { method: 'POST', body: f });
      if (r.manual) { setManual(r); await reload(); return; }
      toast(r.orders.length > 1 ? `${r.orders.length} orders placed, one for each supplier` : 'Order placed');
      navigate(r.orders.length === 1 ? `/hospital/orders/${r.orders[0].id}` : '/hospital/orders');
    } catch (err) {
      if (err instanceof ApiError && err.details?.code === 'HOSPITAL_NOT_VERIFIED') setGate(true);
      else setErrs(err instanceof ApiError && Object.keys(err.fields).length ? err.fields : { form: err.message });
      focusFirstError();
    } finally { setBusy(false); }
  }

  if (manual) {
    return (
      <>
        <PageHead title="We have your request" />
        <Alert kind="info">{manual.message}</Alert>
        <p>Our team will contact you to arrange the order and payment. You can follow updates under Orders once it is created.</p>
        <div><Link className="btn" to="/marketplace">Keep browsing</Link></div>
      </>
    );
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (data.items.length === 0) {
    return (
      <>
        <PageHead title="Cart" />
        <Empty title="Your cart is empty" action={<Link className="btn btn--small" to="/marketplace">Browse products</Link>}>Add products from the marketplace, or negotiate a price first.</Empty>
      </>
    );
  }

  return (
    <>
      <PageHead title="Cart" sub="Orders are split by supplier. Each supplier confirms its own order." />
      {data.items.some((i) => i.price_reverted) && <Alert kind="warn">The price hold on a negotiated item ended, so it is back at the listed price.</Alert>}
      <div className="rowlist">
        {data.items.map((i) => (
          <div key={i.id} className="cart-line">
            <div className="cart-line__img">{i.image_url ? <img src={i.image_url} alt="" /> : <ImageOff size={20} aria-hidden />}</div>
            <div className="stack" style={{ gap: '0.15rem' }}>
              <Link to={`/products/${i.slug}`} className="rowlist__title">{i.name}</Link>
              <span className="muted small">{i.supplier_name} · {inr(i.unit_price)} + {i.gst_rate}% GST</span>
              {i.negotiation_id && <span className="badge badge--ok" style={{ justifySelf: 'start' }}>Negotiated price{i.price_locked_until ? `, held until ${dateTimeText(i.price_locked_until)}` : ''}</span>}
              {!i.available && <span className="field__error">No longer available. Remove it to continue.</span>}
            </div>
            <div className="stack" style={{ justifyItems: 'end', gap: '0.4rem' }}>
              <div className="qty">
                {i.negotiation_id ? <span className="muted small">Quantity {i.quantity}, fixed</span> : (
                  <input className="input" type="number" min={i.min_order_qty} defaultValue={i.quantity} aria-label={`Quantity for ${i.name}`} onBlur={(e) => { const v = Number(e.target.value); if (v && v !== i.quantity) setQty(i, v); }} />
                )}
              </div>
              <strong className="num">{inr(i.line_subtotal)}</strong>
              <button className="text-button small" onClick={() => remove(i)}><Trash2 size={14} aria-hidden style={{ display: 'inline', verticalAlign: '-2px' }} /> Remove</button>
            </div>
          </div>
        ))}
      </div>
      <div className="totals num">
        <div className="totals__row"><span>Goods</span><span>{inr(data.subtotal)}</span></div>
        <div className="totals__row"><span>GST</span><span>{inr(data.gst_total)}</span></div>
        <div className="totals__row totals__row--grand"><span>Total</span><span>{inr(data.total)}</span></div>
      </div>

      {data.over_cap && <Alert kind="warn">{data.cap_message} Your total is above {inr(data.online_order_cap)}, so our team will arrange this order with you after you send the request.</Alert>}
      {gate && <Alert kind="warn">Your hospital needs to be verified before the first order. <Link to="/hospital">Request verification</Link>. You can keep this cart.</Alert>}

      <form className="panel" onSubmit={checkout}>
        <h2 style={{ fontSize: '1.2rem' }}>Delivery</h2>
        <Alert>{errs.form}</Alert>
        <div className="form-grid">
          <div style={{ gridColumn: '1 / -1' }}><TextField label="Address" value={f.delivery_address} onChange={set('delivery_address')} error={errs.delivery_address} autoComplete="street-address" /></div>
          <TextField label="City" value={f.delivery_city} onChange={set('delivery_city')} error={errs.delivery_city} />
          <TextField label="State" value={f.delivery_state} onChange={set('delivery_state')} error={errs.delivery_state} hint="Decides whether CGST and SGST or IGST applies" />
          <TextField label="Pincode" inputMode="numeric" maxLength={6} value={f.delivery_pincode} onChange={set('delivery_pincode')} error={errs.delivery_pincode} />
        </div>
        <CheckField checked={f.installation_required} onChange={(e) => setF({ ...f, installation_required: e.target.checked })}>Installation needed. The supplier is paid only after you confirm it.</CheckField>
        <div><button className="btn" disabled={busy}>{data.over_cap ? 'Send request to our team' : 'Place order'}</button></div>
      </form>
    </>
  );
}
