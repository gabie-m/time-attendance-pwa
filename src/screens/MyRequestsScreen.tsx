import { useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { MetricCard } from '../components/MetricCard';
import { Pill } from '../components/Pill';
import {
  cancelManualEditRequest,
  getSessionById,
  requestTypeLabels,
  useManualEditRequests,
  type RequestStatus
} from '../services/mockManualEditService';

type RequestFilter = 'all' | RequestStatus;

const filters: Array<{ value: RequestFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' }
];

export function MyRequestsScreen() {
  const { user: authUser } = useAuth();
  const user = authUser!;
  const allRequests = useManualEditRequests();
  const [filter, setFilter] = useState<RequestFilter>('all');
  const [message, setMessage] = useState('');
  const userRequests = useMemo(() => {
    return allRequests
      .filter((request) => request.user_id === user.id)
      .filter((request) => filter === 'all' || request.status === filter);
  }, [allRequests, filter, user.id]);
  const allUserRequests = allRequests.filter((request) => request.user_id === user.id);
  const pendingCount = allUserRequests.filter((request) => request.status === 'pending').length;
  const approvedCount = allUserRequests.filter((request) => request.status === 'approved').length;
  const rejectedCount = allUserRequests.filter((request) => request.status === 'rejected').length;

  function handleCancel(requestId: string) {
    const result = cancelManualEditRequest(requestId, user.id);
    setMessage(result.ok ? 'Pending request cancelled.' : result.error);
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <span className="eyebrow">My Requests</span>
          <h1>My Requests</h1>
          <p>Track correction requests and manager remarks without changing original attendance records.</p>
        </div>
        <Pill tone={pendingCount > 0 ? 'warn' : 'success'}>{pendingCount} pending</Pill>
      </header>

      <div className="metric-grid">
        <MetricCard label="Pending" value={String(pendingCount)} detail="Awaiting manager action" tone="warn" />
        <MetricCard label="Approved" value={String(approvedCount)} detail="Adjustment created" tone="success" />
        <MetricCard label="Rejected" value={String(rejectedCount)} detail="Can be resubmitted" tone="flag" />
      </div>

      <article className="panel">
        <div className="panel-title">
          <h2>Request History</h2>
          <Pill tone="sync">Audit visible</Pill>
        </div>
        <div className="segmented-control" role="tablist" aria-label="Request status filter">
          {filters.map((item) => (
            <button
              className={filter === item.value ? 'active' : ''}
              key={item.value}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {message ? <p className="form-message">{message}</p> : null}

        <div className="request-list">
          {userRequests.length === 0 ? (
            <div className="empty-state">
              <strong>No requests found</strong>
              <p>Requests you submit from Stationary or Roving attendance will appear here.</p>
            </div>
          ) : null}
          {userRequests.map((request) => {
            const session = getSessionById(request.attendance_session_id);
            return (
              <div className="request-card" key={request.id}>
                <div>
                  <strong>{requestTypeLabels[request.request_type]}</strong>
                  <p>{session?.label ?? request.attendance_session_id}</p>
                  <p>{request.requested_payload[0]?.field}: {String(request.requested_payload[0]?.new_value ?? '')}</p>
                  <p>Reason: {request.reason}</p>
                  {request.notes ? <p>Notes: {request.notes}</p> : null}
                  {request.manager_remarks ? (
                    <p className="manager-remarks">Manager remarks: {request.manager_remarks}</p>
                  ) : null}
                </div>
                <div className="request-card-side">
                  <Pill tone={request.status === 'pending' ? 'warn' : request.status === 'approved' ? 'success' : 'danger'}>
                    {request.status}
                  </Pill>
                  {request.status === 'pending' ? (
                    <button className="text-button" onClick={() => handleCancel(request.id)}>Cancel</button>
                  ) : null}
                  {request.status === 'rejected' ? (
                    <button className="text-button" onClick={() => setMessage('Resubmission will create a new request from the attendance screen.')}>
                      Resubmit
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </article>
    </section>
  );
}
