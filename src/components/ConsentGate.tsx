import { useAuth } from '../auth/useAuth';
import { Icon } from './Icon';

export function ConsentGate() {
  const { giveLocationConsent } = useAuth();

  return (
    <article className="consent-panel">
      <div className="consent-icon">
        <Icon name="pin" size={30} />
      </div>
      <div>
        <span className="eyebrow">Location consent required</span>
        <h2>Before your first attendance action</h2>
        <p>
          This app captures your location only when you submit an attendance action, and
          approximately every 1.5 hours while you are timed in.
        </p>
      </div>
      <button className="action-button full" onClick={giveLocationConsent}>
        I understand and agree
      </button>
    </article>
  );
}
