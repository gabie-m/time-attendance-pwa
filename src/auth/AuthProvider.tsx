/*
 * Logic-driven props: children.
 * Display-only props: none; this provider owns authentication state only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { AuthContext } from './AuthContext';
import type { MockUser } from './types';
import type { AttendanceModel, Role } from '../domain/types';
import {
  cacheAuthenticatedProfile,
  getCachedAuthenticatedProfile,
  removeCachedAuthenticatedProfile
} from '../offline/offlineQueue';
import { supabase } from '../lib/supabaseClient';
import {
  getSession,
  onAuthStateChange,
  signIn as signInWithSupabase,
  signOut as signOutFromSupabase
} from '../services/authService';
import type { ServiceResult } from '../services/serviceResult';
import { failure, success } from '../services/serviceResult';

type UserRow = {
  id: string;
  name: string | null;
  role: Role | null;
  active: boolean;
  location_consent_given_at: string | null;
};

type StaffProfileRow = {
  default_attendance_model: AttendanceModel | null;
  shift_label: string | null;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MockUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [consentError, setConsentError] = useState<string | null>(null);
  const activeRef = useRef(false);
  const authRequestVersionRef = useRef(0);
  const currentSessionUserIdRef = useRef<string | null>(null);

  const beginAuthenticatedRequest = useCallback((authUser: SupabaseUser) => {
    const requestVersion = authRequestVersionRef.current + 1;
    authRequestVersionRef.current = requestVersion;
    currentSessionUserIdRef.current = authUser.id;
    return requestVersion;
  }, []);

  const clearActiveSession = useCallback(() => {
    authRequestVersionRef.current += 1;
    currentSessionUserIdRef.current = null;
    setUser(null);
    setLoading(false);
  }, []);

  const isCurrentAuthenticatedRequest = useCallback((authUserId: string, requestVersion: number) => {
    return activeRef.current
      && authRequestVersionRef.current === requestVersion
      && currentSessionUserIdRef.current === authUserId;
  }, []);

  const clearFailedProfileSession = useCallback(async () => {
    clearActiveSession();
    await signOutFromSupabase();
  }, [clearActiveSession]);

  const loadUserProfile = useCallback(async (authUser: SupabaseUser, requestVersion: number) => {
    const profileResult = await fetchAuthenticatedUserProfile(authUser);

    if (!isCurrentAuthenticatedRequest(authUser.id, requestVersion)) {
      return;
    }

    if (!profileResult.success) {
      const cachedProfile = await getCachedAuthenticatedProfile(authUser.id);
      if (cachedProfile && isOfflineProfileFailure(profileResult.error)) {
        if (isCurrentAuthenticatedRequest(authUser.id, requestVersion)) {
          setUser(cachedProfile);
          setLoading(false);
        }
        return;
      }
      if (!isCurrentAuthenticatedRequest(authUser.id, requestVersion)) {
        return;
      }
      await clearFailedProfileSession();
    }

    if (!isCurrentAuthenticatedRequest(authUser.id, requestVersion)) {
      return;
    }

    if (profileResult.success) {
      await cacheAuthenticatedProfile(profileResult.data);
    }
    if (!isCurrentAuthenticatedRequest(authUser.id, requestVersion)) {
      return;
    }
    setUser(profileResult.success ? profileResult.data : null);
    setLoading(false);
  }, [clearFailedProfileSession, isCurrentAuthenticatedRequest]);

  useEffect(() => {
    activeRef.current = true;

    async function loadCurrentSession() {
      const initialRequestVersion = authRequestVersionRef.current;
      const sessionResult = await getSession();

      if (!activeRef.current || authRequestVersionRef.current !== initialRequestVersion) {
        return;
      }

      if (!sessionResult.success || !sessionResult.data?.user) {
        clearActiveSession();
        return;
      }

      await loadUserProfile(sessionResult.data.user, beginAuthenticatedRequest(sessionResult.data.user));
    }

    const subscriptionResult = onAuthStateChange((_event, session) => {
      setLoading(true);

      if (!session?.user) {
        clearActiveSession();
        return;
      }

      void loadUserProfile(session.user, beginAuthenticatedRequest(session.user));
    });

    void loadCurrentSession();

    return () => {
      activeRef.current = false;

      if (subscriptionResult.success) {
        subscriptionResult.data.unsubscribe();
      }
    };
  }, [beginAuthenticatedRequest, clearActiveSession, loadUserProfile]);

  const value = useMemo(() => {
    return {
      user,
      users: user ? [user] : [],
      loading,
      signIn: async (email: string, password: string) => {
        const sessionResult = await signInWithSupabase(email, password);

        if (!sessionResult.success) {
          return failure<MockUser>(sessionResult.error);
        }

        if (!sessionResult.data?.user) {
          return failure<MockUser>('Sign in completed without an authenticated session.');
        }

        const requestVersion = beginAuthenticatedRequest(sessionResult.data.user);
        const profileResult = await fetchAuthenticatedUserProfile(sessionResult.data.user);

        if (!isCurrentAuthenticatedRequest(sessionResult.data.user.id, requestVersion)) {
          return failure<MockUser>('Your sign-in session changed before your profile could be loaded. Please sign in again.');
        }

        if (profileResult.success) {
          setUser(profileResult.data);
          await cacheAuthenticatedProfile(profileResult.data);
          return profileResult;
        }

        if (!isCurrentAuthenticatedRequest(sessionResult.data.user.id, requestVersion)) {
          return failure<MockUser>('Your sign-in session changed before your profile could be loaded. Please sign in again.');
        }
        await clearFailedProfileSession();
        return profileResult;
      },
      signOut: async () => {
        clearActiveSession();
        const result = await signOutFromSupabase();

        if (user) {
          await removeCachedAuthenticatedProfile(user.id);
        }
        return result;
      },
      setUserId: () => {
        // Real auth does not support role switching; the mock provider owns that demo behavior.
      },
      consentError,
      giveLocationConsent: async () => {
        if (!supabase) {
          const error = 'Unable to save your location consent. Please try again before recording attendance.';
          setConsentError(error);
          return failure<null>(error);
        }

        setConsentError(null);
        const { data, error } = await supabase.rpc('record_location_consent');

        if (error) {
          const message = 'Unable to save your location consent. Please try again before recording attendance.';
          setConsentError(message);
          return failure<null>(message);
        }

        if (typeof data !== 'string') {
          const message = 'Unable to confirm your location consent. Please try again before recording attendance.';
          setConsentError(message);
          return failure<null>(message);
        }

        setUser((currentUser) => {
          if (!currentUser) {
            return currentUser;
          }
          const nextUser = {
            ...currentUser,
            locationConsentGivenAt: data
          };
          void cacheAuthenticatedProfile(nextUser);
          return nextUser;
        });

        return success<null>(null);
      }
    };
  }, [beginAuthenticatedRequest, clearActiveSession, clearFailedProfileSession, consentError, isCurrentAuthenticatedRequest, loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function fetchAuthenticatedUserProfile(
  authUser: SupabaseUser
): Promise<ServiceResult<MockUser>> {
  if (!supabase) {
    return failure('Supabase environment variables are not configured.');
  }

  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('id,name,role,active,location_consent_given_at')
    .eq('id', authUser.id)
    .maybeSingle<UserRow>();

  if (userError) {
    return failure(userError.message);
  }

  if (!userRow) {
    return failure('Your account is not available. Contact an administrator.');
  }

  if (!userRow.active) {
    return failure('This account is inactive. Contact an administrator.');
  }

  const { data: staffProfileRow, error: staffProfileError } = await supabase
    .from('staff_profiles')
    .select('default_attendance_model,shift_label')
    .eq('user_id', authUser.id)
    .maybeSingle<StaffProfileRow>();

  if (staffProfileError) {
    return failure(staffProfileError.message);
  }

  if (!staffProfileRow) {
    return failure('Your account setup is incomplete. Contact an administrator.');
  }

  return success({
    id: userRow.id,
    name: userRow.name ?? authUser.email ?? 'User',
    role: normalizeRole(userRow.role),
    attendanceModel: normalizeAttendanceModel(staffProfileRow.default_attendance_model),
    expectedLocation: '',
    shift: staffProfileRow.shift_label ?? 'Assigned shift',
    locationConsentGivenAt: userRow.location_consent_given_at
  });
}

function normalizeRole(role: Role | null): Role {
  if (role === 'manager' || role === 'admin') {
    return role;
  }

  return 'user';
}

function normalizeAttendanceModel(attendanceModel: AttendanceModel | null | undefined): AttendanceModel {
  return attendanceModel === 'roving' ? 'roving' : 'stationary';
}

function isOfflineProfileFailure(error: string) {
  return !navigator.onLine || /network|fetch|timed out|connection/i.test(error);
}
