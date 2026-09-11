import { describe, expect, it } from 'vitest';
import type { MockUser } from './types';
import { canAccessRoute, getDefaultRouteForUser } from './permissions';

describe('role route permissions', () => {
  it('allows every staff-profile role to capture their own attendance', () => {
    expect(canAccessRoute(makeUser('manager', 'stationary'), '/stationary')).toBe(true);
    expect(canAccessRoute(makeUser('hr', 'roving'), '/roving')).toBe(true);
    expect(canAccessRoute(makeUser('admin', 'stationary'), '/stationary')).toBe(true);
  });

  it('keeps a review-only HR account out of attendance capture routes', () => {
    const hrReviewer = makeUser('hr', null);

    expect(getDefaultRouteForUser(hrReviewer)).toBe('/history');
    expect(canAccessRoute(hrReviewer, '/stationary')).toBe(false);
    expect(canAccessRoute(hrReviewer, '/roving')).toBe(false);
    expect(canAccessRoute(hrReviewer, '/admin')).toBe(false);
  });

  it('keeps system administration restricted to admins', () => {
    expect(canAccessRoute(makeUser('hr', null), '/admin')).toBe(false);
    expect(canAccessRoute(makeUser('manager', 'stationary'), '/admin')).toBe(false);
    expect(canAccessRoute(makeUser('admin', null), '/admin')).toBe(true);
  });
});

function makeUser(role: MockUser['role'], attendanceModel: MockUser['attendanceModel']): MockUser {
  return {
    id: `${role}-test`,
    name: `${role} test`,
    role,
    attendanceModel,
    expectedLocation: '',
    shift: '',
    locationConsentGivenAt: null
  };
}
