import { MetricCard } from '../components/MetricCard';
import { Pill } from '../components/Pill';

const bars = [
  ['Mon', 8, 1, 0],
  ['Tue', 7, 0.5, 0.5],
  ['Wed', 8, 2, 0],
  ['Thu', 6.5, 0, 1],
  ['Fri', 8, 1.5, 0]
] as const;

export function ReportsScreen() {
  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <span className="eyebrow">Payroll-ready exports</span>
          <h1>My Reports</h1>
          <p>Exports remain separate from payroll but include calculated values.</p>
        </div>
        <Pill tone="sync">CSV · XLSX · PDF</Pill>
      </header>

      <div className="metric-grid">
        <MetricCard label="Regular" value="38.5h" detail="Selected week" />
        <MetricCard label="Overtime" value="5.0h" detail="Auto-calculated" tone="flag" />
        <MetricCard label="Undertime" value="1.5h" detail="Needs review" tone="warn" />
      </div>

      <article className="panel">
        <div className="panel-title">
          <h2>Hours Breakdown</h2>
          <Pill tone="success">Backend-owned logic</Pill>
        </div>
        <div className="bar-chart">
          {bars.map(([day, regular, overtime, undertime]) => {
            const total = regular + overtime + undertime;
            return (
              <div className="bar-column" key={day}>
                <div className="bar-stack" style={{ height: `${total * 14}px` }}>
                  <span className="bar-regular" style={{ flex: regular }} />
                  <span className="bar-overtime" style={{ flex: overtime }} />
                  <span className="bar-undertime" style={{ flex: undertime }} />
                </div>
                <small>{day}</small>
              </div>
            );
          })}
        </div>
      </article>

      <div className="export-grid">
        {['CSV', 'Excel', 'PDF'].map((format) => (
          <button className="export-card" key={format}>
            <strong>{format}</strong>
            <span>{format === 'CSV' ? 'Payroll import' : format === 'Excel' ? 'Operations review' : 'Signed summary'}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
