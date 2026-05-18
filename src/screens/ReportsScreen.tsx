import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Pill } from '../components/Pill';
import {
  absenceRows,
  attendanceSummaryRows,
  flaggedRows,
  lateUndertimeRows,
  manualEditRows,
  overtimeRows,
  reportTabs,
  type ReportTab
} from '../mocks/mockReportData';

export function ReportsScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = getValidReportTab(searchParams.get('tab'));
  const [activeTab, setActiveTab] = useState<ReportTab>(initialTab);
  const currentTab = reportTabs.find((tab) => tab.id === activeTab);

  function handleSelectTab(tab: ReportTab) {
    setActiveTab(tab);
    setSearchParams({ tab });
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <span className="eyebrow">Admin Reporting</span>
          <h1>Admin Reports</h1>
          <p>Static report mockups for reviewing attendance across all users, managers, and locations.</p>
        </div>
        <Pill tone="info">Display only</Pill>
      </header>

      <div className="report-tab-bar" role="tablist" aria-label="Admin report tabs">
        {reportTabs.map((tab) => (
          <button
            className={activeTab === tab.id ? 'active' : ''}
            key={tab.id}
            onClick={() => handleSelectTab(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <article className="panel">
        <div className="panel-title">
          <h2>{currentTab?.label}</h2>
          <Pill tone="neutral">Mock data</Pill>
        </div>
        <ReportFilters showEmployeeFilter={activeTab === 'attendance-summary'} />
        {activeTab === 'attendance-summary' ? <AttendanceSummaryReport /> : null}
        {activeTab === 'late-undertime' ? <LateUndertimeReport /> : null}
        {activeTab === 'absences' ? <AbsencesReport /> : null}
        {activeTab === 'overtime' ? <OvertimeReport /> : null}
        {activeTab === 'flagged-records' ? <FlaggedRecordsReport /> : null}
        {activeTab === 'manual-edit-requests' ? <ManualEditRequestsReport /> : null}
      </article>
    </section>
  );
}

function ReportFilters({ showEmployeeFilter = false }: { showEmployeeFilter?: boolean }) {
  return (
    <div className="report-filter-bar">
      <label>
        From
        <input type="date" defaultValue="2026-05-01" />
      </label>
      <label>
        To
        <input type="date" defaultValue="2026-05-11" />
      </label>
      {showEmployeeFilter ? (
        <label>
          Employee name
          <input placeholder="Search employee" />
        </label>
      ) : null}
      <button disabled title="Export available in a future update">
        Export
      </button>
    </div>
  );
}

function AttendanceSummaryReport() {
  return (
    <ReportTable
      headers={['Employee', 'Work date', 'Time in', 'Time out', 'Hours worked', 'Late min', 'Undertime', 'Overtime']}
      rows={attendanceSummaryRows}
    />
  );
}

function LateUndertimeReport() {
  return (
    <ReportTable
      headers={['Employee', 'Work date', 'Location', 'Late minutes', 'Undertime minutes']}
      rows={lateUndertimeRows}
    />
  );
}

function AbsencesReport() {
  return (
    <ReportTable
      headers={['Employee', 'Work date', 'Expected location', 'Scheduled shift']}
      rows={absenceRows}
    />
  );
}

function OvertimeReport() {
  return (
    <ReportTable
      headers={['Employee', 'Work date', 'Location', 'Overtime minutes']}
      rows={overtimeRows}
    />
  );
}

function FlaggedRecordsReport() {
  return (
    <>
      <div className="report-action-row">
        <Link className="text-button" to="/admin/flags">Open flag review queue</Link>
      </div>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th>Employee name</th>
              <th>Date</th>
              <th>Flag type</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {flaggedRows.map(([employeeId, employee, date, flagType, severity, status]) => (
              <tr key={`${employeeId}-${date}-${flagType}`}>
                <td>{employee}</td>
                <td>{date}</td>
                <td>{flagType}</td>
                <td>{severity}</td>
                <td>{status}</td>
                <td>
                  <Link to={`/admin/attendance/${employeeId}`}>View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function getValidReportTab(value: string | null): ReportTab {
  return reportTabs.some((tab) => tab.id === value) ? (value as ReportTab) : 'attendance-summary';
}

function ManualEditRequestsReport() {
  return (
    <ReportTable
      headers={['Employee name', 'Request type', 'Reason', 'Date submitted', 'Status']}
      rows={manualEditRows}
    />
  );
}

function ReportTable({ headers, rows }: { headers: string[]; rows: string[][] | readonly string[][] }) {
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join('-')}>
              {row.map((cell) => (
                <td key={cell}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
