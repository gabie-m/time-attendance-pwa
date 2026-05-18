import { useContext } from 'react';
import { MockAuthContext } from '../mocks/mockAuthContext';

export function useMockAuth() {
  const value = useContext(MockAuthContext);
  if (!value) {
    throw new Error('useMockAuth must be used inside MockAuthProvider');
  }
  return value;
}
