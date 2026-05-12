import { createContext } from 'react';
import type { MockUser } from './types';

export type MockAuthContextValue = {
  user: MockUser;
  users: MockUser[];
  setUserId: (userId: string) => void;
  giveLocationConsent: () => void;
};

export const MockAuthContext = createContext<MockAuthContextValue | null>(null);
