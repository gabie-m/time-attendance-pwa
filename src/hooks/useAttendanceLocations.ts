import { useQuery } from '@tanstack/react-query';
import { getAttendanceLocations } from '../services/attendanceLocationService';

export const attendanceLocationsQueryKey = ['attendance-locations'] as const;

export function useAttendanceLocations(userId: string) {
  return useQuery({
    queryKey: [...attendanceLocationsQueryKey, userId],
    queryFn: async () => {
      const result = await getAttendanceLocations(userId);

      if (!result.success) {
        throw new Error(result.error);
      }

      return result.data;
    },
    staleTime: 5 * 60 * 1000
  });
}
