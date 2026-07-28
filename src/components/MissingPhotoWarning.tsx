import { Icon } from './Icon';

/*
 * Logic-driven props: action label and confirm/cancel callbacks.
 * Display-only: markup and visual treatment may be adjusted by the UI agent.
 */
type MissingPhotoWarningProps = {
  actionLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function MissingPhotoWarning({ actionLabel, onCancel, onConfirm }: MissingPhotoWarningProps) {
  return (
    <article className="location-warning" role="alert">
      <div className="warning-icon">
        <Icon name="flag" size={24} />
      </div>
      <div>
        <span className="eyebrow">Photo confirmation</span>
        <h2>Continue {actionLabel} without a photo?</h2>
        <p>
          A photo is normally required for this attendance action. The action will be recorded,
          then flagged for manager or admin review.
        </p>
      </div>
      <div className="inline-actions">
        <button onClick={onConfirm}>Confirm without photo</button>
        <button className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </article>
  );
}
