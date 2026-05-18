import { useEffect, useState } from 'react';
import {
  listStaffSetupRecords,
  subscribeStaffService
} from '../services/mockStaffService';

export function useStaffSetupRecords() {
  const [records, setRecords] = useState(() => listStaffSetupRecords());

  useEffect(() => {
    return subscribeStaffService(() => {
      setRecords(listStaffSetupRecords());
    });
  }, []);

  return records;
}
