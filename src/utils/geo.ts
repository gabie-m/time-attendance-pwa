import type { Location } from '../domain/types';

export type GeoCheckResult =
  | {
      status: 'normal' | 'outside_radius';
      latitude: number;
      longitude: number;
      accuracyMeters: number;
      distanceMeters: number;
      location: Location;
      message: string;
    }
  | {
      status: 'gps_unavailable';
      location: Location;
      message: string;
    };

export async function checkCurrentPositionAgainstLocation(location: Location): Promise<GeoCheckResult> {
  const position = await getCurrentPosition();
  const distanceMeters = getDistanceMeters(
    position.coords.latitude,
    position.coords.longitude,
    location.latitude,
    location.longitude
  );
  const roundedDistance = Math.round(distanceMeters);
  const roundedAccuracy = Math.round(position.coords.accuracy);

  if (distanceMeters > location.radiusMeters) {
    return {
      status: 'outside_radius',
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: roundedAccuracy,
      distanceMeters: roundedDistance,
      location,
      message: `You are approximately ${roundedDistance}m from ${location.name}. Allowed radius is ${location.radiusMeters}m.`
    };
  }

  return {
    status: 'normal',
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: roundedAccuracy,
    distanceMeters: roundedDistance,
    location,
    message: `Within ${location.name} radius. GPS accuracy ${roundedAccuracy}m.`
  };
}

export function getGpsUnavailableResult(location: Location, reason = 'GPS is unavailable or permission was denied.'): GeoCheckResult {
  return {
    status: 'gps_unavailable',
    location,
    message: `${reason} This attendance action will be accepted but flagged for review.`
  };
}

function getCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    });
  });
}

function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radiusMeters = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radiusMeters * c;
}

function toRadians(degrees: number) {
  return degrees * (Math.PI / 180);
}
