import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';

export function LoginScreen() {
  return (
    <section className="login-screen">
      <div className="login-brand">
        <Icon name="logo" size={38} />
        <span>Muster</span>
      </div>
      <div className="login-panel">
        <h1>Welcome back</h1>
        <p>Sign in to capture attendance, monitor field visits, and review pending syncs.</p>
        <label>
          Email
          <input type="email" defaultValue="maria@example.com" />
        </label>
        <label>
          Password
          <input type="password" defaultValue="password" />
        </label>
        <Link className="primary-button" to="/stationary">Sign in</Link>
      </div>
    </section>
  );
}
