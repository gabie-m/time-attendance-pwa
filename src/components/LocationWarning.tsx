import type { GeoCheckResult } from '../utils/geo';
import { Icon } from './Icon';

type LocationWarningProps = {
  result: GeoCheckResult;
  actionLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function LocationWarning({ result, actionLabel, onCancel, onConfirm }: LocationWarningProps) {
  return (
    <article className="location-warning" role="alert">
      <div className="warning-icon">
        <Icon name="flag" size={24} />
      </div>
      <div>
        <span className="eyebrow">Location warning</span>
        <h2>{actionLabel} is outside the normal validation result</h2>
        <p>{result.message}</p>
        <p>This record will still be accepted, but it will be flagged for manager/admin review.</p>
      </div>
      <div className="inline-actions">
        <button onClick={onConfirm}>Confirm and flag</button>
        <button className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </article>
  );
}
