import { useEffect, useState } from 'react';
import { locations as seedLocations } from '../mocks/mockLocations';
import type { Location } from '../domain/types';

export type LocationFormInput = {
  id?: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  active: boolean;
};

const locationStorageKey = 'admin-locations';
const listeners = new Set<() => void>();

export function useMockLocations() {
  const [locations, setLocations] = useState(() => listLocations());

  useEffect(() => {
    return subscribeLocations(() => {
      setLocations(listLocations());
    });
  }, []);

  return locations;
}

export function listLocations() {
  return readJson<Location[]>(locationStorageKey, seedLocations);
}

export function saveLocation(input: LocationFormInput) {
  const validationError = getLocationValidationError(input);
  if (validationError) {
    return { ok: false as const, error: validationError };
  }

  const locations = listLocations();
  const nextLocation: Location = {
    id: input.id ?? crypto.randomUUID(),
    name: input.name.trim(),
    address: input.address.trim(),
    latitude: input.latitude,
    longitude: input.longitude,
    radiusMeters: input.radiusMeters,
    active: input.active
  };

  const exists = locations.some((location) => location.id === nextLocation.id);
  const nextLocations = exists
    ? locations.map((location) => (location.id === nextLocation.id ? nextLocation : location))
    : [nextLocation, ...locations];

  writeLocations(nextLocations);
  return { ok: true as const, location: nextLocation };
}

export function toggleLocationActive(locationId: string) {
  const nextLocations = listLocations().map((location) => {
    if (location.id !== locationId) {
      return location;
    }

    return {
      ...location,
      active: !location.active
    };
  });

  writeLocations(nextLocations);
}

function getLocationValidationError(input: LocationFormInput) {
  if (!input.name.trim()) {
    return 'Location name is required.';
  }

  if (!input.address.trim()) {
    return 'Address is required.';
  }

  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
    return 'Latitude must be between -90 and 90.';
  }

  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    return 'Longitude must be between -180 and 180.';
  }

  if (!Number.isFinite(input.radiusMeters) || input.radiusMeters <= 0) {
    return 'Allowed radius must be greater than 0 meters.';
  }

  return null;
}

function subscribeLocations(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitChange() {
  listeners.forEach((listener) => listener());
}

function writeLocations(locations: Location[]) {
  window.localStorage.setItem(locationStorageKey, JSON.stringify(locations));
  emitChange();
}

function readJson<T>(key: string, fallback: T) {
  const rawValue = window.localStorage.getItem(key);
  if (!rawValue) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}
