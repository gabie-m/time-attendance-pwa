import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Pill } from '../components/Pill';
import { useFlagReviewWorkflowSettings } from '../hooks/useFlagReviewWorkflowSettings';
import {
  flagReviewRecords,
  flagReviewWorkflowOptions,
  type FlagReviewRecord,
  type FlagReviewerDecisionStatus,
  type FlagReviewWorkflowMode,
  type FlagReviewWorkflowSetting
} from '../mocks/mockFlagReviewData';
import type { EventFlagType, FlagSeverity, FlagStatus } from '../mocks/mockAttendanceDetailData';
import { formatDecisionStatus, formatFlagType, getWorkflowCopy, getWorkflowOption } from '../utils/flagReviewWorkflow';

type FlagFilter = 'open' | 'all' | FlagStatus;

const flagFilters: Array<{ value: FlagFilter; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'resolved', label: 'Resolved' }
];

export function AdminFlagReviewScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFlagId = searchParams.get('flag');
  const [filter, setFilter] = useState<FlagFilter>('open');
  const workflowSettings = useFlagReviewWorkflowSettings();
  const visibleRecords = useMemo(() => {
    if (filter === 'all') {
      return flagReviewRecords;
    }

    return flagReviewRecords.filter((record) => record.status === filter);
  }, [filter]);
  const defaultRecord = flagReviewRecords.find((record) => record.id === initialFlagId) ?? visibleRecords[0] ?? flagReviewRecords[0];
  const [selectedFlagId, setSelectedFlagId] = useState(defaultRecord.id);
  const selectedRecord =
    flagReviewRecords.find((record) => record.id === selectedFlagId) ?? visibleRecords[0] ?? flagReviewRecords[0];
  const selectedWorkflowMode = getWorkflowModeForFlagType(selectedRecord.flagType, workflowSettings);
  const openCount = flagReviewRecords.filter((record) => record.status === 'open').length;
  const highSeverityCount = flagReviewRecords.filter((record) => record.severity === 'high' && record.status === 'open').length;

  function handleSelectRecord(record: FlagReviewRecord) {
    setSelectedFlagId(record.id);
    setSearchParams({ flag: record.id });
  }

  function handleFilterChange(nextFilter: FlagFilter) {
    setFilter(nextFilter);
    const nextRecords =
      nextFilter === 'all' ? flagReviewRecords : flagReviewRecords.filter((record) => record.status === nextFilter);
    const nextSelectedRecord = nextRecords[0] ?? flagReviewRecords[0];
    setSelectedFlagId(nextSelectedRecord.id);
    setSearchParams({ flag: nextSelectedRecord.id });
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <span className="eyebrow">Admin Review</span>
          <h1>Flag Review</h1>
          <p>Review attendance flags before they are cleared, escalated, or included in operational reporting.</p>
        </div>
        <Pill tone="info">Mock review UI</Pill>
      </header>

      <section className="metrics-grid">
        <div className="metric-card metric-flag">
          <span>Open flags</span>
          <strong>{openCount}</strong>
          <small>Awaiting admin review</small>
        </div>
        <div className="metric-card metric-danger">
          <span>High severity</span>
          <strong>{highSeverityCount}</strong>
          <small>Open high-priority cases</small>
        </div>
        <div className="metric-card metric-success">
          <span>Reviewed / resolved</span>
          <strong>{flagReviewRecords.length - openCount}</strong>
          <small>Audit trail retained</small>
        </div>
      </section>

      <section className="flag-review-layout">
        <article className="panel">
          <div className="panel-title">
            <h2>Review Queue</h2>
            <Pill tone="neutral">{visibleRecords.length}</Pill>
          </div>
          <div className="segmented-control" aria-label="Flag queue filter">
            {flagFilters.map((item) => (
              <button
                className={filter === item.value ? 'active' : ''}
                key={item.value}
                onClick={() => handleFilterChange(item.value)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flag-review-list">
            {visibleRecords.map((record) => (
              <button
                className={record.id === selectedRecord.id ? 'active' : ''}
                key={record.id}
                onClick={() => handleSelectRecord(record)}
                type="button"
              >
                <span>
                  <strong>{record.employeeName}</strong>
                  <small>{formatFlagType(record.flagType)} · {record.workDate}</small>
                </span>
                <span className="flag-review-list-status">
                  <Pill tone={getSeverityTone(record.severity)}>{record.severity}</Pill>
                  <Pill tone={getFlagStatusTone(record.status)}>{record.status}</Pill>
                </span>
              </button>
            ))}
          </div>
        </article>

        <FlagReviewDetail record={selectedRecord} workflowMode={selectedWorkflowMode} />
      </section>
    </section>
  );
}

function FlagReviewDetail({ record, workflowMode }: { record: FlagReviewRecord; workflowMode: FlagReviewWorkflowMode }) {
  const workflow = getWorkflowCopy(workflowMode);
  const requiresManagerPreApproval = workflowMode === 'manager_preapprove_admin_final';
  const isWaitingForManagerPreApproval = requiresManagerPreApproval && record.managerDecisionStatus === 'pending';

  return (
    <article className="panel flag-review-detail">
      <div className="panel-title">
        <div>
          <h2>{record.employeeName}</h2>
          <p>{record.employeeCode} · {record.staffType} · Manager: {record.managerName}</p>
        </div>
        <div className="approval-card-status">
          <Pill tone={getSeverityTone(record.severity)}>{record.severity}</Pill>
          <Pill tone={getFlagStatusTone(record.status)}>{record.status}</Pill>
        </div>
      </div>

      <div className="flag-review-summary">
        <div>
          <span className="eyebrow">Flag type</span>
          <strong>{formatFlagType(record.flagType)}</strong>
        </div>
        <div>
          <span className="eyebrow">Event</span>
          <strong>{record.eventLabel}</strong>
        </div>
        <div>
          <span className="eyebrow">Work date</span>
          <strong>{record.workDate}</strong>
        </div>
        <div>
          <span className="eyebrow">Submitted</span>
          <strong>{record.submittedAt}</strong>
        </div>
      </div>

      <section className="detail-section">
        <div className="panel-title">
          <h3>Review Context</h3>
          <Pill tone={record.priority === 'urgent' ? 'danger' : 'neutral'}>{record.priority}</Pill>
        </div>
        <p className="flag-review-note">{record.summary}</p>
        <div className="flag-review-summary">
          <div>
            <span className="eyebrow">Expected location</span>
            <strong>{record.expectedLocation}</strong>
          </div>
          <div>
            <span className="eyebrow">Captured location</span>
            <strong>{record.locationName}</strong>
          </div>
          <div>
            <span className="eyebrow">GPS coordinates</span>
            <strong>{record.gpsCoordinates}</strong>
          </div>
          <div>
            <span className="eyebrow">GPS accuracy</span>
            <strong>{record.gpsAccuracyMeters}m</strong>
          </div>
        </div>
      </section>

      <section className="detail-section">
        <div className="panel-title">
          <h3>Evidence</h3>
          <Pill tone="neutral">{record.evidence.length}</Pill>
        </div>
        <ul className="rule-list">
          {record.evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      {requiresManagerPreApproval ? (
        <section className="detail-section">
          <div className="panel-title">
            <h3>Manager Pre-Approval</h3>
            <Pill tone={getDecisionTone(record.managerDecisionStatus)}>
              {formatDecisionStatus(record.managerDecisionStatus)}
            </Pill>
          </div>
          <div className="approval-card">
            <div className="approval-card-header">
              <div>
                <span className="eyebrow">Manager action</span>
                <strong>
                  {record.managerDecision?.reviewerName
                    ? `${record.managerDecision.reviewerName} · ${record.managerDecision.reviewedAt}`
                    : 'Waiting for manager pre-approval'}
                </strong>
                <p>
                  {record.managerDecision?.remarks ??
                    'Admin can view this flag, but final approval is locked until the manager pre-approves or recommends rejection.'}
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="detail-section">
        <div className="panel-title">
          <h3>Admin Review Workflow</h3>
          <Pill tone={isWaitingForManagerPreApproval ? 'warn' : 'info'}>
            {isWaitingForManagerPreApproval ? 'Waiting for manager' : getWorkflowOption(workflowMode).label}
          </Pill>
        </div>
        {isWaitingForManagerPreApproval ? (
          <p className="queue-disclaimer">
            This flag is visible to Admin, but no Admin approval action is available until Manager pre-approval is submitted.
          </p>
        ) : null}
        <div className="approval-card">
          <div className="approval-card-header">
            <div>
              <span className="eyebrow">Admin responsibility</span>
              <strong>{workflow.adminTitle}</strong>
              <p>{workflow.adminDescription}</p>
            </div>
            <Pill tone={getDecisionTone(record.adminDecisionStatus)}>
              {formatDecisionStatus(record.adminDecisionStatus)}
            </Pill>
          </div>
          <div className="inline-actions">
            {workflow.adminActions.map((action) => (
              <button
                disabled
                key={action}
                title={
                  isWaitingForManagerPreApproval
                    ? 'Waiting for manager pre-approval'
                    : 'Admin flag actions will be wired in a future update'
                }
              >
                {action}
              </button>
            ))}
            <button
              className="secondary"
              disabled
              title={isWaitingForManagerPreApproval ? 'Waiting for manager pre-approval' : 'Flag review actions coming soon'}
            >
              Escalate
            </button>
          </div>
        </div>
      </section>

      <section className="detail-section">
        <div className="panel-title">
          <h3>Remarks</h3>
          <Pill tone="neutral">Required on action</Pill>
        </div>
        <label className="remarks-field">
          Remarks
          <textarea disabled placeholder="Flag review remarks will be saved once backend audit actions are available." rows={4} />
        </label>
        <Link className="text-button" to={`/admin/attendance/${record.employeeId}`}>
          View employee attendance detail
        </Link>
      </section>
    </article>
  );
}

function getWorkflowModeForFlagType(flagType: EventFlagType, workflowSettings: FlagReviewWorkflowSetting[]) {
  return workflowSettings.find((setting) => setting.flagType === flagType)?.workflowMode ?? flagReviewWorkflowOptions[0].id;
}

function getDecisionTone(status: FlagReviewerDecisionStatus) {
  if (status === 'approved' || status === 'pre_approved') {
    return 'success';
  }

  if (status === 'rejected') {
    return 'danger';
  }

  if (status === 'not_required') {
    return 'neutral';
  }

  return 'warn';
}

function getSeverityTone(severity: FlagSeverity) {
  return severity === 'high' ? 'danger' : 'warn';
}

function getFlagStatusTone(status: FlagStatus) {
  if (status === 'resolved' || status === 'reviewed') {
    return 'success';
  }

  return 'warn';
}
