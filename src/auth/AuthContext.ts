import { createContext } from 'react';
import type { MockUser } from './types';
import type { ServiceResult } from '../services/serviceResult';

export type AuthContextValue = {
  user: MockUser | null;
  users: MockUser[];
  loading: boolean;
  signIn: (email: string, password: string) => Promise<ServiceResult<MockUser>>;
  signOut: () => Promise<ServiceResult<null>>;
  setUserId: (userId: string) => void;
  giveLocationConsent: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
