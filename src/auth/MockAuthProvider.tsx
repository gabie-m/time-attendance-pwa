import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AuthContext } from './AuthContext';
import { MockAuthContext } from '../mocks/mockAuthContext';
import { mockUsers } from '../mocks/mockUsers';
import { success } from '../services/serviceResult';
import { listStaffProfiles, listUsers, subscribeStaffService } from '../services/mockStaffService';
import type { MockUser } from './types';

export function MockAuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserIdState] = useState(() => {
    return window.localStorage.getItem('mock-user-id') ?? mockUsers[0].id;
  });
  const [signedOut, setSignedOut] = useState(false);
  const [, setStaffVersion] = useState(0);
  const [consentedUserIds, setConsentedUserIds] = useState<string[]>(() => {
    return JSON.parse(window.localStorage.getItem('mock-consented-user-ids') ?? '[]') as string[];
  });

  useEffect(() => subscribeStaffService(() => setStaffVersion((version) => version + 1)), []);

  const users = getMockUsers();

  const user = useMemo<MockUser>(() => {
    const baseUser = users.find((item) => item.id === userId) ?? users[0] ?? mockUsers[0];
    return {
      ...baseUser,
      locationConsentGivenAt: consentedUserIds.includes(baseUser.id)
        ? new Date().toISOString()
        : baseUser.locationConsentGivenAt
    };
  }, [consentedUserIds, userId, users]);

  const sharedValue = useMemo(() => {
    return {
      user: signedOut ? null : user,
      users,
      setUserId: (nextUserId: string) => {
        window.localStorage.setItem('mock-user-id', nextUserId);
        setUserIdState(nextUserId);
        setSignedOut(false);
      },
      consentError: null,
      giveLocationConsent: async () => {
        const nextIds = Array.from(new Set([...consentedUserIds, user.id]));
        window.localStorage.setItem('mock-consented-user-ids', JSON.stringify(nextIds));
        setConsentedUserIds(nextIds);
        return success<null>(null);
      },
      loading: false,
      signIn: async () => {
        setSignedOut(false);
        return success(user);
      },
      signOut: async () => {
        setSignedOut(true);
        return success(null);
      }
    };
  }, [consentedUserIds, signedOut, user, users]);

  const mockValue = useMemo(() => {
    return {
      user,
      users,
      setUserId: sharedValue.setUserId,
      giveLocationConsent: sharedValue.giveLocationConsent
    };
  }, [sharedValue.giveLocationConsent, sharedValue.setUserId, user, users]);

  return (
    <AuthContext.Provider value={sharedValue}>
      <MockAuthContext.Provider value={mockValue}>{children}</MockAuthContext.Provider>
    </AuthContext.Provider>
  );
}

function getMockUsers(): MockUser[] {
  const profiles = listStaffProfiles();
  return listUsers()
    .filter((account) => account.active)
    .map((account) => {
      const profile = profiles.find((item) => item.user_id === account.id && item.active);
      const legacyUser = mockUsers.find((item) => item.id === account.id);
      return {
        id: account.id,
        name: account.name,
        role: account.role,
        attendanceModel: profile?.default_attendance_model ?? null,
        expectedLocation: legacyUser?.expectedLocation ?? '',
        shift: profile?.shift_label ?? 'No attendance profile assigned',
        locationConsentGivenAt: legacyUser?.locationConsentGivenAt ?? null
      };
    });
}
