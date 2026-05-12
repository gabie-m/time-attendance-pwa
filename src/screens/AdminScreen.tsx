import { locations } from '../data/mockData';
import { MetricCard } from '../components/MetricCard';
import { Pill } from '../components/Pill';

export function AdminScreen() {
  return (
    <section className="screen desktop-grid">
      <header className="screen-header desktop-span">
        <div>
          <span className="eyebrow">Admin Controls</span>
          <h1>System Setup</h1>
          <p>Foundation screen for users, locations, schedules, and attendance rules.</p>
        </div>
        <Pill tone="info">Phase 1 shell</Pill>
      </header>

      <div className="metric-grid desktop-span">
        <MetricCard label="Users" value="42" detail="Active employees" />
        <MetricCard label="Managers" value="6" detail="Reporting owners" tone="success" />
        <MetricCard label="Locations" value={String(locations.length)} detail="Approved sites" tone="warn" />
        <MetricCard label="Overrides" value="2" detail="Temporary roving" tone="flag" />
      </div>

      <article className="panel wide-panel">
        <div className="panel-title">
          <h2>Approved Locations</h2>
          <Pill tone="success">Attendance always accepted</Pill>
        </div>
        <div className="table-list">
          {locations.map((location) => (
            <div className="table-row" key={location.id}>
              <strong>{location.name}</strong>
              <span>{location.address}</span>
              <span>{location.radiusMeters}m radius</span>
              <Pill tone={location.active ? 'success' : 'neutral'}>{location.active ? 'Active' : 'Inactive'}</Pill>
            </div>
          ))}
        </div>
      </article>

      <article className="panel">
        <div className="panel-title">
          <h2>Rule Priorities</h2>
          <Pill tone="flag">MVP</Pill>
        </div>
        <ul className="rule-list">
          <li>Never block attendance capture.</li>
          <li>Flag outside-radius records for review.</li>
          <li>Keep original events immutable.</li>
          <li>Use server time as official receipt time.</li>
        </ul>
      </article>
    </section>
  );
}
