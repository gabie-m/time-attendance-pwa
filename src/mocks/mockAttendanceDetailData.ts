import type { Role as UserRole } from '../domain/types';

export type DayStatus = 'Normal' | 'Flagged' | 'Needs Review' | 'Incomplete';
export type StaffType = 'stationary' | 'roving';
export type EventFlagType =
  | 'offline_submission'
  | 'outside_radius'
  | 'gps_low_accuracy'
  | 'location_conflict'
  | 'missing_punch';
export type FlagSeverity = 'warning' | 'high';
export type FlagStatus = 'open' | 'reviewed' | 'resolved';
export type ManualEditStatus = 'pending' | 'approved' | 'rejected';

export type AttendanceEventDetail = {
  id: string;
  eventType: 'Time In' | 'Lunch Out' | 'Lunch In' | 'Time Out' | 'Visit In' | 'Visit Out';
  timestamp: string;
  latitude: number;
  longitude: number;
  gpsAccuracyMeters: number;
  offline?: boolean;
  flag?: EventFlagType;
};

export type AttendanceFlagDetail = {
  id: string;
  flagType: EventFlagType;
  severity: FlagSeverity;
  status: FlagStatus;
};

export type ManualEditDetail = {
  id: string;
  requestType: 'missed_punch' | 'incorrect_time' | 'missed_visit' | 'sync_issue' | 'other';
  reason: string;
  status: ManualEditStatus;
  submittedAt: string;
};

export type AttendanceDayDetail = {
  workDate: string;
  status: DayStatus;
  location: string;
  shiftLabel: string;
  events: AttendanceEventDetail[];
  flags: AttendanceFlagDetail[];
  manualEdits: ManualEditDetail[];
};

export type EmployeeAttendanceDetail = {
  employeeId: string;
  employeeName: string;
  role: UserRole;
  staffType: StaffType;
  employeeCode: string;
  active: boolean;
  primaryLocation: string;
  managerName: string;
  days: AttendanceDayDetail[];
};

const stationaryNormalEvents: AttendanceEventDetail[] = [
  {
    id: 'evt-normal-1',
    eventType: 'Time In',
    timestamp: '2026-05-13T08:01:00.000+08:00',
    latitude: 14.5852,
    longitude: 121.0566,
    gpsAccuracyMeters: 18
  },
  {
    id: 'evt-normal-2',
    eventType: 'Lunch Out',
    timestamp: '2026-05-13T12:02:00.000+08:00',
    latitude: 14.5851,
    longitude: 121.0567,
    gpsAccuracyMeters: 20
  },
  {
    id: 'evt-normal-3',
    eventType: 'Lunch In',
    timestamp: '2026-05-13T13:01:00.000+08:00',
    latitude: 14.5852,
    longitude: 121.0565,
    gpsAccuracyMeters: 17
  },
  {
    id: 'evt-normal-4',
    eventType: 'Time Out',
    timestamp: '2026-05-13T17:08:00.000+08:00',
    latitude: 14.5852,
    longitude: 121.0566,
    gpsAccuracyMeters: 19
  }
];

const rovingNormalEvents: AttendanceEventDetail[] = [
  {
    id: 'evt-roving-1',
    eventType: 'Visit In',
    timestamp: '2026-05-13T09:10:00.000+08:00',
    latitude: 14.5915,
    longitude: 121.0599,
    gpsAccuracyMeters: 22
  },
  {
    id: 'evt-roving-2',
    eventType: 'Visit Out',
    timestamp: '2026-05-13T10:42:00.000+08:00',
    latitude: 14.5914,
    longitude: 121.0601,
    gpsAccuracyMeters: 24
  },
  {
    id: 'evt-roving-3',
    eventType: 'Visit In',
    timestamp: '2026-05-13T13:18:00.000+08:00',
    latitude: 14.5534,
    longitude: 121.0481,
    gpsAccuracyMeters: 28
  },
  {
    id: 'evt-roving-4',
    eventType: 'Visit Out',
    timestamp: '2026-05-13T15:05:00.000+08:00',
    latitude: 14.5536,
    longitude: 121.0479,
    gpsAccuracyMeters: 26
  }
];

export const mockAttendanceDetailData: EmployeeAttendanceDetail[] = [
  {
    employeeId: 'employee-jonas',
    employeeName: 'Jonas Reyes',
    role: 'user',
    staffType: 'roving',
    employeeCode: 'EMP-002',
    active: true,
    primaryLocation: 'Robinsons Galleria',
    managerName: 'Lea Cruz',
    days: [
      {
        workDate: '2026-05-13',
        status: 'Normal',
        location: 'Robinsons Galleria / BGC High Street',
        shiftLabel: 'Flexible visits',
        events: rovingNormalEvents,
        flags: [],
        manualEdits: []
      },
      {
        workDate: '2026-05-12',
        status: 'Flagged',
        location: 'Robinsons Galleria',
        shiftLabel: 'Flexible visits',
        events: [
          {
            id: 'jonas-flag-1',
            eventType: 'Visit In',
            timestamp: '2026-05-12T09:18:00.000+08:00',
            latitude: 14.5915,
            longitude: 121.0599,
            gpsAccuracyMeters: 41,
            offline: true,
            flag: 'offline_submission'
          },
          {
            id: 'jonas-flag-2',
            eventType: 'Visit Out',
            timestamp: '2026-05-12T11:02:00.000+08:00',
            latitude: 14.5914,
            longitude: 121.0598,
            gpsAccuracyMeters: 39,
            offline: true,
            flag: 'offline_submission'
          }
        ],
        flags: [
          {
            id: 'flag-jonas-offline',
            flagType: 'offline_submission',
            severity: 'warning',
            status: 'open'
          }
        ],
        manualEdits: []
      },
      {
        workDate: '2026-05-11',
        status: 'Needs Review',
        location: 'SM Aura Premier',
        shiftLabel: 'Flexible visits',
        events: [
          {
            id: 'jonas-review-1',
            eventType: 'Visit In',
            timestamp: '2026-05-11T13:04:00.000+08:00',
            latitude: 14.5468,
            longitude: 121.0543,
            gpsAccuracyMeters: 25
          }
        ],
        flags: [
          {
            id: 'flag-jonas-missing',
            flagType: 'missing_punch',
            severity: 'high',
            status: 'open'
          }
        ],
        manualEdits: [
          {
            id: 'edit-jonas-1',
            requestType: 'incorrect_time',
            reason: 'Visit out should be 02:30 PM based on client log.',
            status: 'pending',
            submittedAt: '2026-05-11T19:04:00.000+08:00'
          }
        ]
      },
      {
        workDate: '2026-05-10',
        status: 'Incomplete',
        location: 'SM Megamall',
        shiftLabel: 'Flexible visits',
        events: [
          {
            id: 'jonas-incomplete-1',
            eventType: 'Visit In',
            timestamp: '2026-05-10T10:11:00.000+08:00',
            latitude: 14.5852,
            longitude: 121.0566,
            gpsAccuracyMeters: 23
          }
        ],
        flags: [
          {
            id: 'flag-jonas-incomplete',
            flagType: 'missing_punch',
            severity: 'high',
            status: 'open'
          }
        ],
        manualEdits: []
      },
      makeSimpleDay('2026-05-09', 'Normal', rovingNormalEvents, 'Robinsons Galleria / BGC High Street', 'Flexible visits'),
      makeSimpleDay('2026-05-08', 'Normal', rovingNormalEvents, 'Robinsons Galleria / BGC High Street', 'Flexible visits'),
      makeSimpleDay('2026-05-07', 'Normal', rovingNormalEvents, 'Robinsons Galleria / BGC High Street', 'Flexible visits')
    ]
  },
  {
    employeeId: 'employee-lea',
    employeeName: 'Lea Cruz',
    role: 'manager',
    staffType: 'roving',
    employeeCode: 'MGR-001',
    active: true,
    primaryLocation: 'SM Megamall',
    managerName: 'Admin User',
    days: [
      makeSimpleDay('2026-05-13', 'Normal', rovingNormalEvents, 'SM Megamall / BGC High Street', 'Flexible visits'),
      {
        workDate: '2026-05-12',
        status: 'Flagged',
        location: 'SM Megamall',
        shiftLabel: 'Flexible visits',
        events: [
          {
            id: 'lea-flag-1',
            eventType: 'Visit In',
            timestamp: '2026-05-12T08:47:00.000+08:00',
            latitude: 14.5988,
            longitude: 121.0642,
            gpsAccuracyMeters: 32,
            flag: 'outside_radius'
          },
          {
            id: 'lea-flag-2',
            eventType: 'Visit Out',
            timestamp: '2026-05-12T10:12:00.000+08:00',
            latitude: 14.5987,
            longitude: 121.0641,
            gpsAccuracyMeters: 35,
            flag: 'outside_radius'
          }
        ],
        flags: [
          {
            id: 'flag-lea-gps',
            flagType: 'outside_radius',
            severity: 'high',
            status: 'open'
          }
        ],
        manualEdits: []
      },
      {
        workDate: '2026-05-11',
        status: 'Normal',
        location: 'BGC High Street',
        shiftLabel: 'Flexible visits',
        events: rovingNormalEvents,
        flags: [],
        manualEdits: [
          {
            id: 'edit-lea-1',
            requestType: 'missed_visit',
            reason: 'BGC store coaching visit was not captured.',
            status: 'approved',
            submittedAt: '2026-05-11T20:15:00.000+08:00'
          }
        ]
      },
      makeSimpleDay('2026-05-10', 'Incomplete', [rovingNormalEvents[0]], 'SM Megamall', 'Flexible visits'),
      makeSimpleDay('2026-05-09', 'Normal', rovingNormalEvents, 'SM Megamall / BGC High Street', 'Flexible visits'),
      makeSimpleDay('2026-05-08', 'Normal', rovingNormalEvents, 'SM Megamall / BGC High Street', 'Flexible visits'),
      makeSimpleDay('2026-05-07', 'Normal', rovingNormalEvents, 'SM Megamall / BGC High Street', 'Flexible visits')
    ]
  },
  {
    employeeId: 'employee-ana',
    employeeName: 'Ana Dela Cruz',
    role: 'user',
    staffType: 'stationary',
    employeeCode: 'EMP-014',
    active: true,
    primaryLocation: 'Ayala Malls Manila Bay',
    managerName: 'Lea Cruz',
    days: [
      makeSimpleDay('2026-05-13', 'Normal', stationaryNormalEvents, 'Ayala Malls Manila Bay', '09:00 AM - 06:00 PM'),
      {
        workDate: '2026-05-12',
        status: 'Flagged',
        location: 'Ayala Malls Manila Bay',
        shiftLabel: '09:00 AM - 06:00 PM',
        events: stationaryNormalEvents.map((event) => ({
          ...event,
          id: `ana-low-${event.id}`,
          gpsAccuracyMeters: event.eventType === 'Time In' ? 96 : event.gpsAccuracyMeters,
          flag: event.eventType === 'Time In' ? 'gps_low_accuracy' : undefined
        })),
        flags: [
          {
            id: 'flag-ana-low-gps',
            flagType: 'gps_low_accuracy',
            severity: 'warning',
            status: 'open'
          }
        ],
        manualEdits: []
      },
      {
        workDate: '2026-05-11',
        status: 'Needs Review',
        location: 'Ayala Malls Manila Bay',
        shiftLabel: '09:00 AM - 06:00 PM',
        events: stationaryNormalEvents.slice(0, 3),
        flags: [
          {
            id: 'flag-ana-missing',
            flagType: 'missing_punch',
            severity: 'high',
            status: 'open'
          }
        ],
        manualEdits: [
          {
            id: 'edit-ana-1',
            requestType: 'sync_issue',
            reason: 'Offline punches did not upload during mall outage.',
            status: 'rejected',
            submittedAt: '2026-05-11T21:42:00.000+08:00'
          }
        ]
      },
      makeSimpleDay('2026-05-10', 'Incomplete', stationaryNormalEvents.slice(0, 2), 'Ayala Malls Manila Bay', '09:00 AM - 06:00 PM'),
      makeSimpleDay('2026-05-09', 'Normal', stationaryNormalEvents, 'Ayala Malls Manila Bay', '09:00 AM - 06:00 PM'),
      makeSimpleDay('2026-05-08', 'Normal', stationaryNormalEvents, 'Ayala Malls Manila Bay', '09:00 AM - 06:00 PM'),
      makeSimpleDay('2026-05-07', 'Normal', stationaryNormalEvents, 'Ayala Malls Manila Bay', '09:00 AM - 06:00 PM')
    ]
  },
  {
    employeeId: 'employee-paolo',
    employeeName: 'Paolo Garcia',
    role: 'user',
    staffType: 'stationary',
    employeeCode: 'EMP-018',
    active: true,
    primaryLocation: 'SM Megamall',
    managerName: 'Lea Cruz',
    days: [
      makeSimpleDay('2026-05-13', 'Normal', stationaryNormalEvents, 'SM Megamall', '08:00 AM - 05:00 PM'),
      makeSimpleDay('2026-05-12', 'Normal', stationaryNormalEvents, 'SM Megamall', '08:00 AM - 05:00 PM'),
      {
        workDate: '2026-05-11',
        status: 'Flagged',
        location: 'Robinsons Galleria',
        shiftLabel: '08:00 AM - 05:00 PM',
        events: stationaryNormalEvents.map((event) => ({
          ...event,
          id: `paolo-conflict-${event.id}`,
          flag: event.eventType === 'Time In' ? 'location_conflict' : undefined
        })),
        flags: [
          {
            id: 'flag-paolo-location',
            flagType: 'location_conflict',
            severity: 'high',
            status: 'reviewed'
          }
        ],
        manualEdits: []
      },
      {
        workDate: '2026-05-10',
        status: 'Needs Review',
        location: 'SM Megamall',
        shiftLabel: '08:00 AM - 05:00 PM',
        events: stationaryNormalEvents.slice(0, 1),
        flags: [
          {
            id: 'flag-paolo-missing',
            flagType: 'missing_punch',
            severity: 'high',
            status: 'open'
          }
        ],
        manualEdits: [
          {
            id: 'edit-paolo-1',
            requestType: 'missed_punch',
            reason: 'Forgot to tap Time Out after inventory count.',
            status: 'pending',
            submittedAt: '2026-05-10T18:22:00.000+08:00'
          }
        ]
      },
      makeSimpleDay('2026-05-09', 'Incomplete', stationaryNormalEvents.slice(0, 3), 'SM Megamall', '08:00 AM - 05:00 PM'),
      makeSimpleDay('2026-05-08', 'Normal', stationaryNormalEvents, 'SM Megamall', '08:00 AM - 05:00 PM'),
      makeSimpleDay('2026-05-07', 'Normal', stationaryNormalEvents, 'SM Megamall', '08:00 AM - 05:00 PM')
    ]
  },
  {
    employeeId: 'employee-carlo',
    employeeName: 'Carlo Mendoza',
    role: 'user',
    staffType: 'stationary',
    employeeCode: 'EMP-099',
    active: false,
    primaryLocation: 'Main Warehouse',
    managerName: 'Lea Cruz',
    days: [
      makeSimpleDay('2026-04-15', 'Normal', stationaryNormalEvents, 'Main Warehouse', '08:00 AM - 05:00 PM'),
      {
        workDate: '2026-04-14',
        status: 'Flagged',
        location: 'Main Warehouse',
        shiftLabel: '08:00 AM - 05:00 PM',
        events: stationaryNormalEvents.map((event) => ({
          ...event,
          id: `carlo-offline-${event.id}`,
          timestamp: event.timestamp.replace('2026-05-13', '2026-04-14'),
          offline: event.eventType === 'Time Out',
          flag: event.eventType === 'Time Out' ? 'offline_submission' : undefined
        })),
        flags: [
          {
            id: 'flag-carlo-offline',
            flagType: 'offline_submission',
            severity: 'warning',
            status: 'reviewed'
          }
        ],
        manualEdits: []
      },
      {
        workDate: '2026-04-13',
        status: 'Needs Review',
        location: 'Main Warehouse',
        shiftLabel: '08:00 AM - 05:00 PM',
        events: stationaryNormalEvents.slice(0, 2).map((event) => ({
          ...event,
          id: `carlo-missing-${event.id}`,
          timestamp: event.timestamp.replace('2026-05-13', '2026-04-13')
        })),
        flags: [
          {
            id: 'flag-carlo-missing',
            flagType: 'missing_punch',
            severity: 'high',
            status: 'resolved'
          }
        ],
        manualEdits: [
          {
            id: 'edit-carlo-1',
            requestType: 'missed_punch',
            reason: 'Requested correction for missed Time Out before deactivation.',
            status: 'approved',
            submittedAt: '2026-04-13T18:31:00.000+08:00'
          }
        ]
      },
      makeSimpleDay('2026-04-12', 'Incomplete', stationaryNormalEvents.slice(0, 3), 'Main Warehouse', '08:00 AM - 05:00 PM'),
      makeSimpleDay('2026-04-11', 'Normal', stationaryNormalEvents, 'Main Warehouse', '08:00 AM - 05:00 PM'),
      makeSimpleDay('2026-04-10', 'Normal', stationaryNormalEvents, 'Main Warehouse', '08:00 AM - 05:00 PM'),
      makeSimpleDay('2026-04-09', 'Normal', stationaryNormalEvents, 'Main Warehouse', '08:00 AM - 05:00 PM')
    ]
  }
];

function makeSimpleDay(
  workDate: string,
  status: DayStatus,
  events: AttendanceEventDetail[],
  location: string,
  shiftLabel: string
): AttendanceDayDetail {
  return {
    workDate,
    status,
    location,
    shiftLabel,
    events: events.map((event, index) => ({
      ...event,
      id: `${workDate}-${event.id}-${index}`,
      timestamp: event.timestamp.replace('2026-05-13', workDate)
    })),
    flags:
      status === 'Incomplete'
        ? [
            {
              id: `flag-${workDate}-missing`,
              flagType: 'missing_punch',
              severity: 'high',
              status: 'open'
            }
          ]
        : [],
    manualEdits: []
  };
}
