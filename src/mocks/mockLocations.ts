import type { Location } from '../domain/types';

export const locations: Location[] = [
  {
    id: '5f979d1a-19d6-4bb3-ae6c-111111111111',
    name: 'SM Megamall',
    address: 'Mandaluyong City',
    latitude: 14.5852,
    longitude: 121.0566,
    radiusMeters: 250,
    active: true
  },
  {
    id: '5f979d1a-19d6-4bb3-ae6c-222222222222',
    name: 'Robinsons Galleria',
    address: 'Ortigas Center',
    latitude: 14.5915,
    longitude: 121.0599,
    radiusMeters: 150,
    active: true
  },
  {
    id: '5f979d1a-19d6-4bb3-ae6c-333333333333',
    name: 'Main Warehouse',
    address: 'Pasig City',
    latitude: 14.5764,
    longitude: 121.0851,
    radiusMeters: 400,
    active: true
  }
];
