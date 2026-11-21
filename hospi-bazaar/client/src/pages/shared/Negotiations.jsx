import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api.js';
import { dateText, dateTimeText, inr, useLoad } from '../../lib.js';
import { Alert, AreaField, Loading, TextField, useToast } from '../../components/ui.jsx';
import { Empty, PageHead, StateBadge } from '../../components/common.jsx';

export function NegotiationsList({ base, party }) {
  const { data, error } = useLoad('/negotiations');
  return (
    <>
      <PageHead title="Negotiations" sub={party === 'hospital' ? 'Price offers you have made on products.' : 'Price offers from hospitals on your products.'} />
      <Alert>{error}</Alert>
      {!data && !error && <Loading />}
      {data && data.negotiations.length === 0 && <Empty title="No negotiations yet">{party === 'hospital' ? 'Open a product above ₹5,000 and choose Make an offer.' : 'Offers appear here when a hospital negotiates a product price.'}</Empty>}
      {data && data.negotiations.length > 0 && (
        <div className="rowlist">
          {data.negotiations.map((n) => (
            <Link key={n.id} to={`${base}/negotiations/${n.id}`} className="rowlist__item">
              <span className="rowlist__title">{n.product_name}</span>
              <span className="rowlist__meta">{n.counterparty} · {n.quantity} units · listed {inr(n.listed_price)}{n.latest_offer ? ` · latest offer ${inr(n.latest_offer)}` : ''}</span>
              <span className="rowlist__side">
                <StateBadge status={n.status} />
                {n.awaiting_me && <span className="badge badge--wait">Your turn</span>}
                {n.status === 'agreed' && <span className="muted small">{inr(n.agreed_price)} per unit</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function NegotiationDetail({ base }) {
  const { id } = useParams();
  const { data, error, reload } = useLoad(`/negotiations/${id}`);
  const navigate = useNavigate();
  const toast = useToast();
  const [offer, setOffer] = useState('');
  const [note, setNote] = useState('');
  const [fieldErr, setFieldErr] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const n = data.negotiation;
  const open = n.status === 'open';

  async function post(body, message) {
    setBusy(true); setProblem(''); setFieldErr('');
    try { await api(`/negotiations/${id}/messages`, { method: 'POST', body }); if (message) toast(message); setOffer(''); setNote(''); await reload(); }
    catch (e) { if (e instanceof ApiError && e.fields.offer_amount) setFieldErr(e.fields.offer_amount); else setProblem(e.message); } finally { setBusy(false); }
  }
  async function toCart() {
    setBusy(true); setProblem('');
    try { await api('/cart/items/negotiated', { method: 'POST', body: { negotiation_id: Number(id) } }); toast('Added to your cart at the agreed price'); navigate(`${base}/cart`); }
    catch (e) { setProblem(e.message); } finally { setBusy(false); }
  }
  async function close() {
    setBusy(true);
    try { await api(`/negotiations/${id}/close`, { method: 'POST' }); toast('Negotiation closed'); await reload(); } catch (e) { setProblem(e.message); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHead title={n.product.name} sub={`${n.side === 'buyer' ? n.product.company_name : n.product.hospital_name} · ${n.quantity} units · listed ${inr(n.listed_price)} per unit`}><StateBadge status={n.status} /></PageHead>
      <Link to={`${base}/negotiations`} className="small">Back to negotiations</Link>
      <Alert>{problem}</Alert>
      {open && <Alert kind="info">The quantity is fixed at {n.quantity}. This negotiation closes automatically on {dateText(n.expires_at)} if nobody replies.</Alert>}
      {n.status === 'agreed' && (
        <Alert kind="info">
          Agreed at {inr(n.agreed_price)} per unit. {n.side === 'buyer' ? (n.ordered ? 'This price has been ordered.' : n.in_cart ? 'It is in your cart.' : n.can_add_to_cart ? `Add it to your cart within ${n.lock_hours} hours (by ${dateTimeText(n.lock_expires_at)}) to keep the price.` : 'The price hold has ended.') : 'The hospital has a limited time to order at this price.'}
        </Alert>
      )}
      {n.status === 'closed_no_deal' && <Alert kind="warn">This negotiation ended without a deal{n.close_reason === 'expired' ? ' because nobody replied in time' : ''}.</Alert>}

      <section className="panel chat" aria-label="Conversation">
        {data.messages.map((m) => (
          <div key={m.id} className={`bubble${m.sender === n.side ? ' bubble--me' : ''}`}>
            {m.offer_amount !== null && <span className="bubble__offer">{inr(m.offer_amount)} <span className="muted small" style={{ fontWeight: 400 }}>per unit</span></span>}
            {m.is_acceptance ? <span>Accepted the offer</span> : null}
            {m.note && <span>{m.note}</span>}
            <span className="bubble__meta">{m.sender === n.side ? 'You' : m.sender === 'buyer' ? 'Hospital' : 'Supplier'} · {dateTimeText(m.sent_at)}</span>
          </div>
        ))}
      </section>

      {n.can_add_to_cart && <div><button className="btn" onClick={toCart} disabled={busy}>Add to cart at {inr(n.agreed_price)}</button></div>}

      {open && (
        <section className="panel">
          <h2 style={{ fontSize: '1.1rem' }}>Your reply</h2>
          {n.can_accept && <div><button className="btn" onClick={() => post({ accept: true }, 'Offer accepted')} disabled={busy}>Accept the latest offer</button></div>}
          <form className="stack" onSubmit={(e) => { e.preventDefault(); post({ offer_amount: offer || undefined, note: note || undefined }, 'Sent'); }}>
            <TextField label="Counter offer per unit" optional inputMode="decimal" value={offer} onChange={(e) => setOffer(e.target.value)} error={fieldErr} />
            <AreaField label="Message" optional value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="row"><button className="btn" disabled={busy || (!offer && !note)}>Send</button><button type="button" className="btn btn--quiet" onClick={close} disabled={busy}>Walk away</button></div>
          </form>
        </section>
      )}
    </>
  );
}
