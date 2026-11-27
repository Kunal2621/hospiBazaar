import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, homeFor } from '../auth.jsx';
import { Alert, Loading } from '../components/ui.jsx';
import { Frame } from './PasswordReset.jsx';

// Opened from the link in the email. It confirms the address; it does not sign anyone in.
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { user, refresh } = useAuth();
  const [state, setState] = useState(token ? 'working' : 'missing');
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => { setState('done'); if (user) refresh(); })
      .catch((e) => { setError(e.message); setState('failed'); });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'working') return <Frame title="Confirming your email"><Loading /></Frame>;
  if (state === 'done') {
    return (
      <Frame title="Email confirmed" sub="Thank you. Your email address is now verified.">
        <Link to={user ? homeFor(user) : '/login'} className="btn btn--block">{user ? 'Open your workspace' : 'Sign in'}</Link>
      </Frame>
    );
  }
  return (
    <Frame title={state === 'missing' ? 'This link is incomplete' : 'We could not confirm your email'}>
      <Alert>{state === 'missing' ? 'The link is missing its code. Open the link from your email again.' : error}</Alert>
      <Link to={user ? homeFor(user) : '/login'} className="text-link">{user ? 'Go to your workspace to ask for a new link' : 'Sign in to ask for a new link'}</Link>
    </Frame>
  );
}