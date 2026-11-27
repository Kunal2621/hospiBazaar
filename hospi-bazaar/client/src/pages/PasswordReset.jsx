import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api.js';
import { Brand } from '../components/layouts.jsx';
import { Alert, TextField, useToast } from '../components/ui.jsx';

export function Frame({ title, sub, children }) {
  return (
    <div className="auth">
      <aside className="auth__aside">
        <Brand />
        <div className="auth__pitch">
          <h2>Get back into your account</h2>
          <p>We will email you a link that lets you choose a new password.</p>
        </div>
        <p className="small" style={{ color: '#b9d3ca' }}>Hospital furniture and medical equipment.</p>
      </aside>
      <main className="auth__main">
        <div className="auth__form">
          <div style={{ display: 'grid', gap: '0.4rem' }}><h1 style={{ fontSize: '1.9rem' }}>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
          {children}
        </div>
      </main>
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/auth/forgot-password', { method: 'POST', body: { email } }); setSent(true); }
    catch (err) { setError(err instanceof ApiError && err.status === 400 ? 'Enter a valid email address.' : err.message); }
    finally { setBusy(false); }
  }

  if (sent) {
    return (
      <Frame title="Check your email">
        <Alert kind="info">If {email} is registered, a reset link is on its way. It works once and expires in 60 minutes.</Alert>
        <p className="muted small">No email? Check spam, or <button className="text-button" onClick={() => setSent(false)}>try again</button>.</p>
        <Link to="/login" className="text-link">Back to sign in</Link>
      </Frame>
    );
  }
  return (
    <Frame title="Forgot your password?" sub="Enter the email you registered with.">
      <form className="stack" onSubmit={submit} noValidate>
        <Alert>{error}</Alert>
        <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <button className="btn btn--block" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send reset link'}</button>
        <Link to="/login" className="text-link small">Back to sign in</Link>
      </form>
    </Frame>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [errs, setErrs] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!token) {
    return <Frame title="This link is incomplete"><Alert>The reset link is missing its token. Open the link from your email again, or ask for a new one.</Alert><Link to="/forgot-password" className="text-link">Send a new link</Link></Frame>;
  }

  async function submit(e) {
    e.preventDefault(); setError(''); setErrs({});
    if (pw !== again) { setErrs({ again: 'The two passwords do not match' }); return; }
    setBusy(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password: pw } });
      toast('Password changed. Sign in with the new one'); navigate('/login', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.fields?.password) setErrs({ pw: err.fields.password });
      else setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <Frame title="Choose a new password" sub="At least 8 characters, with a letter and a number.">
      <form className="stack" onSubmit={submit} noValidate>
        <Alert>{error}{error && error.includes('expired') ? <> <Link to="/forgot-password" className="text-link">Send a new link</Link></> : null}</Alert>
        <TextField label="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} error={errs.pw} autoFocus />
        <TextField label="Type it again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} error={errs.again} />
        <button className="btn btn--block" disabled={busy || !pw}>{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
    </Frame>
  );
}