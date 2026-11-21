import { Link } from 'react-router-dom';
import { BadgeCheck, Handshake, PackageCheck, Scale, ShieldCheck, Wrench } from 'lucide-react';
import { useAuth, homeFor } from '../auth.jsx';

const inr = (n) => (n === 0 ? 'Included' : `₹${n.toLocaleString('en-IN')}`);

// Illustration only: three fictional suppliers quoting the same RFQ.
const QUOTES = [
  { name: 'Supplier A', kind: 'Manufacturer', unit: 82000, freight: 25000, install: 30000, warranty: '3 years', days: 28 },
  { name: 'Supplier B', kind: 'Authorised dealer', unit: 78500, freight: 42000, install: null, warranty: '2 years', days: 21 },
  { name: 'Supplier C', kind: 'Distributor', unit: 85000, freight: 0, install: 0, warranty: '5 years', days: 35 },
].map((q) => {
  const sub = q.unit * 20;
  const gst = Math.round(sub * 0.12);
  return { ...q, total: sub + gst + q.freight + (q.install || 0) };
});

const ROWS = [
  { label: 'Unit price', get: (q) => inr(q.unit) },
  { label: 'Freight', get: (q) => inr(q.freight) },
  { label: 'Installation', get: (q) => (q.install === null ? 'Not offered' : inr(q.install)) },
  { label: 'Warranty', get: (q) => q.warranty },
  { label: 'Delivery', get: (q) => `${q.days} days` },
];

const STAGES = [
  { name: 'Find and compare', text: 'Browse verified suppliers and products across hospital furniture and medical equipment.' },
  { name: 'Request quotes', text: 'Send one requirement to every relevant supplier instead of calling each of them.' },
  { name: 'Negotiate', text: 'Make a counter offer on a product page and agree the price in the same place.' },
  { name: 'Order and pay', text: 'Place the order and pay online. Orders above ₹5 lakh are confirmed with our team.' },
  { name: 'Delivery and installation', text: 'Follow the order to your door, then confirm delivery and installation.' },
  { name: 'Warranty and service', text: 'Keep warranty details with the order and raise service requests to the supplier.' },
];

const CATEGORY_GROUPS = [
  { name: 'Hospital furniture', items: ['Hospital beds: ICU, Fowler, electric', 'Examination couches', 'OT tables', 'Stretchers and trolleys', 'Bedside lockers and patient furniture'] },
  { name: 'Medical equipment', items: ['Patient monitors and ECG', 'Defibrillators and suction', 'Infusion and syringe pumps', 'Autoclaves and OT equipment', 'Anaesthesia and neonatal', 'Laboratory, physiotherapy and emergency'] },
];

export default function Landing() {
  const { user } = useAuth();
  return (
    <>
      <section className="hero">
        <div className="wrap hero__grid">
          <div className="hero__copy">
            <h1>Compare hospital equipment quotes side by side</h1>
            <p className="hero__lede">
              Describe what your hospital needs once. Verified suppliers reply with structured quotations, so price, installation, warranty and delivery line up in one table.
            </p>
            <div className="hero__actions">
              {user ? (
                <Link to={homeFor(user)} className="btn">Open your workspace</Link>
              ) : (
                <>
                  <Link to="/register/hospital" className="btn">Register your hospital</Link>
                  <Link to="/register/supplier" className="btn btn--quiet">Apply as a supplier</Link>
                </>
              )}
            </div>
            <p className="hero__fine">Phase 1 covers hospital furniture and medical equipment. Every supplier is checked against GST, PAN, business and bank records before they can quote.</p>
          </div>

          <figure className="rfq" style={{ margin: 0 }} aria-label="Sample quotation comparison">
            <div className="rfq__head">
              <div className="rfq__top">
                <span className="rfq__number">HB-RFQ-000128</span>
                <span className="badge badge--wait">3 quotations received</span>
              </div>
              <div className="rfq__title">20 electric ICU beds</div>
              <div className="rfq__needs">
                <span>Deliver to Bhopal</span>
                <span>Within 30 days</span>
                <span>Installation needed</span>
              </div>
            </div>
            <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="rfq__table">
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">Term</span></th>
                    {QUOTES.map((q) => (
                      <th key={q.name} scope="col">{q.name}<span className="rfq__who">{q.kind}</span></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((r, i) => (
                    <tr key={r.label} className="rfq__row" style={{ '--i': i }}>
                      <th scope="row">{r.label}</th>
                      {QUOTES.map((q) => <td key={q.name}>{r.get(q)}</td>)}
                    </tr>
                  ))}
                  <tr className="rfq__row rfq__row--total" style={{ '--i': ROWS.length }}>
                    <th scope="row">Total with 12% GST</th>
                    {QUOTES.map((q) => <td key={q.name}>{inr(q.total)}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
            <figcaption className="small muted" style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--line)' }}>
              Sample figures for illustration. Hospi Bazaar shows every quotation and never ranks one as best.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section__head">
            <h2>From first search to service call</h2>
            <p>Everything that happens after you choose a supplier stays attached to the same record.</p>
          </div>
          <ol className="lifecycle">
            {STAGES.map((s) => (
              <li key={s.name} className="lifecycle__item">
                <span className="lifecycle__name">{s.name}</span>
                <span className="lifecycle__text">{s.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section section--tight">
        <div className="wrap">
          <div className="audience">
            <div className="audience__col audience__col--hospital">
              <h2>For hospitals</h2>
              <ul className="audience__list">
                <li className="audience__point"><Scale size={20} aria-hidden /><span>Compare price, installation, warranty and delivery without reading three different quotation formats.</span></li>
                <li className="audience__point"><BadgeCheck size={20} aria-hidden /><span>Only suppliers whose documents have been checked can respond to your requests.</span></li>
                <li className="audience__point"><Wrench size={20} aria-hidden /><span>Raise service requests against the order when something needs attention.</span></li>
              </ul>
              <Link to="/register/hospital" className="btn" style={{ justifySelf: 'start' }}>Register your hospital</Link>
            </div>
            <div className="audience__col">
              <h2>For suppliers</h2>
              <ul className="audience__list">
                <li className="audience__point"><ShieldCheck size={20} aria-hidden /><span>Manufacturers, brand owners, authorised dealers and distributors each get a checklist that fits them.</span></li>
                <li className="audience__point"><Handshake size={20} aria-hidden /><span>Receive requirements from verified hospitals and answer with one structured quotation.</span></li>
                <li className="audience__point"><PackageCheck size={20} aria-hidden /><span>Orders and delivery confirmations are tracked in one place.</span></li>
              </ul>
              <Link to="/register/supplier" className="btn btn--quiet" style={{ justifySelf: 'start' }}>Apply as a supplier</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section__head">
            <h2>What you can source</h2>
          </div>
          <div className="categories">
            {CATEGORY_GROUPS.map((g) => (
              <div key={g.name} className="categories__group">
                <h3>{g.name}</h3>
                <ul className="categories__list">{g.items.map((i) => <li key={i}>{i}</li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {!user && (
        <section className="band">
          <div className="wrap band__inner">
            <div>
              <p className="band__line">Have a requirement open right now?</p>
              <p className="band__sub">Register your hospital, then browse and request quotes straight away. We verify your hospital before your first order.</p>
            </div>
            <Link to="/register/hospital" className="btn">Register your hospital</Link>
          </div>
        </section>
      )}
    </>
  );
}
