import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pill } from '../components/Pill';
import {
  mockAttendanceDetailData,
  type AttendanceEventDetail,
  type AttendanceDayDetail,
  type DayStatus,
  type EventFlagType,
  type FlagSeverity,
  type FlagStatus,
  type ManualEditStatus
} from '../mocks/mockAttendanceDetailData';

export function AttendanceDetailScreen() {
  const { employeeId } = useParams();
  const employee = mockAttendanceDetailData.find((item) => item.employeeId === employeeId) ?? mockAttendanceDetailData[0];
  const defaultDay = useMemo(() => {
    return employee.days.find((day) => day.status === 'Flagged') ?? employee.days[0];
  }, [employee]);
  const [selectedDate, setSelectedDate] = useState(defaultDay.workDate);
  const selectedDay = employee.days.find((day) => day.workDate === selectedDate) ?? defaultDay;

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <span className="eyebrow">Attendance Detail</span>
          <h1>{employee.employeeName}</h1>
          <p>Static admin review view for recent attendance days, flags, and manual edit history.</p>
        </div>
        <Link className="text-button" to="/admin/reports?tab=flagged-records">Back to flagged records</Link>
      </header>

      <section className="panel employee-detail-header">
        <div>
          <span className="eyebrow">Employee</span>
          <h2>{employee.employeeName}</h2>
          <p>{formatRole(employee.role)} · {employee.staffType} · {employee.employeeCode}</p>
        </div>
        <Pill tone={employee.active ? 'success' : 'danger'}>{employee.active ? 'Active' : 'Deactivated'}</Pill>
        <div>
          <span>Primary location</span>
          <strong>{employee.primaryLocation}</strong>
        </div>
        <div>
          <span>Manager</span>
          <strong>{employee.managerName}</strong>
        </div>
      </section>

      <section className="attendance-detail-layout">
        <article className="panel">
          <div className="panel-title">
            <h2>Recent Days</h2>
            <Pill tone="neutral">Last 7 work days</Pill>
          </div>
          <div className="recent-day-list">
            {employee.days.map((day) => (
              <button
                className={day.workDate === selectedDay.workDate ? 'active' : ''}
                key={day.workDate}
                onClick={() => setSelectedDate(day.workDate)}
                type="button"
              >
                <span>
                  <strong>{day.workDate}</strong>
                  <small>{day.location}</small>
                </span>
                <Pill tone={getDayStatusTone(day.status)}>{day.status}</Pill>
              </button>
            ))}
          </div>
        </article>

        <DayDetailPanel day={selectedDay} />
      </section>
    </section>
  );
}

function DayDetailPanel({ day }: { day: AttendanceDayDetail }) {
  return (
    <article className="panel day-detail-panel">
      <div className="panel-title">
        <div>
          <h2>{day.workDate}</h2>
          <p>{day.location} · {day.shiftLabel}</p>
        </div>
        <Pill tone={getDayStatusTone(day.status)}>{day.status}</Pill>
      </div>

      <section className="detail-section">
        <div className="panel-title">
          <h3>Punch Records</h3>
          <Pill tone="neutral">{day.events.length} events</Pill>
        </div>
        <PunchRecordTable events={day.events} />
      </section>

      <section className="detail-section">
        <div className="panel-title">
          <h3>Flags</h3>
          <Pill tone={day.flags.length > 0 ? 'warn' : 'success'}>{day.flags.length}</Pill>
        </div>
        {day.flags.length === 0 ? (
          <div className="empty-state">
            <strong>No flags</strong>
            <p>This day has no attendance flags.</p>
          </div>
        ) : (
          <div className="approval-list">
            {day.flags.map((flag) => (
              <div className="approval-card" key={flag.id}>
                <div className="approval-card-header">
                  <div>
                    <span className="eyebrow">Flag type</span>
                    <strong>{formatFlagType(flag.flagType)}</strong>
                  </div>
                  <div className="approval-card-status">
                    <Pill tone={getSeverityTone(flag.severity)}>{flag.severity}</Pill>
                    <Pill tone={getFlagStatusTone(flag.status)}>{flag.status}</Pill>
                  </div>
                </div>
                <div className="inline-actions">
                  <button disabled title="Flag review actions coming soon">Mark Reviewed</button>
                  <button className="secondary" disabled title="Flag review actions coming soon">Add Remarks</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="detail-section">
        <div className="panel-title">
          <h3>Manual Edit History</h3>
          <Pill tone="neutral">{day.manualEdits.length}</Pill>
        </div>
        {day.manualEdits.length === 0 ? (
          <div className="empty-state">
            <strong>No correction requests</strong>
            <p>No manual edit requests exist for this work day.</p>
          </div>
        ) : (
          <div className="approval-list">
            {day.manualEdits.map((edit) => (
              <div className="approval-card" key={edit.id}>
                <div className="approval-card-header">
                  <div>
                    <span className="eyebrow">{edit.requestType}</span>
                    <strong>{edit.reason}</strong>
                    <p>Submitted {edit.submittedAt}</p>
                  </div>
                  <Pill tone={getManualEditTone(edit.status)}>{edit.status}</Pill>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </article>
  );
}

function PunchRecordTable({ events }: { events: AttendanceEventDetail[] }) {
  const eventRows = getEventRows(events);

  return (
    <div className="report-table-wrap">
      <table className="report-table punch-record-table">
        <thead>
          <tr>
            <th>Event</th>
            <th>Timestamp</th>
            <th>GPS coordinates</th>
            <th>GPS accuracy</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {eventRows.map((event) => (
            <tr key={event.id}>
              <td>{event.label}</td>
              <td>{event.timestamp}</td>
              <td>
                {event.latitude.toFixed(4)}, {event.longitude.toFixed(4)}
              </td>
              <td>{event.gpsAccuracyMeters}m</td>
              <td>
                <div className="event-badges">
                  {event.offline ? <Pill tone="sync">Offline</Pill> : null}
                  {event.flag ? <Pill tone="flag">{formatFlagType(event.flag)}</Pill> : null}
                  {!event.offline && !event.flag ? <Pill tone="success">Normal</Pill> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getEventRows(events: AttendanceEventDetail[]) {
  const eventTypeCounts = new Map<string, number>();
  const totalByType = events.reduce((counts, event) => {
    counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  return events.map((event) => {
    const nextCount = (eventTypeCounts.get(event.eventType) ?? 0) + 1;
    eventTypeCounts.set(event.eventType, nextCount);
    const shouldNumber = (totalByType.get(event.eventType) ?? 0) > 1;

    return {
      ...event,
      label: shouldNumber ? `${event.eventType} ${nextCount}` : event.eventType
    };
  });
}

function getDayStatusTone(status: DayStatus) {
  if (status === 'Normal') {
    return 'success';
  }

  if (status === 'Flagged') {
    return 'flag';
  }

  if (status === 'Needs Review') {
    return 'warn';
  }

  return 'danger';
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

function getManualEditTone(status: ManualEditStatus) {
  if (status === 'approved') {
    return 'success';
  }

  if (status === 'rejected') {
    return 'danger';
  }

  return 'warn';
}

function formatRole(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatFlagType(flagType: EventFlagType) {
  return flagType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
