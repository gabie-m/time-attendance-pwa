import { useMemo, useState } from 'react';
import type { MockUser } from '../auth/types';
import { Pill } from './Pill';
import {
  cancelManualEditRequest,
  getManualEditValidationError,
  getSessionById,
  listRequestableDates,
  listSessionsForUserOnDate,
  requestTypeLabels,
  submitManualEditRequest,
  useManualEditRequests,
  type ManualEditFormInput,
  type RequestType
} from '../services/mockManualEditService';

const requestTypes = Object.entries(requestTypeLabels) as Array<[RequestType, string]>;

type ManualEditRequestPanelProps = {
  user: MockUser;
};

export function ManualEditRequestPanel({ user }: ManualEditRequestPanelProps) {
  const allRequests = useManualEditRequests();
  const requests = useMemo(() => {
    return allRequests.filter((request) => request.user_id === user.id);
  }, [allRequests, user.id]);
  const requestableDates = listRequestableDates(user.id);
  const [isOpen, setIsOpen] = useState(false);
  const [requestDate, setRequestDate] = useState(requestableDates[0] ?? '');
  const sessionsForDate = listSessionsForUserOnDate(user.id, requestDate);
  const [sessionId, setSessionId] = useState(sessionsForDate[0]?.id ?? '');
  const [requestType, setRequestType] = useState<RequestType | ''>('');
  const [field, setField] = useState('');
  const [newValue, setNewValue] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const pendingCount = requests.filter((request) => request.status === 'pending').length;

  function handleDateChange(nextDate: string) {
    setRequestDate(nextDate);
    const nextSessions = listSessionsForUserOnDate(user.id, nextDate);
    setSessionId(nextSessions[0]?.id ?? '');
  }

  function buildInput(): ManualEditFormInput {
    return {
      user_id: user.id,
      attendance_session_id: sessionId,
      request_type: requestType as RequestType,
      requested_payload: [
        {
          field,
          old_value: null,
          new_value: newValue
        }
      ],
      reason,
      notes
    };
  }

  function handleSubmit() {
    const input = buildInput();
    const validationError = getManualEditValidationError(input);
    if (validationError) {
      setFormMessage(validationError);
      return;
    }

    const result = submitManualEditRequest(input);
    if (!result.ok) {
      setFormMessage(result.error);
      return;
    }

    setRequestType('');
    setField('');
    setNewValue('');
    setReason('');
    setNotes('');
    setFormMessage('Correction request submitted.');
    setIsOpen(false);
  }

  function handleCancelRequest(requestId: string) {
    const result = cancelManualEditRequest(requestId, user.id);
    if (!result.ok) {
      setFormMessage(result.error);
    }
  }

  return (
    <article className="panel">
      <div className="panel-title">
        <div>
          <h2>Need a correction?</h2>
          <p>Submit a request. Original attendance records remain unchanged.</p>
        </div>
        <Pill tone={pendingCount > 0 ? 'warn' : 'neutral'}>{pendingCount} pending</Pill>
      </div>

      {isOpen ? (
        <div className="manual-edit-form">
          <label>
            Date
            <select value={requestDate} onChange={(event) => handleDateChange(event.target.value)}>
              {requestableDates.map((date) => (
                <option value={date} key={date}>{date}</option>
              ))}
            </select>
          </label>

          <label>
            Session
            <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
              {sessionsForDate.map((session) => (
                <option value={session.id} key={session.id}>
                  {session.label}
                </option>
              ))}
            </select>
          </label>

          {sessionId && getSessionById(sessionId)?.status !== 'closed' ? (
            <p className="form-warning">You can submit a correction after today's attendance is complete.</p>
          ) : null}

          <label>
            Request type
            <select value={requestType} onChange={(event) => setRequestType(event.target.value as RequestType)}>
              <option value="">Select type</option>
              {requestTypes.map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>

          <label>
            What needs to be corrected?
            <input value={field} onChange={(event) => setField(event.target.value)} placeholder="e.g., Time Out" />
          </label>

          <label>
            What should it be changed to?
            <input value={newValue} onChange={(event) => setNewValue(event.target.value)} placeholder="e.g., 5:15 PM" />
          </label>

          <label>
            Reason
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this correction is needed." />
          </label>

          <label>
            Additional notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional notes" />
          </label>

          <button className="attachment-placeholder" disabled>Attach file (coming soon)</button>

          {formMessage ? <p className="form-message">{formMessage}</p> : null}

          <div className="inline-actions">
            <button onClick={handleSubmit}>Submit request</button>
            <button className="secondary" onClick={() => setIsOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="action-button full" onClick={() => setIsOpen(true)}>Request Manual Edit</button>
      )}

      <div className="request-list">
        {requests.length === 0 ? (
          <div className="empty-state">
            <strong>No correction requests yet</strong>
            <p>Submitted requests will appear here with manager remarks after review.</p>
          </div>
        ) : null}
        {requests.map((request) => (
          <div className="request-card" key={request.id}>
            <div>
              <strong>{requestTypeLabels[request.request_type]}</strong>
              <p>{getSessionById(request.attendance_session_id)?.label ?? request.attendance_session_id}</p>
              <p>{request.requested_payload[0]?.field}: {String(request.requested_payload[0]?.new_value ?? '')}</p>
              <p>{request.reason}</p>
              {request.manager_remarks ? <p>Manager remarks: {request.manager_remarks}</p> : null}
            </div>
            <div className="request-card-side">
              <Pill tone={request.status === 'pending' ? 'warn' : request.status === 'approved' ? 'success' : 'danger'}>
                {request.status}
              </Pill>
              {request.status === 'pending' ? (
                <button className="text-button" onClick={() => handleCancelRequest(request.id)}>Cancel</button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
