import type { Location } from '../domain/types';

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
