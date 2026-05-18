import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { MockAuthContext } from '../mocks/mockAuthContext';
import { mockUsers } from '../mocks/mockUsers';
import type { MockUser } from './types';

export function MockAuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserIdState] = useState(() => {
    return window.localStorage.getItem('mock-user-id') ?? mockUsers[0].id;
  });
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

  const value = useMemo(() => {
    return {
      user,
      users: mockUsers,
      setUserId: (nextUserId: string) => {
        window.localStorage.setItem('mock-user-id', nextUserId);
        setUserIdState(nextUserId);
      },
      giveLocationConsent: () => {
        const nextIds = Array.from(new Set([...consentedUserIds, user.id]));
        window.localStorage.setItem('mock-consented-user-ids', JSON.stringify(nextIds));
        setConsentedUserIds(nextIds);
      }
    };
  }, [consentedUserIds, user]);

  return <MockAuthContext.Provider value={value}>{children}</MockAuthContext.Provider>;
}
