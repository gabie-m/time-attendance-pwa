import { useMemo, useState } from 'react';
import { Pill } from '../components/Pill';
import { useAttendanceHistory } from '../hooks/useAttendanceHistory';
import type {
  AttendanceHistoryDay,
  AttendanceHistoryEvent,
  AttendanceHistoryFlag,
  AttendanceHistoryOutcome
} from '../services/attendanceHistoryService';

const historyDays = 30;

export function MyAttendanceHistoryScreen() {
  const { data: history, isLoading, isError, refetch } = useAttendanceHistory({ days: historyDays });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selectedDay = useMemo(() => {
    if (!history?.days.length || !selectedDate) {
      return null;
    }

    return history.days.find((day) => day.workDate === selectedDate) ?? null;
  }, [history, selectedDate]);

  if (isLoading) {
    return <div className="loading-screen">Loading attendance history...</div>;
  }

  if (isError || !history) {
    return (
      <section className="screen">
        <article className="status-panel" role="alert">
          <div>
            <span className="eyebrow">Attendance history</span>
            <strong>History is unavailable</strong>
            <p>We could not load your attendance records. Try again when you have a connection.</p>
          </div>
          <button className="text-button" onClick={() => void refetch()} type="button">Retry</button>
        </article>
      </section>
    );
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <span className="eyebrow">My Attendance</span>
          <h1>Attendance history</h1>
          <p>Showing the last {history.range.days} days.</p>
        </div>
      </header>

      {history.days.length === 0 ? (
        <article className="panel empty-state">
          <strong>No attendance records</strong>
          <p>Your recorded attendance will appear here.</p>
        </article>
      ) : (
        <section className="attendance-detail-layout">
          <article className="panel">
            <div className="panel-title">
              <h2>Recent days</h2>
              <Pill tone="neutral">Last {history.range.days} days</Pill>
            </div>
            <div className="recent-day-list">
              {history.days.map((day) => (
                <button
                  className={day.workDate === selectedDay?.workDate ? 'active' : ''}
                  key={day.workDate}
                  onClick={() => setSelectedDate((current) => current === day.workDate ? null : day.workDate)}
                  type="button"
                >
                  <span>
                    <strong>{formatWorkDate(day.workDate)}</strong>
                    <small>{day.sessions.length} session{day.sessions.length === 1 ? '' : 's'}</small>
                  </span>
                  <Pill tone={getHistoryOutcomeTone(day.outcome)}>{formatHistoryOutcome(day.outcome)}</Pill>
                </button>
              ))}
            </div>
          </article>

          {selectedDay ? <AttendanceHistoryDayDetail day={selectedDay} /> : null}
        </section>
      )}
    </section>
  );
}

function AttendanceHistoryDayDetail({ day }: { day: AttendanceHistoryDay }) {
  const events = day.sessions.flatMap((session) => session.events);
  const flags = day.sessions.flatMap((session) => session.flags);
  const flagGroups = groupFlagsByType(flags, events);

  return (
    <article className="panel day-detail-panel">
      <div className="panel-title">
        <div>
          <h2>{formatWorkDate(day.workDate)}</h2>
          <p>{day.sessions.length} recorded session{day.sessions.length === 1 ? '' : 's'}</p>
        </div>
        <Pill tone={getHistoryOutcomeTone(day.outcome)}>{formatHistoryOutcome(day.outcome)}</Pill>
      </div>

      <section className="detail-section">
        <div className="panel-title">
          <h3>Attendance records</h3>
          <Pill tone="neutral">{events.length} events</Pill>
        </div>
        <div className="approval-list">
          {groupEventsByCaptureMethod(events).map((group) => (
            <AttendanceEventGroup group={group} key={group.key} />
          ))}
        </div>
      </section>

      <section className="detail-section">
        <div className="panel-title">
          <h3>Review status</h3>
          <Pill tone={flagGroups.length > 0 ? 'warn' : 'success'}>{flagGroups.length}</Pill>
        </div>
        {flags.length === 0 ? (
          <div className="empty-state">
            <strong>No review needed</strong>
            <p>This attendance has no flagged conditions.</p>
          </div>
        ) : (
          <div className="approval-list">
            {flagGroups.map((group) => <EmployeeFlagGroup group={group} key={group.type} />)}
          </div>
        )}
      </section>
    </article>
  );
}

type AttendanceEventGroup = {
  key: 'connected' | 'offline';
  events: AttendanceHistoryEvent[];
};

function AttendanceEventGroup({ group }: { group: AttendanceEventGroup }) {
  return (
    <div className="approval-card">
      <div className="approval-card-header">
        <div>
          <p className="eyebrow">Attendance records</p>
          <strong>{group.key === 'offline' ? 'Captured offline' : 'Captured with connection'}</strong>
          <p>{group.events.length} time record{group.events.length === 1 ? '' : 's'} recorded.</p>
        </div>
        <Pill tone="neutral">Recorded</Pill>
      </div>
      <ul className="rule-list">
        {group.events.map((event) => (
          <li key={event.id}>{formatEventType(event.type)} at {formatTimestamp(event.capturedAtLocal)}</li>
        ))}
      </ul>
    </div>
  );
}

function groupEventsByCaptureMethod(events: AttendanceHistoryEvent[]): AttendanceEventGroup[] {
  const groups = new Map<AttendanceEventGroup['key'], AttendanceHistoryEvent[]>();
  for (const event of events) {
    const key = event.offlineDeclared ? 'offline' : 'connected';
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  return (['connected', 'offline'] as const)
    .flatMap((key) => {
      const groupedEvents = groups.get(key);
      return groupedEvents?.length ? [{ key, events: groupedEvents }] : [];
    });
}

type EmployeeFlagGroup = {
  type: AttendanceHistoryFlag['type'];
  outcome: AttendanceHistoryFlag['outcome'];
  reviewedAt: string | null;
  events: AttendanceHistoryEvent[];
};

function EmployeeFlagGroup({ group }: { group: EmployeeFlagGroup }) {
  return (
    <div className="approval-card">
      <div className="approval-card-header">
        <div>
          <p className="eyebrow">Attendance check</p>
          <strong>{formatFlagType(group.type)}</strong>
          <p>{getFlagOutcomeCopy(group.outcome, group.reviewedAt)}</p>
        </div>
        <Pill tone={getFlagOutcomeTone(group.outcome)}>{formatFlagOutcome(group.outcome)}</Pill>
      </div>
      {group.events.length > 0 ? (
        <ul className="rule-list">
          {group.events.map((event) => (
            <li key={event.id}>{formatEventType(event.type)} at {formatTimestamp(event.capturedAtLocal)}</li>
          ))}
        </ul>
      ) : <p>This check applies to this attendance day.</p>}
    </div>
  );
}

function groupFlagsByType(
  flags: AttendanceHistoryFlag[],
  events: AttendanceHistoryEvent[]
): EmployeeFlagGroup[] {
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const groups = new Map<AttendanceHistoryFlag['type'], AttendanceHistoryFlag[]>();
  for (const flag of flags) {
    groups.set(flag.type, [...(groups.get(flag.type) ?? []), flag]);
  }

  return Array.from(groups, ([type, groupFlags]) => {
    const groupEvents = groupFlags.flatMap((flag) => {
      const event = flag.attendanceEventId ? eventsById.get(flag.attendanceEventId) : undefined;
      return event ? [event] : [];
    });
    const uniqueEvents = Array.from(new Map(groupEvents.map((event) => [event.id, event])).values());
    const finalFlag = getHighestPriorityFlag(groupFlags);
    return {
      type,
      outcome: finalFlag.outcome,
      reviewedAt: finalFlag.reviewedAt,
      events: uniqueEvents
    };
  });
}

function getHighestPriorityFlag(flags: AttendanceHistoryFlag[]) {
  const priority: Record<AttendanceHistoryFlag['outcome'], number> = {
    needs_review: 4,
    rejected: 3,
    resolved: 2,
    valid_for_reporting: 1
  };
  return flags.reduce((current, flag) => priority[flag.outcome] > priority[current.outcome] ? flag : current);
}

function formatWorkDate(workDate: string) {
  return new Intl.DateTimeFormat('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila'
  }).format(new Date(`${workDate}T00:00:00.000+08:00`));
}

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Manila'
  }).format(new Date(timestamp));
}

function formatEventType(eventType: AttendanceHistoryEvent['type']) {
  return eventType.replaceAll('_', ' ');
}

function formatFlagType(flagType: AttendanceHistoryFlag['type']) {
  return flagType.replaceAll('_', ' ');
}

function formatFlagOutcome(outcome: AttendanceHistoryFlag['outcome']) {
  if (outcome === 'valid_for_reporting') return 'Valid for reporting';
  if (outcome === 'rejected') return 'Rejected';
  if (outcome === 'resolved') return 'Resolved';
  return 'Needs review';
}

function getFlagOutcomeCopy(outcome: AttendanceHistoryFlag['outcome'], reviewedAt: string | null) {
  if (outcome === 'valid_for_reporting') {
    return reviewedAt ? `Reviewed ${formatTimestamp(reviewedAt)}.` : 'This attendance is valid for reporting.';
  }

  if (outcome === 'rejected') {
    return reviewedAt ? `Review completed ${formatTimestamp(reviewedAt)}.` : 'This attendance was not accepted for reporting.';
  }

  if (outcome === 'resolved') {
    return reviewedAt ? `Resolved ${formatTimestamp(reviewedAt)}.` : 'This attendance condition has been resolved.';
  }

  return 'This attendance condition is awaiting manager or admin review.';
}

function getFlagOutcomeTone(outcome: AttendanceHistoryFlag['outcome']) {
  if (outcome === 'valid_for_reporting') return 'success';
  if (outcome === 'rejected') return 'danger';
  if (outcome === 'resolved') return 'neutral';
  return 'warn';
}

function formatHistoryOutcome(outcome: AttendanceHistoryOutcome) {
  if (outcome === 'valid_for_reporting') return 'Valid for reporting';
  if (outcome === 'needs_review') return 'Needs review';
  if (outcome === 'rejected') return 'Rejected';
  if (outcome === 'resolved') return 'Resolved';
  return 'Recorded';
}

function getHistoryOutcomeTone(outcome: AttendanceHistoryOutcome) {
  if (outcome === 'valid_for_reporting' || outcome === 'recorded') return 'success';
  if (outcome === 'rejected') return 'danger';
  if (outcome === 'resolved') return 'neutral';
  return 'warn';
}
