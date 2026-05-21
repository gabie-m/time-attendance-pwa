import type { Session } from '@supabase/supabase-js';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import type { ServiceResult } from './serviceResult';
import { failure, success } from './serviceResult';

export type AuthStateSubscription = {
  unsubscribe: () => void;
};

export async function signIn(email: string, password: string): Promise<ServiceResult<Session | null>> {
  const clientResult = getConfiguredSupabase();

  if (!clientResult.success) {
    return failure(clientResult.error ?? 'Supabase is not configured.');
  }

  const { data, error } = await clientResult.data.auth.signInWithPassword({ email, password });

  if (error) {
    return failure(error.message);
  }

  return success(data.session);
}

export async function signOut(): Promise<ServiceResult<null>> {
  const clientResult = getConfiguredSupabase();

  if (!clientResult.success) {
    return failure(clientResult.error ?? 'Supabase is not configured.');
  }

  const { error } = await clientResult.data.auth.signOut();

  if (error) {
    return failure(error.message);
  }

  return success(null);
}

export async function getSession(): Promise<ServiceResult<Session | null>> {
  const clientResult = getConfiguredSupabase();

  if (!clientResult.success) {
    return failure(clientResult.error ?? 'Supabase is not configured.');
  }

  const { data, error } = await clientResult.data.auth.getSession();

  if (error) {
    return failure(error.message);
  }

  return success(data.session);
}

export function onAuthStateChange(
  callback: (session: Session | null) => void
): ServiceResult<AuthStateSubscription> {
  const clientResult = getConfiguredSupabase();

  if (!clientResult.success) {
    return failure(clientResult.error ?? 'Supabase is not configured.');
  }

  const { data } = clientResult.data.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });

  return success({
    unsubscribe: () => data.subscription.unsubscribe()
  });
}

function getConfiguredSupabase() {
  if (!hasSupabaseConfig || !supabase) {
    return failure<NonNullable<typeof supabase>>('Supabase environment variables are not configured.');
  }

  return success(supabase);
}
