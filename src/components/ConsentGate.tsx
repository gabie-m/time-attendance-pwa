import { useRef, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { Icon } from './Icon';

export function ConsentGate() {
  const { consentError, giveLocationConsent } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  async function handleConsent() {
    if (isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      await giveLocationConsent();
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

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
      {consentError ? <p role="alert">{consentError}</p> : null}
      <button className="action-button full" disabled={isSubmitting} onClick={() => void handleConsent()}>
        {isSubmitting ? 'Saving consent...' : 'I understand and agree'}
      </button>
    </article>
  );
}
