import { useEffect, useState } from 'react';
import {
  listFlagReviewRecords,
  subscribeFlagReviewRecords
} from '../services/mockFlagReviewService';

export function useFlagReviewRecords() {
  const [records, setRecords] = useState(() => listFlagReviewRecords());

  useEffect(() => {
    return subscribeFlagReviewRecords(() => {
      setRecords(listFlagReviewRecords());
    });
  }, []);

  return records;
}
