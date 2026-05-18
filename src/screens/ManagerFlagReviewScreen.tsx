import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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

type FlagFilter = 'pending' | 'all' | FlagStatus;

const flagFilters: Array<{ value: FlagFilter; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'all', label: 'All' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'resolved', label: 'Resolved' }
];

export function ManagerFlagReviewScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFlagId = searchParams.get('flag');
  const [filter, setFilter] = useState<FlagFilter>('pending');
  const workflowSettings = useFlagReviewWorkflowSettings();
  const managerVisibleRecords = flagReviewRecords;
  const visibleRecords = useMemo(() => {
    if (filter === 'all') {
      return managerVisibleRecords;
    }

    if (filter === 'pending') {
      return managerVisibleRecords.filter((record) => record.managerDecisionStatus === 'pending');
    }

    return managerVisibleRecords.filter((record) => record.status === filter);
  }, [filter, managerVisibleRecords]);
  const defaultRecord = managerVisibleRecords.find((record) => record.id === initialFlagId) ?? visibleRecords[0] ?? managerVisibleRecords[0];
  const [selectedFlagId, setSelectedFlagId] = useState(defaultRecord?.id ?? '');
  const selectedRecord =
    managerVisibleRecords.find((record) => record.id === selectedFlagId) ?? visibleRecords[0] ?? managerVisibleRecords[0];
  const selectedWorkflowMode = selectedRecord
    ? getWorkflowModeForFlagType(selectedRecord.flagType, workflowSettings)
    : flagReviewWorkflowOptions[0].id;
  const pendingCount = managerVisibleRecords.filter((record) => record.managerDecisionStatus === 'pending').length;
  const highSeverityCount = managerVisibleRecords.filter((record) => {
    const workflowMode = getWorkflowModeForFlagType(record.flagType, workflowSettings);
    return (
      record.severity === 'high' &&
      workflowMode !== 'manager_view_admin_approve' &&
      record.managerDecisionStatus === 'pending'
    );
  }).length;

  function handleSelectRecord(record: FlagReviewRecord) {
    setSelectedFlagId(record.id);
    setSearchParams({ flag: record.id });
  }

  function handleFilterChange(nextFilter: FlagFilter) {
    setFilter(nextFilter);
    const nextRecords =
      nextFilter === 'all'
        ? managerVisibleRecords
        : nextFilter === 'pending'
          ? managerVisibleRecords.filter((record) => record.managerDecisionStatus === 'pending')
          : managerVisibleRecords.filter((record) => record.status === nextFilter);
    const nextSelectedRecord = nextRecords[0] ?? managerVisibleRecords[0];
    setSelectedFlagId(nextSelectedRecord?.id ?? '');
    if (nextSelectedRecord) {
      setSearchParams({ flag: nextSelectedRecord.id });
    }
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <span className="eyebrow">Manager Review</span>
          <h1>Flag Review</h1>
          <p>Review team attendance flags that require manager action under the configured workflow.</p>
        </div>
        <Pill tone="info">Mock review UI</Pill>
      </header>

      <section className="metrics-grid">
        <div className="metric-card metric-flag">
          <span>Pending manager action</span>
          <strong>{pendingCount}</strong>
          <small>Assigned review items</small>
        </div>
        <div className="metric-card metric-danger">
          <span>High severity</span>
          <strong>{highSeverityCount}</strong>
          <small>Needs prompt attention</small>
        </div>
        <div className="metric-card metric-success">
          <span>Visible flags</span>
          <strong>{managerVisibleRecords.length}</strong>
          <small>Includes visibility-only items</small>
        </div>
      </section>

      <section className="flag-review-layout">
        <article className="panel">
          <div className="panel-title">
            <h2>Manager Review Queue</h2>
            <Pill tone="neutral">{visibleRecords.length}</Pill>
          </div>
          <div className="segmented-control" aria-label="Manager flag queue filter">
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
                className={record.id === selectedRecord?.id ? 'active' : ''}
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
                  <Pill tone={getDecisionTone(record.managerDecisionStatus)}>
                    {formatDecisionStatus(record.managerDecisionStatus)}
                  </Pill>
                </span>
              </button>
            ))}
          </div>
        </article>

        {selectedRecord ? (
          <ManagerFlagReviewDetail record={selectedRecord} workflowMode={selectedWorkflowMode} />
        ) : (
          <article className="panel empty-state">
            <strong>No flag review items</strong>
            <p>No attendance flags are visible in the current queue filter.</p>
          </article>
        )}
      </section>
    </section>
  );
}

function ManagerFlagReviewDetail({
  record,
  workflowMode
}: {
  record: FlagReviewRecord;
  workflowMode: FlagReviewWorkflowMode;
}) {
  const workflow = getWorkflowCopy(workflowMode);
  const isVisibilityOnly = workflowMode === 'manager_view_admin_approve';

  return (
    <article className="panel flag-review-detail">
      <div className="panel-title">
        <div>
          <h2>{record.employeeName}</h2>
          <p>{record.employeeCode} · {record.staffType} · {record.locationName}</p>
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
          <h3>Manager Review Workflow</h3>
          <Pill tone={isVisibilityOnly ? 'neutral' : 'info'}>{getWorkflowOption(workflowMode).label}</Pill>
        </div>
        {isVisibilityOnly ? (
          <p className="queue-disclaimer">
            Visibility only. Admin settings require the manager to see this flag, but no manager approval action is required.
          </p>
        ) : null}
        <div className="approval-card">
          <div className="approval-card-header">
            <div>
              <span className="eyebrow">Manager responsibility</span>
              <strong>{workflow.managerTitle}</strong>
              <p>{workflow.managerDescription}</p>
            </div>
            <Pill tone={getDecisionTone(record.managerDecisionStatus)}>
              {formatDecisionStatus(record.managerDecisionStatus)}
            </Pill>
          </div>
          <div className="inline-actions">
            {workflow.managerActions.map((action) => {
              const title = isVisibilityOnly
                ? 'No manager action required for this configured workflow'
                : 'Manager flag actions will be wired in a future update';

              return (
                <button disabled key={action} title={title}>
                  {action}
                </button>
              );
            })}
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
          <textarea disabled placeholder="Manager review remarks will be saved once backend audit actions are available." rows={4} />
        </label>
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
