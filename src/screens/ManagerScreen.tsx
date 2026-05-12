import { useState } from 'react';
import { mockUsers } from '../auth/mockUsers';
import { useMockAuth } from '../auth/useMockAuth';
import { managerRows } from '../data/mockData';
import { MetricCard } from '../components/MetricCard';
import { Pill } from '../components/Pill';
import {
  getSessionById,
  requestTypeLabels,
  reviewManualEditRequest,
  useManualEditRequests,
  type ManualEditRequest,
  type RequestStatus
} from '../services/mockManualEditService';

type ManagerRequestFilter = 'all' | RequestStatus;

const managerRequestFilters: Array<{ value: ManagerRequestFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' }
];

export function ManagerScreen() {
  const { user } = useMockAuth();
  const allRequests = useManualEditRequests();
  const pendingRequests = allRequests.filter((request) => request.status === 'pending');
  const approvedRequests = allRequests.filter((request) => request.status === 'approved');
  const rejectedRequests = allRequests.filter((request) => request.status === 'rejected');
  const [requestFilter, setRequestFilter] = useState<ManagerRequestFilter>('pending');
  const [remarksByRequest, setRemarksByRequest] = useState<Record<string, string>>({});
  const [messageByRequest, setMessageByRequest] = useState<Record<string, string>>({});
  const visibleRequests = allRequests.filter((request) => {
    return requestFilter === 'all' || request.status === requestFilter;
  });

  function handleReview(requestId: string, decision: 'approved' | 'rejected') {
    const result = reviewManualEditRequest({
      request_id: requestId,
      decision,
      manager_id: user.id,
      manager_remarks: remarksByRequest[requestId] ?? ''
    });

    if (!result.ok) {
      setMessageByRequest((current) => ({ ...current, [requestId]: result.error }));
      return;
    }

    setMessageByRequest((current) => ({ ...current, [requestId]: `Request ${decision}.` }));
  }

  return (
    <section className="screen desktop-grid">
      <header className="screen-header desktop-span">
        <div>
          <span className="eyebrow">Manager Dashboard</span>
          <h1>My Team</h1>
          <p>Operational view for assigned staff only.</p>
        </div>
        <Pill tone="flag">{pendingRequests.length} approvals</Pill>
      </header>

      <div className="metric-grid desktop-span">
        <MetricCard label="Timed in" value="18" detail="Across assigned locations" tone="success" />
        <MetricCard label="Late" value="3" detail="Past scheduled start" tone="warn" />
        <MetricCard label="Flagged" value="5" detail="GPS, offline, conflicts" tone="flag" />
        <MetricCard label="Approvals" value={String(pendingRequests.length)} detail={`${approvedRequests.length} approved · ${rejectedRequests.length} rejected`} />
      </div>

      <article className="panel wide-panel">
        <div className="panel-title">
          <h2>Live Staff Status</h2>
          <Pill tone="success">Assigned team</Pill>
        </div>
        <div className="table-list">
          {managerRows.map(([name, status, location, review]) => (
            <div className="table-row" key={name}>
              <strong>{name}</strong>
              <span>{status}</span>
              <span>{location}</span>
              <Pill tone={review === 'Normal' ? 'success' : review === 'Flagged' ? 'flag' : 'warn'}>
                {review}
              </Pill>
            </div>
          ))}
        </div>
      </article>

      <article className="panel">
        <div className="panel-title">
          <h2>Manual Edit Reviews</h2>
          <Pill tone="warn">{pendingRequests.length} pending</Pill>
        </div>
        <p className="queue-disclaimer">Assignment-based filtering applied when staff assignments are configured.</p>
        <div className="segmented-control" role="tablist" aria-label="Manual edit request filter">
          {managerRequestFilters.map((item) => (
            <button
              className={requestFilter === item.value ? 'active' : ''}
              key={item.value}
              onClick={() => setRequestFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="approval-list">
          {visibleRequests.length === 0 ? (
            <div className="empty-state">
              <strong>No manual edits found</strong>
              <p>Requests matching this filter will appear here.</p>
            </div>
          ) : null}
          {visibleRequests.map((item) => (
            <ManagerRequestCard
              item={item}
              key={item.id}
              managerRemarks={remarksByRequest[item.id] ?? ''}
              message={messageByRequest[item.id]}
              onRemarksChange={(remarks) =>
                setRemarksByRequest((current) => ({ ...current, [item.id]: remarks }))
              }
              onReview={handleReview}
            />
          ))}
        </div>
      </article>
    </section>
  );
}

function ManagerRequestCard({
  item,
  managerRemarks,
  message,
  onRemarksChange,
  onReview
}: {
  item: ManualEditRequest;
  managerRemarks: string;
  message?: string;
  onRemarksChange: (remarks: string) => void;
  onReview: (requestId: string, decision: 'approved' | 'rejected') => void;
}) {
  const requester = mockUsers.find((mockUser) => mockUser.id === item.user_id);
  const session = getSessionById(item.attendance_session_id);

  return (
    <div className="approval-card">
      <div className="approval-card-header">
        <div>
          <span className="eyebrow">Requested by</span>
          <strong>{requester?.name ?? item.user_id}</strong>
          <p>{requester ? `${requester.attendanceModel} · ${requester.expectedLocation}` : 'Unknown staff record'}</p>
        </div>
        <div className="approval-card-status">
          <Pill tone={item.status === 'pending' ? 'warn' : item.status === 'approved' ? 'success' : 'danger'}>
            {item.status}
          </Pill>
          <Pill tone="neutral">{requestTypeLabels[item.request_type]}</Pill>
        </div>
      </div>
      <span>{session?.label ?? item.attendance_session_id}</span>
      <p>{item.reason}</p>
      <p>{item.requested_payload[0]?.field}: {String(item.requested_payload[0]?.new_value ?? '')}</p>

      {item.status === 'pending' ? (
        <>
          <label className="remarks-field">
            Manager remarks
            <textarea
              value={managerRemarks}
              onChange={(event) => onRemarksChange(event.target.value)}
              placeholder="e.g., Verified with shift log - time in was 8:05am"
            />
          </label>
          {message ? <p className="form-message">{message}</p> : null}
          <div className="inline-actions">
            <button onClick={() => onReview(item.id, 'approved')}>Approve</button>
            <button className="secondary" onClick={() => onReview(item.id, 'rejected')}>Reject</button>
          </div>
        </>
      ) : (
        <p className="manager-remarks">Manager remarks: {item.manager_remarks}</p>
      )}
    </div>
  );
}
