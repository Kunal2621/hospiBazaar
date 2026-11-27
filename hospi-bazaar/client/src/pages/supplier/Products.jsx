import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ImageOff, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api.js';
import { inr, label, useLoad } from '../../lib.js';
import { Alert, AreaField, CheckField, Loading, SelectField, TextField, focusFirstError, useToast } from '../../components/ui.jsx';
import { Empty, FileField, PageHead, StateBadge } from '../../components/common.jsx';

export function ProductList() {
  const { data, error, reload } = useLoad('/supplier/products');
  const toast = useToast();
  const act = (id, path, msg) => api(`/supplier/products/${id}${path}`, { method: 'POST' }).then(() => { toast(msg); reload(); }).catch((e) => toast(e.message, 'bad'));
  return (
    <>
      <PageHead title="Products" sub="New and changed products are checked by our team before buyers see them."><Link className="btn btn--small" to="/supplier/products/new"><Plus size={16} aria-hidden /> Add a product</Link></PageHead>
      <Alert>{error}</Alert>
      {!data && !error && <Loading />}
      {data && data.products.length === 0 && <Empty title="No products yet">Add your first product. Saving keeps it as a draft until you send it for approval.</Empty>}
      {data && data.products.length > 0 && (
        <div className="rowlist">{data.products.map((p) => (
          <div key={p.id} className="rowlist__item">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <div className="cart-line__img">{p.image_url ? <img src={p.image_url} alt="" /> : <ImageOff size={20} aria-hidden />}</div>
              <div className="stack" style={{ gap: '0.1rem' }}>
                <Link className="rowlist__title" to={`/supplier/products/${p.id}`}>{p.name}</Link>
                <span className="rowlist__meta">{p.category_name} · {inr(p.unit_price)} · {label(p.stock_status)}</span>
                {p.status === 'rejected' && p.rejection_reason && <span className="field__error">Not approved: {p.rejection_reason}</span>}
              </div>
            </div>
            <span className="rowlist__side">
              <StateBadge status={p.status} />
              <span className="row" style={{ justifyContent: 'flex-end' }}>
                {['draft', 'rejected'].includes(p.status) && <button className="btn btn--small" onClick={() => act(p.id, '/submit', 'Sent for approval')}>Send for approval</button>}
                {p.status === 'approved' && <button className="btn btn--quiet btn--small" onClick={() => act(p.id, '/deactivate', 'Taken offline')}>Take offline</button>}
                {p.status === 'inactive' && <button className="btn btn--quiet btn--small" onClick={() => act(p.id, '/activate', 'Back online')}>Put online</button>}
              </span>
            </span>
          </div>
        ))}</div>
      )}
    </>
  );
}

const BLANK = { category_id: '', brand: '', name: '', model_number: '', sku: '', short_description: '', description: '', unit_price: '', gst_rate: '12', hsn_code: '', min_order_qty: '1', stock_status: 'in_stock', lead_time_days: '', warranty_months: '', installation_available: false, logistics_type: 'large_equipment' };

export function ProductForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const { data: meta } = useLoad('/supplier/products/categories');
  const [f, setF] = useState(BLANK);
  const [specs, setSpecs] = useState([{ k: '', v: '' }]);
  const [images, setImages] = useState([]);
  const [docs, setDocs] = useState([]);
  const [status, setStatus] = useState('');
  const [ready, setReady] = useState(!editing);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) return;
    api(`/supplier/products/${id}`).then(({ product: p }) => {
      setF({ ...BLANK, ...Object.fromEntries(Object.keys(BLANK).map((k) => [k, p[k] === null || p[k] === undefined ? BLANK[k] : (typeof BLANK[k] === 'boolean' ? Boolean(p[k]) : String(p[k]))])) });
      const sp = typeof p.specifications === 'string' ? JSON.parse(p.specifications) : p.specifications || {};
      setSpecs(Object.keys(sp).length ? Object.entries(sp).map(([k, v]) => ({ k, v })) : [{ k: '', v: '' }]);
      setImages(p.images); setDocs(p.documents); setStatus(p.status); setReady(true);
    }).catch((e) => setErrs({ form: e.message }));
  }, [id, editing]);

  if (!meta || !ready) return <Loading />;
  const locked = status === 'pending_approval';
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save(e) {
    e.preventDefault(); setErrs({}); setBusy(true);
    const body = {
      ...f, installation_available: f.installation_available,
      specifications: Object.fromEntries(specs.filter((s) => s.k.trim() && s.v.trim()).map((s) => [s.k.trim(), s.v.trim()])),
      images, documents: docs,
    };
    try {
      const r = await api(editing ? `/supplier/products/${id}` : '/supplier/products', { method: editing ? 'PUT' : 'POST', body });
      toast(editing && r.status === 'pending_approval' ? 'Saved. It goes back for approval before buyers see it' : 'Saved'); navigate('/supplier/products');
    } catch (err) { setErrs(err instanceof ApiError && Object.keys(err.fields).length ? err.fields : { form: err.message }); focusFirstError(); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHead title={editing ? 'Edit product' : 'Add a product'} sub="Prices are per unit, before GST.">{status && <StateBadge status={status} />}</PageHead>
      <Link to="/supplier/products" className="small">Back to products</Link>
      {editing && status === 'approved' && <Alert kind="warn">This product is live. Editing the details sends it back for approval and it leaves the marketplace until approved. For a price or stock change only, use the quick update below.</Alert>}
      {locked && <Alert kind="info">This product is being reviewed and cannot be edited until the decision.</Alert>}
      {editing && ['approved', 'inactive'].includes(status) && <QuickUpdate id={id} price={f.unit_price} stock={f.stock_status} onSaved={(price, stock) => setF({ ...f, unit_price: String(price), stock_status: stock })} />}
      <form className="stack stack--lg" onSubmit={save} noValidate>
        <Alert>{errs.form}</Alert>
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '1.5rem' }}>
          <section className="panel">
            <h2 style={{ fontSize: '1.15rem' }}>Basics</h2>
            <div className="form-grid">
              <SelectField label="Category" value={f.category_id} onChange={set('category_id')} error={errs.category_id}><option value="">Choose</option>{meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
              <TextField label="Brand" optional value={f.brand} onChange={set('brand')} error={errs.brand} />
              <div style={{ gridColumn: '1 / -1' }}><TextField label="Product name" value={f.name} onChange={set('name')} error={errs.name} /></div>
              <TextField label="Model number" optional value={f.model_number} onChange={set('model_number')} />
              <TextField label="SKU" optional value={f.sku} onChange={set('sku')} />
            </div>
            <TextField label="One-line summary" optional value={f.short_description} onChange={set('short_description')} error={errs.short_description} />
            <AreaField label="Description" optional value={f.description} onChange={set('description')} />
          </section>

          <section className="panel">
            <h2 style={{ fontSize: '1.15rem' }}>Price and availability</h2>
            <div className="form-grid">
              <TextField label="Price per unit (₹)" inputMode="decimal" value={f.unit_price} onChange={set('unit_price')} error={errs.unit_price} />
              <TextField label="GST rate (%)" inputMode="decimal" value={f.gst_rate} onChange={set('gst_rate')} error={errs.gst_rate} hint={`Usual rate: ${meta.default_gst_rate}%`} />
              <TextField label="HSN code" optional value={f.hsn_code} onChange={set('hsn_code')} />
              <TextField label="Minimum order quantity" inputMode="numeric" value={f.min_order_qty} onChange={set('min_order_qty')} error={errs.min_order_qty} />
              <SelectField label="Stock" value={f.stock_status} onChange={set('stock_status')}><option value="in_stock">In stock</option><option value="made_to_order">Made to order</option><option value="out_of_stock">Out of stock</option></SelectField>
              <TextField label="Delivery time (days)" optional inputMode="numeric" value={f.lead_time_days} onChange={set('lead_time_days')} error={errs.lead_time_days} />
              <TextField label="Warranty (months)" optional inputMode="numeric" value={f.warranty_months} onChange={set('warranty_months')} error={errs.warranty_months} />
              <SelectField label="Shipping" value={f.logistics_type} onChange={set('logistics_type')}><option value="large_equipment">Large equipment or furniture</option><option value="small_parcel">Small parcel</option></SelectField>
            </div>
            <CheckField checked={f.installation_available} onChange={(e) => setF({ ...f, installation_available: e.target.checked })}>I can install this product</CheckField>
          </section>

          <section className="panel">
            <h2 style={{ fontSize: '1.15rem' }}>Specifications</h2>
            {specs.map((s, i) => (
              <div key={i} className="row" style={{ alignItems: 'end', flexWrap: 'nowrap' }}>
                <TextField label={i === 0 ? 'Name' : 'Name '} value={s.k} onChange={(e) => setSpecs(specs.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} placeholder="Motors" />
                <TextField label={i === 0 ? 'Value' : 'Value '} value={s.v} onChange={(e) => setSpecs(specs.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} placeholder="5" />
                <button type="button" className="btn btn--quiet btn--small" aria-label="Remove this row" onClick={() => setSpecs(specs.length > 1 ? specs.filter((_, j) => j !== i) : [{ k: '', v: '' }])}><Trash2 size={16} aria-hidden /></button>
              </div>
            ))}
            <div><button type="button" className="btn btn--quiet btn--small" onClick={() => setSpecs([...specs, { k: '', v: '' }])}><Plus size={16} aria-hidden /> Add a row</button></div>
          </section>

          <section className="panel">
            <h2 style={{ fontSize: '1.15rem' }}>Photos and documents</h2>
            <div className="tag-list">
              {images.map((u) => <span key={u} className="tag"><a href={u} target="_blank" rel="noreferrer">Photo</a> <button type="button" className="text-button small" onClick={() => setImages(images.filter((x) => x !== u))}>Remove</button></span>)}
            </div>
            {images.length < 8 && <FileField label="Add a photo" value="" visibility="public" accept=".jpg,.jpeg,.png,.webp" onChange={(url) => setImages([...images, url])} hint="Up to 8 photos. The first is the cover." error={errs.images} />}
            <div className="tag-list">
              {docs.map((d) => <span key={d.file_url} className="tag"><a href={d.file_url} target="_blank" rel="noreferrer">{label(d.document_type)}</a> <button type="button" className="text-button small" onClick={() => setDocs(docs.filter((x) => x !== d))}>Remove</button></span>)}
            </div>
            <DocAdder onAdd={(d) => setDocs([...docs, d])} />
          </section>
        </fieldset>
        {!locked && <div className="row"><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button><span className="muted small">Saved as a draft. Send it for approval from the product list.</span></div>}
      </form>
    </>
  );
}

function DocAdder({ onAdd }) {
  const [type, setType] = useState('brochure');
  return (
    <div className="form-grid" style={{ alignItems: 'end' }}>
      <SelectField label="Document type" value={type} onChange={(e) => setType(e.target.value)}>{['brochure', 'datasheet', 'certificate', 'manual', 'other'].map((t) => <option key={t} value={t}>{label(t)}</option>)}</SelectField>
      <FileField label="Add a document" value="" visibility="public" onChange={(url) => onAdd({ document_type: type, file_url: url })} accept=".pdf,.jpg,.jpeg,.png" />
    </div>
  );
}

function QuickUpdate({ id, price, stock, onSaved }) {
  const toast = useToast();
  const [v, setV] = useState({ unit_price: price, stock_status: stock });
  const [err, setErr] = useState('');
  async function go(e) {
    e.preventDefault(); setErr('');
    try { await api(`/supplier/products/${id}/price-stock`, { method: 'PATCH', body: v }); toast('Price and stock updated. It stays live'); onSaved(v.unit_price, v.stock_status); }
    catch (er) { setErr(er.fields?.unit_price || er.message); }
  }
  return (
    <form className="panel" onSubmit={go}>
      <h2 style={{ fontSize: '1.15rem' }}>Quick update</h2>
      <Alert>{err}</Alert>
      <div className="form-grid">
        <TextField label="Price per unit (₹)" inputMode="decimal" value={v.unit_price} onChange={(e) => setV({ ...v, unit_price: e.target.value })} />
        <SelectField label="Stock" value={v.stock_status} onChange={(e) => setV({ ...v, stock_status: e.target.value })}><option value="in_stock">In stock</option><option value="made_to_order">Made to order</option><option value="out_of_stock">Out of stock</option></SelectField>
      </div>
      <div><button className="btn btn--quiet">Update price and stock</button></div>
    </form>
  );
}
