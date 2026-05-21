import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { getDefaultRouteForUser } from '../auth/permissions';
import { useAuth } from '../auth/useAuth';
import { Icon } from '../components/Icon';

type LoginLocationState = {
  from?: {
    pathname?: string;
  };
};

export function LoginScreen() {
  const { loading, signIn, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const locationState = location.state as LoginLocationState | null;
  const redirectPath = locationState?.from?.pathname;

  if (!loading && user) {
    return <Navigate to={redirectPath ?? getDefaultRouteForUser(user)} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    const result = await signIn(email, password);

    setSubmitting(false);

    if (!result.success) {
      setMessage(result.error);
      return;
    }

    navigate(redirectPath ?? getDefaultRouteForUser(result.data), { replace: true });
  }

  return (
    <section className="login-screen">
      <div className="login-brand">
        <Icon name="logo" size={38} />
        <span>Muster</span>
      </div>
      <div className="login-panel">
        <h1>Welcome back</h1>
        <p>Sign in to capture attendance, monitor field visits, and review pending syncs.</p>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setMessage(null);
              }}
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setMessage(null);
              }}
              autoComplete="current-password"
            />
          </label>
          {message ? <p className="form-warning">{message}</p> : null}
          <button className="primary-button" type="submit" disabled={submitting || loading}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </section>
  );
}
