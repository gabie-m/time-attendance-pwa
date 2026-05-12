import type { ApprovalItem, AttendanceEvent, Location, Visit } from '../domain/types';

export const locations: Location[] = [
  {
    id: 'loc-megamall',
    name: 'SM Megamall',
    address: 'Mandaluyong City',
    latitude: 14.5852,
    longitude: 121.0566,
    radiusMeters: 250,
    active: true
  },
  {
    id: 'loc-galleria',
    name: 'Robinsons Galleria',
    address: 'Ortigas Center',
    latitude: 14.5915,
    longitude: 121.0599,
    radiusMeters: 150,
    active: true
  },
  {
    id: 'loc-warehouse',
    name: 'Main Warehouse',
    address: 'Pasig City',
    latitude: 14.5764,
    longitude: 121.0851,
    radiusMeters: 400,
    active: true
  }
];

export const attendanceEvents: AttendanceEvent[] = [
  {
    id: 'evt-1',
    type: 'time_in',
    label: 'Time In',
    localTime: '08:00',
    serverStatus: 'synced',
    locationName: 'SM Megamall',
    validationStatus: 'normal',
    detail: 'On-site, GPS accuracy 18m'
  },
  {
    id: 'evt-2',
    type: 'lunch_out',
    label: 'Lunch Out',
    localTime: '12:01',
    serverStatus: 'synced',
    locationName: 'SM Megamall',
    validationStatus: 'normal',
    detail: 'Break started'
  },
  {
    id: 'evt-3',
    type: 'lunch_in',
    label: 'Lunch In',
    localTime: '12:58',
    serverStatus: 'pending',
    locationName: 'SM Megamall',
    validationStatus: 'warning',
    detail: 'Captured offline, waiting to sync'
  }
];

export const visits: Visit[] = [
  {
    id: 'visit-1',
    status: 'done',
    locationName: 'Robinsons Galleria',
    purpose: 'Inventory check',
    timeIn: '08:12',
    timeOut: '09:48',
    duration: '1h 36m',
    travelFromPrevious: 'First visit',
    validationStatus: 'normal'
  },
  {
    id: 'visit-2',
    status: 'done',
    locationName: 'SM North EDSA',
    purpose: 'Promo audit',
    timeIn: '10:20',
    timeOut: '11:55',
    duration: '1h 35m',
    travelFromPrevious: '32m travel gap',
    validationStatus: 'normal'
  },
  {
    id: 'visit-3',
    status: 'active',
    locationName: 'SM Megamall',
    purpose: 'Staff coaching',
    timeIn: '12:40',
    duration: 'In progress',
    travelFromPrevious: '45m travel gap',
    validationStatus: 'warning'
  },
  {
    id: 'visit-4',
    status: 'planned',
    locationName: 'Greenbelt 5',
    purpose: 'Stock replenishment',
    duration: 'Planned 15:00',
    travelFromPrevious: '4.8 km',
    validationStatus: 'normal'
  }
];

export const approvals: ApprovalItem[] = [
  {
    id: 'apr-1',
    staffName: 'Jonas Reyes',
    requestType: 'Missed Time Out',
    reason: 'Battery died during field visit.',
    status: 'pending'
  },
  {
    id: 'apr-2',
    staffName: 'Lea Cruz',
    requestType: 'Location Conflict',
    reason: 'Worked at alternate approved branch.',
    status: 'pending'
  }
];

export const managerRows = [
  ['Ana Dela Cruz', 'Timed in', 'SM Megamall', 'Normal'],
  ['Jonas Reyes', 'Field visit', 'SM North EDSA', 'Flagged'],
  ['Lea Cruz', 'Late', 'Robinsons Galleria', 'Needs review'],
  ['Marco Lim', 'Timed out', 'Main Warehouse', 'Normal']
];
