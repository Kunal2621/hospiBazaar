import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ImageOff, Search } from 'lucide-react';
import { api } from '../api.js';
import { inr, useLoad, label } from '../lib.js';
import { Alert, Loading, SelectField, TextField } from '../components/ui.jsx';
import { Empty } from '../components/common.jsx';

export default function Marketplace() {
  const [params, setParams] = useSearchParams();
  const { data: cats } = useLoad('/categories');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState(params.get('q') || '');

  const key = params.toString();
  useEffect(() => {
    setResult(null); setError('');
    api(`/products?${key}`).then(setResult).catch((e) => setError(e.message));
  }, [key]);

  const set = (name, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value); else next.delete(name);
    if (name !== 'page') next.delete('page');
    setParams(next);
  };

  return (
    <div className="wrap market">
      <aside className="market__filters" aria-label="Filters">
        <form onSubmit={(e) => { e.preventDefault(); set('q', q.trim()); }} role="search">
          <TextField label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bed, monitor, model…" />
        </form>
        <SelectField label="Category" value={params.get('category') || ''} onChange={(e) => set('category', e.target.value)}>
          <option value="">All categories</option>
          {(cats?.categories || []).map((g) => (
            <optgroup key={g.id} label={g.name}>
              <option value={g.slug}>All {g.name.toLowerCase()}</option>
              {g.children.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
            </optgroup>
          ))}
        </SelectField>
        <SelectField label="Supplier type" value={params.get('supplier_type') || ''} onChange={(e) => set('supplier_type', e.target.value)}>
          <option value="">Any</option>
          {['manufacturer', 'brand_oem', 'authorised_dealer', 'distributor'].map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </SelectField>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <TextField label="Min price" inputMode="numeric" value={params.get('min_price') || ''} onChange={(e) => set('min_price', e.target.value.replace(/\D/g, ''))} />
          <TextField label="Max price" inputMode="numeric" value={params.get('max_price') || ''} onChange={(e) => set('max_price', e.target.value.replace(/\D/g, ''))} />
        </div>
        <label className="check"><input type="checkbox" checked={params.get('negotiable') === '1'} onChange={(e) => set('negotiable', e.target.checked ? '1' : '')} /><span>Open to price negotiation</span></label>
        <SelectField label="Sort by" value={params.get('sort') || 'newest'} onChange={(e) => set('sort', e.target.value)}>
          <option value="newest">Newest</option><option value="price_asc">Price, low to high</option><option value="price_desc">Price, high to low</option><option value="name">Name</option>
        </SelectField>
      </aside>

      <section aria-labelledby="mp-title" className="stack">
        <div>
          <h1 id="mp-title" style={{ fontSize: '1.9rem' }}>Hospital furniture and medical equipment</h1>
          <p className="muted" style={{ marginTop: '0.4rem' }}>{result ? `${result.total} ${result.total === 1 ? 'product' : 'products'} from verified suppliers` : 'Loading products'}</p>
        </div>
        <Alert>{error}</Alert>
        {!result && !error && <Loading />}
        {result && result.products.length === 0 && (
          <Empty title="No products match these filters" action={<button className="btn btn--quiet btn--small" onClick={() => { setQ(''); setParams({}); }}>Clear filters</button>}>
            Try a broader search, or send an RFQ and let suppliers come to you.
          </Empty>
        )}
        {result && result.products.length > 0 && (
          <>
            <div className="market__grid">
              {result.products.map((p) => (
                <Link key={p.id} to={`/products/${p.slug}`} className="pcard">
                  <div className="pcard__img">{p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <ImageOff size={28} aria-hidden />}</div>
                  <div className="pcard__body">
                    <span className="muted small">{p.brand_name || p.category_name}</span>
                    <span className="pcard__name">{p.name}</span>
                    <span className="pcard__price num">{inr(p.unit_price)} <span className="muted small" style={{ fontWeight: 400 }}>+ {p.gst_rate}% GST</span></span>
                    <span className="muted small">{p.company_name}, {p.supplier_city}</span>
                    {p.negotiable && <span className="badge badge--ok" style={{ justifySelf: 'start' }}>Negotiable</span>}
                  </div>
                </Link>
              ))}
            </div>
            {result.pages > 1 && (
              <nav className="pager" aria-label="Pages">
                <button className="btn btn--quiet btn--small" disabled={result.page <= 1} onClick={() => set('page', String(result.page - 1))}>Previous</button>
                <span className="muted small">Page {result.page} of {result.pages}</span>
                <button className="btn btn--quiet btn--small" disabled={result.page >= result.pages} onClick={() => set('page', String(result.page + 1))}>Next</button>
              </nav>
            )}
          </>
        )}
        <p className="muted small"><Search size={14} style={{ display: 'inline', verticalAlign: '-2px' }} aria-hidden /> Cannot find it? <Link to="/hospital/rfqs/new">Send an RFQ</Link> and verified suppliers will quote.</p>
      </section>
    </div>
  );
}
