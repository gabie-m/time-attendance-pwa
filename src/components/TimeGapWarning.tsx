import { Icon } from './Icon';

type TimeGapWarningProps = {
  actionLabel: string;
  previousActionLabel: string;
  gapMinutes: number;
  onCancel: () => void;
  onConfirm: () => void;
};

export function TimeGapWarning({
  actionLabel,
  previousActionLabel,
  gapMinutes,
  onCancel,
  onConfirm
}: TimeGapWarningProps) {
  return (
    <article className="location-warning" role="alert">
      <div className="warning-icon">
        <Icon name="clock" size={24} />
      </div>
      <div>
        <span className="eyebrow">Short time gap</span>
        <h2>Confirm {actionLabel}</h2>
        <p>
          Only {gapMinutes} minutes have passed since {previousActionLabel}. Attendance will be
          accepted, but this may be reviewed if it looks unusual.
        </p>
      </div>
      <div className="inline-actions">
        <button onClick={onConfirm}>Confirm action</button>
        <button className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </article>
  );
}
