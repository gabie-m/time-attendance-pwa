import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMockAuth } from '../auth/useMockAuth';
import { Pill } from '../components/Pill';
import { useFlagReviewRecords } from '../hooks/useFlagReviewRecords';
import { useFlagReviewWorkflowSettings } from '../hooks/useFlagReviewWorkflowSettings';
import {
  flagReviewWorkflowOptions,
  type FlagReviewRecord,
  type FlagReviewerDecisionStatus,
  type FlagReviewWorkflowMode,
  type FlagReviewWorkflowSetting
} from '../mocks/mockFlagReviewData';
import type { EventFlagType, FlagSeverity, FlagStatus } from '../mocks/mockAttendanceDetailData';
import { reviewFlagAsAdmin, type AdminFlagReviewAction } from '../services/mockFlagReviewService';
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
  const { user } = useMockAuth();
  const initialFlagId = searchParams.get('flag');
  const [filter, setFilter] = useState<FlagFilter>('open');
  const flagReviewRecords = useFlagReviewRecords();
  const workflowSettings = useFlagReviewWorkflowSettings();
  const visibleRecords = useMemo(() => {
    if (filter === 'all') {
      return flagReviewRecords;
    }

    return flagReviewRecords.filter((record) => record.status === filter);
  }, [filter, flagReviewRecords]);
  const defaultRecord = flagReviewRecords.find((record) => record.id === initialFlagId) ?? visibleRecords[0] ?? flagReviewRecords[0];
  const [selectedFlagId, setSelectedFlagId] = useState(defaultRecord?.id ?? '');
  const selectedRecord =
    flagReviewRecords.find((record) => record.id === selectedFlagId) ?? visibleRecords[0] ?? flagReviewRecords[0];
  const selectedWorkflowMode = selectedRecord
    ? getWorkflowModeForFlagType(selectedRecord.flagType, workflowSettings)
    : flagReviewWorkflowOptions[0].id;
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
    setSelectedFlagId(nextSelectedRecord?.id ?? '');
    if (nextSelectedRecord) {
      setSearchParams({ flag: nextSelectedRecord.id });
    }
  }

  function handleAdminAction(record: FlagReviewRecord, workflowMode: FlagReviewWorkflowMode, action: AdminFlagReviewAction, remarks: string) {
    return reviewFlagAsAdmin({
      recordId: record.id,
      workflowMode,
      action,
      actorName: user.name,
      remarks
    });
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <span className="eyebrow">Admin Review</span>
          <h1>Flag Review</h1>
          <p>Review attendance flags before they are cleared or included in operational reporting.</p>
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
                  <Pill tone={getFlagStatusTone(record.status)}>{record.status}</Pill>
                </span>
              </button>
            ))}
          </div>
        </article>

        {selectedRecord ? (
          <FlagReviewDetail
            onAction={handleAdminAction}
            record={selectedRecord}
            workflowMode={selectedWorkflowMode}
          />
        ) : (
          <article className="panel empty-state">
            <strong>No flags to review</strong>
            <p>All attendance flags have been resolved.</p>
          </article>
        )}
      </section>
    </section>
  );
}

function FlagReviewDetail({
  onAction,
  record,
  workflowMode
}: {
  onAction: (
    record: FlagReviewRecord,
    workflowMode: FlagReviewWorkflowMode,
    action: AdminFlagReviewAction,
    remarks: string
  ) => { ok: true } | { ok: false; error: string };
  record: FlagReviewRecord;
  workflowMode: FlagReviewWorkflowMode;
}) {
  const workflow = getWorkflowCopy(workflowMode);
  const requiresManagerPreApproval = workflowMode === 'manager_preapprove_admin_final';
  const isWaitingForManagerPreApproval = requiresManagerPreApproval && record.managerDecisionStatus === 'pending';
  const canMakeDecision = !isWaitingForManagerPreApproval && record.adminDecisionStatus === 'pending';
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  function handleAction(action: AdminFlagReviewAction) {
    const result = onAction(record, workflowMode, action, remarks);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }

    setRemarks('');
    setMessage('Admin review action saved to mock history.');
  }

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
        {record.evidence?.length ? (
          <ul className="rule-list">
            {record.evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="queue-disclaimer">No evidence captured for this flag.</p>
        )}
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
        </div>
      </section>

      <section className="detail-section">
        <div className="panel-title">
          <h3>Remarks</h3>
          <Pill tone="neutral">Required on action</Pill>
        </div>
        <label className="remarks-field">
          Remarks
          <textarea
            disabled={!canMakeDecision}
            onChange={(event) => setRemarks(event.target.value)}
            placeholder={
              canMakeDecision
                ? 'Enter admin review remarks before taking action.'
                : 'Admin review action is not currently available.'
            }
            rows={4}
            value={remarks}
          />
        </label>
        <div className="inline-actions">
          {getAdminActions(workflowMode).map((action) => (
            <button
              disabled={!canMakeDecision}
              key={action.id}
              onClick={() => handleAction(action.id)}
              title={getAdminActionTitle(canMakeDecision, isWaitingForManagerPreApproval)}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
        {message ? <p className={message.includes('saved') ? 'form-message success' : 'form-warning'}>{message}</p> : null}
        <Link className="text-button" to={`/admin/attendance/${record.employeeId}`}>
          View employee attendance detail
        </Link>
      </section>

      <section className="detail-section">
        <div className="panel-title">
          <h3>Action History</h3>
          <Pill tone="neutral">{record.actionHistory?.length ?? 0}</Pill>
        </div>
        <FlagActionHistory record={record} />
      </section>
    </article>
  );
}

function getAdminActions(workflowMode: FlagReviewWorkflowMode): Array<{ id: AdminFlagReviewAction; label: string }> {
  if (workflowMode === 'manager_review_admin_observe') {
    return [{ id: 'mark_reviewed', label: 'Mark Admin Reviewed' }];
  }

  if (workflowMode === 'manager_preapprove_admin_final') {
    return [
      { id: 'approve', label: 'Final Approve' },
      { id: 'reject', label: 'Final Reject' },
      { id: 'resolve', label: 'Mark Resolved' }
    ];
  }

  return [
    { id: 'approve', label: 'Approve Flag' },
    { id: 'reject', label: 'Reject Flag' },
    { id: 'resolve', label: 'Mark Resolved' }
  ];
}

function getAdminActionTitle(canMakeDecision: boolean, isWaitingForManagerPreApproval: boolean) {
  if (isWaitingForManagerPreApproval) {
    return 'Waiting for manager pre-approval';
  }

  if (!canMakeDecision) {
    return 'Admin decision has already been submitted';
  }

  return 'Save admin review action';
}

function FlagActionHistory({ record }: { record: FlagReviewRecord }) {
  const history = record.actionHistory ?? [];

  if (history.length === 0) {
    return (
      <div className="empty-state compact">
        <strong>No actions yet</strong>
        <p>Mock review actions will appear here after manager or admin review.</p>
      </div>
    );
  }

  return (
    <div className="action-history-list">
      {history.map((item) => (
        <div className="action-history-item" key={item.id}>
          <div>
            <strong>{item.actionLabel}</strong>
            <p>{item.remarks}</p>
          </div>
          <span>{item.actorName} · {item.createdAt}</span>
        </div>
      ))}
    </div>
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
