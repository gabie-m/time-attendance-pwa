import { useQuery } from '@tanstack/react-query';
import {
  defaultAttendanceRules,
  getAttendanceRules
} from '../services/attendanceRulesService';

export const attendanceRulesQueryKey = ['attendance-rules'] as const;

export function useAttendanceRules() {
  return useQuery({
    queryKey: attendanceRulesQueryKey,
    queryFn: async () => {
      const result = await getAttendanceRules();

      if (!result.success) {
        throw new Error(result.error);
      }

      return result.data;
    },
    initialData: defaultAttendanceRules,
    staleTime: 5 * 60 * 1000
  });
}
