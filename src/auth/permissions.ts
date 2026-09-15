import type { MockUser } from './types';

export function getDefaultRouteForUser(user: MockUser) {
  if (user.role === 'admin') {
    return '/admin';
  }

  if (user.attendanceModel === 'roving') {
    return '/roving';
  }

  if (user.attendanceModel === 'stationary') {
    return '/stationary';
  }

  return user.role === 'manager' ? '/manager' : '/history';
}

export function canAccessRoute(user: MockUser, route: string) {
  if (route === '/requests') {
    return true;
  }

  if (route === '/history') {
    return true;
  }

  if (route === '/stationary') {
    return user.attendanceModel === 'stationary';
  }

  if (route === '/roving') {
    return user.attendanceModel === 'roving';
  }

  if (route === '/manager' || route === '/manager/flags') {
    return user.role === 'manager';
  }

  if (route === '/admin/reports' || route === '/admin/flags' || route.startsWith('/admin/attendance/')) {
    return user.role === 'admin';
  }

  if (route === '/admin') {
    return user.role === 'admin';
  }

  return true;
}
