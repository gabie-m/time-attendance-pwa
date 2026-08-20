import type { AttendanceEvent } from '../domain/types';

export function mergeStationaryEvents(storedEvents: AttendanceEvent[], recoveredEvents: AttendanceEvent[]) {
  const eventsByIdentity = new Map<string, AttendanceEvent>();
  for (const event of [...storedEvents, ...recoveredEvents]) {
    const identity = getEventIdentity(event);
    const existing = eventsByIdentity.get(identity);
    eventsByIdentity.set(identity, getPreferredEvent(existing, event));
  }

  return getCurrentStationarySessionEvents([...eventsByIdentity.values()])
    .sort((left, right) => left.capturedAtLocal.localeCompare(right.capturedAtLocal));
}

function getPreferredEvent(existing: AttendanceEvent | undefined, candidate: AttendanceEvent) {
  if (!existing || candidate.serverStatus === 'synced') {
    return candidate;
  }

  return existing;
}

function getEventIdentity(event: AttendanceEvent) {
  return `${event.sessionId}:${event.type}:${event.capturedAtLocal}`;
}

function getCurrentStationarySessionEvents(events: AttendanceEvent[]) {
  const today = getWorkDate(new Date().toISOString());
  const eventsBySession = new Map<string, AttendanceEvent[]>();
  for (const event of events) {
    eventsBySession.set(event.sessionId, [...(eventsBySession.get(event.sessionId) ?? []), event]);
  }
  const eligibleSessions = [...eventsBySession.values()].flatMap((sessionEvents) => {
    const timeIn = sessionEvents.find((event) => event.type === 'time_in');
    const workDate = timeIn?.workDate ?? (timeIn ? getWorkDate(timeIn.capturedAtLocal) : undefined);
    const isOpen = !sessionEvents.some((event) => event.type === 'time_out' && event.serverStatus !== 'failed');
    return workDate === today || isOpen ? [{ sessionEvents, workDate, isOpen }] : [];
  });
  const selected = eligibleSessions
    .sort((left, right) => {
      const leftPriority = left.isOpen ? 1 : left.workDate === today ? 0 : -1;
      const rightPriority = right.isOpen ? 1 : right.workDate === today ? 0 : -1;
      if (leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }
      return left.sessionEvents[0].capturedAtLocal.localeCompare(right.sessionEvents[0].capturedAtLocal);
    })
    .at(0);
  return selected?.sessionEvents ?? [];
}

function getWorkDate(timestamp: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(timestamp));
}
