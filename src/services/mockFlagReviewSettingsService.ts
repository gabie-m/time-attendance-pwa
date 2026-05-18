import {
  defaultFlagReviewWorkflowSettings,
  type FlagReviewWorkflowSetting
} from '../mocks/mockFlagReviewData';
import type { EventFlagType } from '../mocks/mockAttendanceDetailData';

const flagReviewWorkflowSettingsStorageKey = 'flag-review-workflow-settings';
const listeners = new Set<() => void>();

export function listFlagReviewWorkflowSettings() {
  return readJson<FlagReviewWorkflowSetting[]>(
    flagReviewWorkflowSettingsStorageKey,
    defaultFlagReviewWorkflowSettings
  );
}

export function updateFlagReviewWorkflowSetting(input: FlagReviewWorkflowSetting) {
  const settings = listFlagReviewWorkflowSettings();
  const nextSettings = settings.map((setting) => {
    return setting.flagType === input.flagType ? input : setting;
  });

  window.localStorage.setItem(flagReviewWorkflowSettingsStorageKey, JSON.stringify(nextSettings));
  emitChange();
  return nextSettings;
}

export function getFlagReviewWorkflowModeForFlagType(flagType: EventFlagType) {
  return (
    listFlagReviewWorkflowSettings().find((setting) => setting.flagType === flagType)?.workflowMode ??
    defaultFlagReviewWorkflowSettings[0].workflowMode
  );
}

export function subscribeFlagReviewWorkflowSettings(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitChange() {
  listeners.forEach((listener) => listener());
}

function readJson<T>(key: string, fallback: T) {
  const rawValue = window.localStorage.getItem(key);
  if (!rawValue) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}
