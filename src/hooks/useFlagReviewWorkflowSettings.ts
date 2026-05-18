import { useEffect, useState } from 'react';
import {
  listFlagReviewWorkflowSettings,
  subscribeFlagReviewWorkflowSettings
} from '../services/mockFlagReviewSettingsService';

export function useFlagReviewWorkflowSettings() {
  const [settings, setSettings] = useState(() => listFlagReviewWorkflowSettings());

  useEffect(() => {
    return subscribeFlagReviewWorkflowSettings(() => {
      setSettings(listFlagReviewWorkflowSettings());
    });
  }, []);

  return settings;
}
