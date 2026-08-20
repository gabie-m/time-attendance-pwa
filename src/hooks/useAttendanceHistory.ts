import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import {
  getMyAttendanceHistory,
  type AttendanceHistoryOptions
} from '../services/attendanceHistoryService';

export const attendanceHistoryQueryKey = ['attendance-history'] as const;

export function useAttendanceHistory(options: AttendanceHistoryOptions = {}) {
  const { user } = useAuth();
  const days = options.days ?? 30;

  return useQuery({
    queryKey: [...attendanceHistoryQueryKey, user?.id ?? 'unauthenticated', days],
    queryFn: async () => {
      const result = await getMyAttendanceHistory({ days }, user?.id);

      if (!result.success) {
        throw new Error(result.error);
      }

      return result.data;
    },
    enabled: Boolean(user),
    staleTime: import.meta.env.VITE_USE_MOCK_AUTH === 'true' ? 0 : 60 * 1000
  });
}
