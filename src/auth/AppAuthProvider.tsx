/*
 * Logic-driven props: children.
 * Display-only props: none; this provider selects the auth implementation.
 */
import { Suspense, lazy } from 'react';
import type { ReactNode } from 'react';
import { MockAuthProvider } from './MockAuthProvider';

const SupabaseAuthProvider = lazy(() => {
  return import('./AuthProvider').then((module) => ({ default: module.AuthProvider }));
});

export function AppAuthProvider({ children }: { children: ReactNode }) {
  if (import.meta.env.VITE_USE_MOCK_AUTH === 'true') {
    return <MockAuthProvider>{children}</MockAuthProvider>;
  }

  return (
    <Suspense fallback={<div className="loading-screen">Loading authentication...</div>}>
      <SupabaseAuthProvider>{children}</SupabaseAuthProvider>
    </Suspense>
  );
}
