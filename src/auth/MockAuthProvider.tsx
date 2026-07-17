import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AuthContext } from './AuthContext';
import { MockAuthContext } from '../mocks/mockAuthContext';
import { mockUsers } from '../mocks/mockUsers';
import { success } from '../services/serviceResult';
import type { MockUser } from './types';

export function MockAuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserIdState] = useState(() => {
    return window.localStorage.getItem('mock-user-id') ?? mockUsers[0].id;
  });
  const [signedOut, setSignedOut] = useState(false);
  const [consentedUserIds, setConsentedUserIds] = useState<string[]>(() => {
    return JSON.parse(window.localStorage.getItem('mock-consented-user-ids') ?? '[]') as string[];
  });

  const user = useMemo<MockUser>(() => {
    const baseUser = mockUsers.find((item) => item.id === userId) ?? mockUsers[0];
    return {
      ...baseUser,
      locationConsentGivenAt: consentedUserIds.includes(baseUser.id)
        ? new Date().toISOString()
        : baseUser.locationConsentGivenAt
    };
  }, [consentedUserIds, userId]);

  const sharedValue = useMemo(() => {
    return {
      user: signedOut ? null : user,
      users: mockUsers,
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
  }, [consentedUserIds, signedOut, user]);

  const mockValue = useMemo(() => {
    return {
      user,
      users: mockUsers,
      setUserId: sharedValue.setUserId,
      giveLocationConsent: sharedValue.giveLocationConsent
    };
  }, [sharedValue.giveLocationConsent, sharedValue.setUserId, user]);

  return (
    <AuthContext.Provider value={sharedValue}>
      <MockAuthContext.Provider value={mockValue}>{children}</MockAuthContext.Provider>
    </AuthContext.Provider>
  );
}
