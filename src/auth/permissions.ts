import type { MockUser } from './types';

export function getDefaultRouteForUser(user: MockUser) {
  if (user.role === 'admin') {
    return '/admin';
  }

  if (user.role === 'manager') {
    return user.attendanceModel === 'roving' ? '/roving' : '/stationary';
  }

  return user.attendanceModel === 'roving' ? '/roving' : '/stationary';
}

export function canAccessRoute(user: MockUser, route: string) {
  if (route === '/requests') {
    return user.role === 'user' || user.role === 'manager';
  }

  if (route === '/stationary') {
    return user.attendanceModel === 'stationary' && user.role !== 'admin';
  }

  if (route === '/roving') {
    return user.attendanceModel === 'roving' && user.role !== 'admin';
  }

  if (route === '/manager' || route === '/reports') {
    return user.role === 'manager' || user.role === 'admin';
  }

  if (route === '/admin') {
    return user.role === 'admin';
  }

  return true;
}
