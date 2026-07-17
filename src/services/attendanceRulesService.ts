import { supabase } from '../lib/supabaseClient';
import type { ServiceResult } from './serviceResult';
import { failure, success } from './serviceResult';

export type AttendanceRuleKey =
  | 'late_grace_minutes'
  | 'overtime_threshold_minutes'
  | 'lunch_deduction_minutes'
  | 'photo_time_mismatch_threshold_minutes'
  | 'clock_discrepancy_threshold_minutes';

export type AttendanceRules = Record<AttendanceRuleKey, number>;

type AttendanceRuleRow = {
  rule_key: string;
  rule_value: number | string;
};

const attendanceRulesCacheTtlMs = 5 * 60 * 1000;

export const defaultAttendanceRules: AttendanceRules = {
  late_grace_minutes: 0,
  overtime_threshold_minutes: 480,
  lunch_deduction_minutes: 60,
  photo_time_mismatch_threshold_minutes: 5,
  clock_discrepancy_threshold_minutes: 5
};

let cachedRules: {
  expiresAt: number;
  rules: AttendanceRules;
} | null = null;

export async function getAttendanceRules(): Promise<ServiceResult<AttendanceRules>> {
  if (isMockAuthMode()) {
    return success(defaultAttendanceRules);
  }

  if (cachedRules && cachedRules.expiresAt > Date.now()) {
    return success(cachedRules.rules);
  }

  if (!supabase) {
    return failure('Supabase environment variables are not configured.');
  }

  const today = getManilaDateString();
  const { data, error } = await supabase
    .from('attendance_rules')
    .select('rule_key,rule_value')
    .lte('effective_from', today)
    .or(`effective_to.is.null,effective_to.gte.${today}`);

  if (error) {
    return failure(error.message);
  }

  const rulesResult = normalizeAttendanceRules(data ?? []);
  if (!rulesResult.success) {
    return rulesResult;
  }

  const rules = rulesResult.data;
  cachedRules = {
    rules,
    expiresAt: Date.now() + attendanceRulesCacheTtlMs
  };

  return success(rules);
}

export async function getRule(ruleKey: AttendanceRuleKey): Promise<ServiceResult<number>> {
  const rulesResult = await getAttendanceRules();

  if (!rulesResult.success) {
    return rulesResult;
  }

  return success(getAttendanceRuleValue(rulesResult.data, ruleKey));
}

export function getAttendanceRuleValue(rules: AttendanceRules, ruleKey: AttendanceRuleKey) {
  return rules[ruleKey];
}

function normalizeAttendanceRules(rows: AttendanceRuleRow[]): ServiceResult<AttendanceRules> {
  const rules: Partial<AttendanceRules> = {};

  for (const row of rows) {
    if (!isAttendanceRuleKey(row.rule_key)) {
      continue;
    }

    const value = normalizeRuleValue(row.rule_value);
    if (value === null) {
      return failure('Attendance rules are unavailable.');
    }

    rules[row.rule_key] = value;
  }

  if (Object.keys(defaultAttendanceRules).some((ruleKey) => rules[ruleKey as AttendanceRuleKey] === undefined)) {
    return failure('Attendance rules are unavailable.');
  }

  return success(rules as AttendanceRules);
}

function normalizeRuleValue(ruleValue: AttendanceRuleRow['rule_value']) {
  const numericValue = Number(ruleValue);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function isAttendanceRuleKey(ruleKey: string): ruleKey is AttendanceRuleKey {
  return ruleKey in defaultAttendanceRules;
}

function getManilaDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila'
  }).format(new Date());
}

function isMockAuthMode() {
  return import.meta.env.VITE_USE_MOCK_AUTH === 'true';
}
