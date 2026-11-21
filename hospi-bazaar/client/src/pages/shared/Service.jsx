import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api.js';
import { dateText, dateTimeText, label, useLoad } from '../../lib.js';
import { Alert, AreaField, Loading, SelectField, TextField, useToast } from '../../components/ui.jsx';
import { Empty, Facts, PageHead, StateBadge } from '../../components/common.jsx';

export function WarrantyList({ base, party }) {
  const { data, error } = useLoad('/warranties');
  return (
    <>
      <PageHead title="Warranty" sub="Created automatically when an order is completed." />
      <Alert>{error}</Alert>
      {!data && !error && <Loading />}
      {data && data.warranties.length === 0 && <Empty title="No warranties yet">Warranty details appear here once an order is completed.</Empty>}
      {data && data.warranties.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Item</th><th>{party === 'hospital' ? 'Supplier' : 'Hospital'}</th><th>Serial number</th><th>Covered until</th><th /></tr></thead>
          <tbody>{data.warranties.map((w) => (
            <WarrantyRow key={w.id} w={w} base={base} party={party} />
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

function WarrantyRow({ w, base, party }) {
  const [edit, setEdit] = useState(false);
  const [serial, setSerial] = useState(w.serial_number || '');
  const [date, setDate] = useState(w.installation_date ? String(w.installation_date).slice(0, 10) : '');
  const [row, setRow] = useState(w);
  const [err, setErr] = useState('');
  const toast = useToast();
  async function save() {
    setErr('');
    try { await api(`/warranties/${w.id}`, { method: 'PATCH', body: { serial_number: serial, installation_date: date || undefined } }); toast('Saved'); setEdit(false); setRow({ ...row, serial_number: serial }); }
    catch (e) { setErr(e.message); }
  }
  return (
    <tr>
      <td>{w.item_name}<span className="muted small"><br />{w.order_number}{w.model_number ? ` · ${w.model_number}` : ''}</span></td>
      <td>{party === 'hospital' ? w.company_name : w.hospital_name}</td>
      <td>{edit ? <div className="stack" style={{ gap: '0.4rem' }}><input className="input" aria-label="Serial number" value={serial} onChange={(e) => setSerial(e.target.value)} /><input className="input" type="date" aria-label="Installation date" value={date} onChange={(e) => setDate(e.target.value)} />{err && <span className="field__error">{err}</span>}</div> : (row.serial_number || <span className="muted">Not added</span>)}</td>
      <td>{w.expires_on ? dateText(w.expires_on) : '—'} {w.expired ? <span className="badge badge--bad">Expired</span> : null}</td>
      <td className="is-num">
        {party === 'hospital' && (edit
          ? <div className="row"><button className="btn btn--small" onClick={save}>Save</button><button className="btn btn--quiet btn--small" onClick={() => setEdit(false)}>Cancel</button></div>
          : <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn--quiet btn--small" onClick={() => setEdit(true)}>Edit serial</button><Link className="btn btn--small" to={`${base}/service/new?warranty=${w.id}`}>Raise request</Link></div>)}
      </td>
    </tr>
  );
}

export function ServiceList({ base, party }) {
  const { data, error } = useLoad('/service-requests');
  return (
    <>
      <PageHead title="Service requests" sub="Issues raised on items under warranty.">{party === 'hospital' && <Link className="btn btn--small" to={`${base}/service/new`}>New request</Link>}</PageHead>
      <Alert>{error}</Alert>
      {!data && !error && <Loading />}
      {data && data.requests.length === 0 && <Empty title="No service requests">{party === 'hospital' ? 'Raise a request from the Warranty page when something needs attention.' : 'Requests from hospitals show up here.'}</Empty>}
      {data && data.requests.length > 0 && (
        <div className="rowlist">{data.requests.map((r) => (
          <Link key={r.id} to={`${base}/service/${r.id}`} className="rowlist__item">
            <span className="rowlist__title">{r.ticket_number}: {r.issue_summary}</span>
            <span className="rowlist__meta">{r.item_name} · {party === 'hospital' ? r.company_name : r.hospital_name} · {dateText(r.created_at)}</span>
            <span className="rowlist__side"><StateBadge status={r.status} />{['high', 'critical'].includes(r.priority) && <span className="badge badge--bad">{label(r.priority)}</span>}</span>
          </Link>
        ))}</div>
      )}
    </>
  );
}

export function ServiceNew({ base }) {
  const [params] = useSearchParams();
  const { data } = useLoad('/warranties');
  const navigate = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ warranty_id: params.get('warranty') || '', issue_summary: '', description: '', priority: 'normal' });
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setErrs({}); setBusy(true);
    try { const r = await api('/service-requests', { method: 'POST', body: { ...f, warranty_id: f.warranty_id || undefined } }); toast(`Request ${r.ticket_number} sent`); navigate(`${base}/service/${r.id}`); }
    catch (err) { setErrs(err instanceof ApiError && Object.keys(err.fields).length ? err.fields : { form: err.message }); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHead title="New service request" />
      <form className="panel" onSubmit={submit} style={{ maxWidth: '40rem' }}>
        <Alert>{errs.form}</Alert>
        <SelectField label="Item" value={f.warranty_id} onChange={set('warranty_id')} error={errs.warranty_id}>
          <option value="">Choose an item</option>
          {data.warranties.map((w) => <option key={w.id} value={w.id}>{w.item_name} ({w.order_number}){w.serial_number ? `, ${w.serial_number}` : ''}{w.expired ? ', warranty expired' : ''}</option>)}
        </SelectField>
        <TextField label="What is wrong?" value={f.issue_summary} onChange={set('issue_summary')} error={errs.issue_summary} />
        <AreaField label="Details" optional value={f.description} onChange={set('description')} />
        <SelectField label="Priority" value={f.priority} onChange={set('priority')}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical, equipment is down</option></SelectField>
        <div><button className="btn" disabled={busy}>Send request</button></div>
      </form>
    </>
  );
}

export function ServiceDetail({ base, party }) {
  const { id } = useParams();
  const { data, error, reload } = useLoad(`/service-requests/${id}`);
  const toast = useToast();
  const [msg, setMsg] = useState('');
  const [status, setStatus] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const r = data.request;
  async function send(e) {
    e.preventDefault(); setBusy(true); setProblem('');
    try { await api(`/service-requests/${id}/updates`, { method: 'POST', body: { message: msg, status: status || undefined } }); setMsg(''); setStatus(''); toast('Sent'); await reload(); }
    catch (err) { setProblem(err.fields?.message || err.message); } finally { setBusy(false); }
  }
  async function close() {
    setBusy(true);
    try { await api(`/service-requests/${id}/close`, { method: 'POST' }); toast('Request closed'); await reload(); } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHead title={r.ticket_number} sub={r.issue_summary}><StateBadge status={r.status} /></PageHead>
      <Link to={`${base}/service`} className="small">Back to service requests</Link>
      <Alert>{problem}</Alert>
      <section className="panel"><Facts rows={[['Item', r.item_name], ['Serial number', r.serial_number], ['Warranty until', dateText(r.expires_on)], [party === 'hospital' ? 'Supplier' : 'Hospital', party === 'hospital' ? r.company_name : r.hospital_name], ['Priority', label(r.priority)], ['Raised', dateTimeText(r.created_at)], ['Details', r.description]]} /></section>
      <section className="stack"><h2 style={{ fontSize: '1.2rem' }}>Updates</h2>
        {data.updates.length === 0 ? <p className="muted">No updates yet.</p> : <div className="history">{data.updates.map((u) => <div key={u.id} className="history__item"><span className="history__when">{dateTimeText(u.created_at)}</span><span><strong>{u.full_name}</strong>{u.new_status ? ` (${label(u.new_status).toLowerCase()})` : ''}: {u.message}</span></div>)}</div>}
      </section>
      {r.status !== 'closed' && (
        <form className="panel" onSubmit={send}>
          <AreaField label="Add an update" value={msg} onChange={(e) => setMsg(e.target.value)} />
          {party === 'supplier' && <SelectField label="Change status" optional value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Keep as it is</option><option value="acknowledged">Acknowledged</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></SelectField>}
          <div className="row"><button className="btn" disabled={busy || !msg.trim()}>Send update</button>{party === 'hospital' && <button type="button" className="btn btn--quiet" onClick={close} disabled={busy}>Close request</button>}</div>
        </form>
      )}
    </>
  );
}
