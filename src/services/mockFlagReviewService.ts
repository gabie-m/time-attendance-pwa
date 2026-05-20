import {
  flagReviewRecords as seedFlagReviewRecords,
  type FlagReviewActionHistoryItem,
  type FlagReviewerDecision,
  type FlagReviewerDecisionStatus,
  type FlagReviewRecord,
  type FlagReviewWorkflowMode
} from '../mocks/mockFlagReviewData';

export type ManagerFlagReviewAction = 'approve' | 'pre_approve' | 'reject';
export type AdminFlagReviewAction = 'mark_reviewed' | 'approve' | 'reject' | 'resolve';

export type FlagReviewActionInput<TAction extends string> = {
  recordId: string;
  action: TAction;
  actorName: string;
  remarks: string;
  workflowMode: FlagReviewWorkflowMode;
};

const flagReviewRecordsStorageKey = 'flag-review-records';
const listeners = new Set<() => void>();

export function listFlagReviewRecords() {
  return readJson<FlagReviewRecord[]>(flagReviewRecordsStorageKey, seedFlagReviewRecords);
}

export function subscribeFlagReviewRecords(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reviewFlagAsManager(input: FlagReviewActionInput<ManagerFlagReviewAction>) {
  const remarks = input.remarks.trim();

  if (!remarks) {
    return { ok: false as const, error: 'Manager remarks are required.' };
  }

  if (input.workflowMode === 'manager_view_admin_approve') {
    return { ok: false as const, error: 'This workflow is visibility only for managers.' };
  }

  const records = listFlagReviewRecords();
  const record = records.find((item) => item.id === input.recordId);

  if (!record || record.managerDecisionStatus !== 'pending') {
    return { ok: false as const, error: 'Only flags pending manager action can be reviewed.' };
  }

  const now = new Date().toISOString();
  const nextDecisionStatus = getManagerDecisionStatus(input.action, input.workflowMode);
  const managerDecision: FlagReviewerDecision = {
    status: nextDecisionStatus,
    reviewerName: input.actorName,
    reviewedAt: now,
    remarks
  };
  const historyItem = createHistoryItem({
    actorName: input.actorName,
    actorRole: 'manager',
    actionLabel: getManagerActionLabel(input.action, input.workflowMode),
    decisionStatus: nextDecisionStatus,
    remarks,
    createdAt: now
  });

  writeRecords(records.map((item) => {
    if (item.id !== input.recordId) {
      return item;
    }

    return {
      ...item,
      status: input.workflowMode === 'manager_review_admin_observe' ? 'reviewed' : item.status,
      managerDecisionStatus: nextDecisionStatus,
      managerDecision,
      actionHistory: [historyItem, ...(item.actionHistory ?? [])]
    };
  }));

  return { ok: true as const };
}

export function reviewFlagAsAdmin(input: FlagReviewActionInput<AdminFlagReviewAction>) {
  const remarks = input.remarks.trim();

  if (!remarks) {
    return { ok: false as const, error: 'Admin remarks are required.' };
  }

  const records = listFlagReviewRecords();
  const record = records.find((item) => item.id === input.recordId);

  if (!record) {
    return { ok: false as const, error: 'Flag review record was not found.' };
  }

  if (
    input.workflowMode === 'manager_preapprove_admin_final' &&
    record.managerDecisionStatus === 'pending'
  ) {
    return { ok: false as const, error: 'Manager pre-approval is required before Admin action.' };
  }

  if (record.adminDecisionStatus !== 'pending') {
    return { ok: false as const, error: 'This flag already has an Admin decision.' };
  }

  const now = new Date().toISOString();
  const nextDecisionStatus = getAdminDecisionStatus(input.action);
  const adminDecision: FlagReviewerDecision = {
    status: nextDecisionStatus,
    reviewerName: input.actorName,
    reviewedAt: now,
    remarks
  };
  const historyItem = createHistoryItem({
    actorName: input.actorName,
    actorRole: 'admin',
    actionLabel: getAdminActionLabel(input.action),
    decisionStatus: nextDecisionStatus,
    remarks,
    createdAt: now
  });

  writeRecords(records.map((item) => {
    if (item.id !== input.recordId) {
      return item;
    }

    return {
      ...item,
      status: getNextFlagStatus(input.action),
      adminDecisionStatus: nextDecisionStatus,
      adminDecision,
      actionHistory: [historyItem, ...(item.actionHistory ?? [])]
    };
  }));

  return { ok: true as const };
}

function getManagerDecisionStatus(
  action: ManagerFlagReviewAction,
  workflowMode: FlagReviewWorkflowMode
): FlagReviewerDecisionStatus {
  if (action === 'reject') {
    return 'rejected';
  }

  if (workflowMode === 'manager_preapprove_admin_final') {
    return 'pre_approved';
  }

  return 'approved';
}

function getAdminDecisionStatus(action: AdminFlagReviewAction): FlagReviewerDecisionStatus {
  if (action === 'reject') {
    return 'rejected';
  }

  return 'approved';
}

function getNextFlagStatus(action: AdminFlagReviewAction) {
  if (action === 'resolve') {
    return 'resolved';
  }

  return 'reviewed';
}

function getManagerActionLabel(action: ManagerFlagReviewAction, workflowMode: FlagReviewWorkflowMode) {
  if (action === 'reject') {
    return workflowMode === 'manager_preapprove_admin_final' ? 'Recommended rejection' : 'Rejected flag';
  }

  return workflowMode === 'manager_preapprove_admin_final' ? 'Pre-approved flag' : 'Approved flag';
}

function getAdminActionLabel(action: AdminFlagReviewAction) {
  if (action === 'mark_reviewed') {
    return 'Marked admin reviewed';
  }

  if (action === 'approve') {
    return 'Approved flag';
  }

  if (action === 'reject') {
    return 'Rejected flag';
  }

  if (action === 'resolve') {
    return 'Marked resolved';
  }

  return 'Reviewed flag';
}

function createHistoryItem(input: Omit<FlagReviewActionHistoryItem, 'id'>): FlagReviewActionHistoryItem {
  return {
    id: crypto.randomUUID(),
    ...input
  };
}

function writeRecords(records: FlagReviewRecord[]) {
  window.localStorage.setItem(flagReviewRecordsStorageKey, JSON.stringify(records));
  emitChange();
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
