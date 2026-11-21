import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api.js';
import { useAuth, homeFor } from '../auth.jsx';
import { Brand } from '../components/layouts.jsx';
import { Alert, TextField, useFields } from '../components/ui.jsx';

export default function Login() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const { values, bind } = useFields({ email: '', password: '' });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user)} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(''); setFieldErrors({});
    try {
      const data = await api('/auth/login', { method: 'POST', body: values });
      signIn(data);
      navigate(homeFor(data.user), { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 400 ? 'Enter your email and password.' : err.message);
        setFieldErrors(err.fields || {});
      } else setError('Something went wrong. Try again.');
    } finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <aside className="auth__aside">
        <Brand />
        <div className="auth__pitch">
          <h2>Quotes, orders and service for hospital purchasing</h2>
          <p>Sign in to see your requests, supplier responses and order progress.</p>
        </div>
        <p className="small" style={{ color: '#b9d3ca' }}>Hospital furniture and medical equipment.</p>
      </aside>
      <main className="auth__main">
        <form className="auth__form" onSubmit={submit} noValidate>
          <div style={{ display: 'grid', gap: '0.4rem' }}>
            <h1 style={{ fontSize: '1.9rem' }}>Sign in</h1>
            <p className="muted">Use the email you registered with.</p>
          </div>
          <Alert>{error}</Alert>
          <TextField label="Email" type="email" autoComplete="email" error={fieldErrors.email} {...bind('email')} />
          <TextField label="Password" type="password" autoComplete="current-password" error={fieldErrors.password} {...bind('password')} />
          <button className="btn btn--block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="muted small">
            New to Hospi Bazaar? <Link to="/register/hospital" className="text-link">Register your hospital</Link> or <Link to="/register/supplier" className="text-link">apply as a supplier</Link>.
          </p>
        </form>
      </main>
    </div>
  );
}
