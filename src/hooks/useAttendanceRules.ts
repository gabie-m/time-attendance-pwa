import { useQuery } from '@tanstack/react-query';
import {
  defaultAttendanceRules,
  getAttendanceRules
} from '../services/attendanceRulesService';

export const attendanceRulesQueryKey = ['attendance-rules'] as const;

export function useAttendanceRules() {
  const isMockMode = import.meta.env.VITE_USE_MOCK_AUTH === 'true';

  return useQuery({
    queryKey: attendanceRulesQueryKey,
    queryFn: async () => {
      const result = await getAttendanceRules();

      if (!result.success) {
        throw new Error(result.error);
      }

      return result.data;
    },
    initialData: isMockMode ? defaultAttendanceRules : undefined,
    staleTime: 5 * 60 * 1000
  });
}
