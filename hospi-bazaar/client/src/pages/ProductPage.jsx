import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileText, ImageOff } from 'lucide-react';
import { api, ApiError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { inr, label, useLoad } from '../lib.js';
import { Alert, AreaField, Dialog, Loading, TextField, useToast } from '../components/ui.jsx';
import { Facts } from '../components/common.jsx';

const BUYERS = ['hospital_admin', 'purchase_manager', 'purchase_executive'];

export default function ProductPage() {
  const { slug } = useParams();
  const { data, error } = useLoad(`/products/${slug}`);
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [img, setImg] = useState(0);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [offerOpen, setOfferOpen] = useState(false);
  const [offer, setOffer] = useState({ amount: '', note: '' });
  const [offerError, setOfferError] = useState({});

  if (error) return <div className="wrap" style={{ paddingBlock: '2rem' }}><Alert>{error}</Alert><p style={{ marginTop: '1rem' }}><Link to="/marketplace">Back to the marketplace</Link></p></div>;
  if (!data) return <div className="wrap" style={{ paddingBlock: '2rem' }}><Loading /></div>;
  const p = data.product;
  const isBuyer = user?.type === 'hospital_user' && BUYERS.includes(user.hospitalRole);
  const minQty = p.min_order_qty || 1;
  const q = Math.max(minQty, Number(qty) || minQty);
  const out = p.stock_status === 'out_of_stock';

  async function addToCart() {
    setBusy(true); setProblem('');
    try { await api('/cart/items', { method: 'POST', body: { product_id: p.id, quantity: q } }); toast('Added to your cart'); navigate('/hospital/cart'); }
    catch (e) { setProblem(e.message); } finally { setBusy(false); }
  }
  async function negotiate(e) {
    e.preventDefault(); setOfferError({}); setBusy(true);
    try {
      const r = await api('/negotiations', { method: 'POST', body: { product_id: p.id, quantity: q, offer_amount: offer.amount, note: offer.note } });
      toast('Offer sent to the supplier'); navigate(`/hospital/negotiations/${r.id}`);
    } catch (err) { setOfferError(err instanceof ApiError && err.fields.offer_amount ? { amount: err.fields.offer_amount } : { form: err.message }); } finally { setBusy(false); }
  }

  return (
    <div className="wrap pdp">
      <div className="pdp__gallery">
        <div className="pdp__main">{p.images[img] ? <img src={p.images[img]} alt={p.name} /> : <ImageOff size={40} aria-hidden />}</div>
        {p.images.length > 1 && (
          <div className="pdp__thumbs">
            {p.images.map((src, i) => <button key={src} className="pdp__thumb" aria-current={i === img} aria-label={`Photo ${i + 1}`} onClick={() => setImg(i)}><img src={src} alt="" /></button>)}
          </div>
        )}
      </div>

      <div className="pdp__buy">
        <div className="stack" style={{ gap: '0.5rem' }}>
          <p className="muted small"><Link to="/marketplace">Marketplace</Link> / <Link to={`/marketplace?category=${p.category_slug}`}>{p.category_name}</Link></p>
          <h1 style={{ fontSize: '2rem' }}>{p.name}</h1>
          <p className="muted">{[p.brand_name, p.model_number && `Model ${p.model_number}`].filter(Boolean).join(', ')}</p>
        </div>
        <div className="pdp__price">{inr(p.unit_price)} <span className="muted small" style={{ fontWeight: 400 }}>+ {p.gst_rate}% GST, per unit</span></div>
        {p.short_description && <p>{p.short_description}</p>}

        <div className="pdp__box">
          {out && <Alert kind="warn">This item is out of stock. You can still send an RFQ.</Alert>}
          <Alert>{problem}</Alert>
          {user?.type === 'hospital_user' && !isBuyer && <Alert kind="info">Your role can browse. Ask a purchase manager or hospital admin to order.</Alert>}
          {!user && <Alert kind="info"><Link to="/login">Sign in</Link> or <Link to="/register/hospital">register your hospital</Link> to order or negotiate.</Alert>}
          {user && user.type !== 'hospital_user' && <Alert kind="info">Only hospital accounts can order.</Alert>}
          {isBuyer && (
            <>
              <div className="qty">
                <label htmlFor="qty" className="field__label">Quantity</label>
                <input id="qty" className="input" type="number" min={minQty} value={qty} onChange={(e) => setQty(e.target.value)} />
                {minQty > 1 && <span className="muted small">Minimum {minQty}</span>}
              </div>
              <p className="num">Subtotal {inr(q * p.unit_price)} <span className="muted small">before GST</span></p>
              <div className="row">
                <button className="btn" onClick={addToCart} disabled={busy || out}>Add to cart</button>
                {p.negotiable && <button className="btn btn--quiet" onClick={() => { setOffer({ amount: '', note: '' }); setOfferError({}); setOfferOpen(true); }} disabled={out}>Make an offer</button>}
                <Link className="btn btn--quiet" to={`/hospital/rfqs/new?product=${p.id}&category=${p.category_id}&name=${encodeURIComponent(p.name)}&qty=${q}`}>Request a quote</Link>
              </div>
              {p.negotiable && <p className="muted small">Items priced above {inr(p.negotiation_min_unit_price)} can be negotiated. The agreed price is held in your cart for a limited time.</p>}
            </>
          )}
        </div>

        <Facts rows={[
          ['Supplier', `${p.company_name} (${label(p.supplier_type)})`], ['Based in', `${p.supplier_city}, ${p.supplier_state}`],
          ['Availability', label(p.stock_status)], ['Delivery time', p.lead_time_days ? `${p.lead_time_days} days` : ''],
          ['Warranty', p.warranty_months ? `${p.warranty_months} months` : ''], ['Installation', p.installation_available ? 'Available from the supplier' : 'Not offered'],
          ['HSN code', p.hsn_code], ['Service in', p.service_states.join(', ')],
        ]} />
      </div>

      <div style={{ gridColumn: '1 / -1' }} className="stack stack--lg">
        {p.description && <section><h2 style={{ fontSize: '1.3rem', marginBottom: '0.6rem' }}>About this product</h2><p style={{ whiteSpace: 'pre-line', maxWidth: '70ch' }}>{p.description}</p></section>}
        {p.specifications && Object.keys(p.specifications).length > 0 && (
          <section>
            <h2 style={{ fontSize: '1.3rem', marginBottom: '0.6rem' }}>Specifications</h2>
            <div className="table-wrap"><table className="table spec-table"><tbody>
              {Object.entries(p.specifications).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>)}
            </tbody></table></div>
          </section>
        )}
        {p.documents.length > 0 && (
          <section>
            <h2 style={{ fontSize: '1.3rem', marginBottom: '0.6rem' }}>Documents</h2>
            <div className="doc-list">{p.documents.map((d) => <div className="doc-list__item" key={d.file_url}><a className="doc-list__link" href={d.file_url} target="_blank" rel="noreferrer"><FileText size={16} aria-hidden /> {label(d.document_type)}</a></div>)}</div>
          </section>
        )}
      </div>

      <Dialog open={offerOpen} onClose={() => setOfferOpen(false)} title="Make an offer">
        <form onSubmit={negotiate} className="stack">
          <Alert>{offerError.form}</Alert>
          <p className="muted">Listed price {inr(p.unit_price)} per unit for {q} {q === 1 ? 'unit' : 'units'}. The quantity stays fixed during the negotiation.</p>
          <TextField label="Your price per unit (before GST)" inputMode="decimal" value={offer.amount} onChange={(e) => setOffer({ ...offer, amount: e.target.value })} error={offerError.amount} autoFocus />
          <AreaField label="Note to the supplier" optional value={offer.note} onChange={(e) => setOffer({ ...offer, note: e.target.value })} />
          <div className="dialog__actions"><button type="button" className="btn btn--quiet" onClick={() => setOfferOpen(false)}>Cancel</button><button className="btn" disabled={busy}>Send offer</button></div>
        </form>
      </Dialog>
    </div>
  );
}
