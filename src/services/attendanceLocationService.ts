import type { Location } from '../domain/types';
import { supabase } from '../lib/supabaseClient';
import { listLocations } from './mockLocationService';
import { listUserLocationAssignments } from './mockStaffService';
import type { ServiceResult } from './serviceResult';
import { failure, success } from './serviceResult';

type LocationRow = {
  id: string;
  name: string;
  address: string;
  latitude: number | string;
  longitude: number | string;
  allowed_radius_meters: number;
  active: boolean;
};

export async function getAttendanceLocations(userId: string): Promise<ServiceResult<Location[]>> {
  if (isMockAuthMode()) {
    return success(getMockAttendanceLocations(userId));
  }

  if (!supabase) {
    return failure('Attendance locations are unavailable.');
  }

  const { data, error } = await supabase
    .from('locations')
    .select('id,name,address,latitude,longitude,allowed_radius_meters,active')
    .eq('active', true)
    .order('name');

  if (error) {
    return failure('Attendance locations are unavailable.');
  }

  const locations = (data ?? []).map(mapLocation);
  if (locations.some((location) => !location)) {
    return failure('Attendance locations are unavailable.');
  }

  return success(locations as Location[]);
}

function getMockAttendanceLocations(userId: string) {
  const today = getManilaDateString();
  const permittedLocationIds = new Set(
    listUserLocationAssignments()
      .filter((assignment) => {
        return (
          assignment.user_id === userId &&
          assignment.effective_from <= today &&
          (assignment.effective_to === null || assignment.effective_to >= today)
        );
      })
      .map((assignment) => assignment.location_id)
  );

  return listLocations().filter(
    (location) => location.active && permittedLocationIds.has(location.id)
  );
}

function mapLocation(row: LocationRow): Location | null {
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    address: row.address,
    latitude,
    longitude,
    radiusMeters: row.allowed_radius_meters,
    active: row.active
  };
}

function isMockAuthMode() {
  return import.meta.env.VITE_USE_MOCK_AUTH === 'true';
}

function getManilaDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila'
  }).format(new Date());
}
