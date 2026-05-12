type MetricCardProps = {
  label: string;
  value: string;
  detail: string;
  tone?: 'indigo' | 'success' | 'warn' | 'danger' | 'flag';
};

export function MetricCard({ label, value, detail, tone = 'indigo' }: MetricCardProps) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
