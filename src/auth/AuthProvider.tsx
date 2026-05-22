/*
 * Logic-driven props: children.
 * Display-only props: none; this provider owns authentication state only.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { AuthContext } from './AuthContext';
import type { MockUser } from './types';
import type { AttendanceModel, Role } from '../domain/types';
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
};

type StaffProfileRow = {
  default_attendance_model: AttendanceModel | null;
  shift_label: string | null;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MockUser | null>(null);
  const [loading, setLoading] = useState(true);
  const activeRef = useRef(false);

  useEffect(() => {
    activeRef.current = true;

    async function loadCurrentSession() {
      const sessionResult = await getSession();

      if (!activeRef.current) {
        return;
      }

      if (!sessionResult.success || !sessionResult.data?.user) {
        setUser(null);
        setLoading(false);
        return;
      }

      await loadUserProfile(sessionResult.data.user);
    }

    const subscriptionResult = onAuthStateChange((session) => {
      setLoading(true);

      if (!session?.user) {
        setUser(null);
        setLoading(false);
        return;
      }

      void loadUserProfile(session.user);
    });

    void loadCurrentSession();

    return () => {
      activeRef.current = false;

      if (subscriptionResult.success) {
        subscriptionResult.data.unsubscribe();
      }
    };
  }, []);

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

        const profileResult = await fetchAuthenticatedUserProfile(sessionResult.data.user);

        if (profileResult.success) {
          setUser(profileResult.data);
        }

        return profileResult;
      },
      signOut: async () => {
        const result = await signOutFromSupabase();

        if (result.success) {
          setUser(null);
        }

        return result;
      },
      setUserId: () => {
        // Real auth does not support role switching; the mock provider owns that demo behavior.
      },
      giveLocationConsent: () => {
        setUser((currentUser) => {
          if (!currentUser) {
            return currentUser;
          }

          return {
            ...currentUser,
            locationConsentGivenAt: new Date().toISOString()
          };
        });
      }
    };
  }, [loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;

  async function loadUserProfile(authUser: SupabaseUser) {
    const profileResult = await fetchAuthenticatedUserProfile(authUser);

    if (!activeRef.current) {
      return;
    }

    setUser(profileResult.success ? profileResult.data : null);
    setLoading(false);
  }
}

async function fetchAuthenticatedUserProfile(
  authUser: SupabaseUser
): Promise<ServiceResult<MockUser>> {
  if (!supabase) {
    return failure('Supabase environment variables are not configured.');
  }

  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('id,name,role')
    .eq('id', authUser.id)
    .maybeSingle<UserRow>();

  if (userError) {
    return failure(userError.message);
  }

  if (!userRow) {
    return failure('Authenticated user profile was not found.');
  }

  const { data: staffProfileRow, error: staffProfileError } = await supabase
    .from('staff_profiles')
    .select('default_attendance_model,shift_label')
    .eq('user_id', authUser.id)
    .maybeSingle<StaffProfileRow>();

  if (staffProfileError) {
    return failure(staffProfileError.message);
  }

  return success({
    id: userRow.id,
    name: userRow.name ?? authUser.email ?? 'User',
    role: normalizeRole(userRow.role),
    attendanceModel: normalizeAttendanceModel(staffProfileRow?.default_attendance_model),
    expectedLocation: '',
    shift: staffProfileRow?.shift_label ?? 'Assigned shift',
    locationConsentGivenAt: null
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
