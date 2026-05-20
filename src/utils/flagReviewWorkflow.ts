import { flagReviewWorkflowOptions, type FlagReviewWorkflowMode } from '../mocks/mockFlagReviewData';

export function getWorkflowOption(workflowMode: FlagReviewWorkflowMode) {
  return flagReviewWorkflowOptions.find((option) => option.id === workflowMode) ?? flagReviewWorkflowOptions[0];
}

export function getWorkflowCopy(workflowMode: FlagReviewWorkflowMode) {
  if (workflowMode === 'manager_review_admin_observe') {
    return {
      managerTitle: 'Review and approve',
      managerDescription: 'Manager owns the approval decision. Admin reviews the flag and the manager decision for audit visibility.',
      managerActions: ['Approve Flag', 'Reject Flag'],
      adminTitle: 'Audit review only',
      adminDescription: 'Admin can see the flag and manager approval, but does not perform the approval step in this mode.',
      adminActions: ['Mark Admin Reviewed']
    };
  }

  if (workflowMode === 'manager_view_admin_approve') {
    return {
      managerTitle: 'Visibility only',
      managerDescription: 'Manager can see the flag for awareness, but cannot approve or reject it.',
      managerActions: ['Viewed Only'],
      adminTitle: 'Final approver',
      adminDescription: 'Admin is the only reviewer who can approve, reject, or resolve the flag.',
      adminActions: ['Approve Flag', 'Reject Flag', 'Mark Resolved']
    };
  }

  return {
    managerTitle: 'Pre-approve',
    managerDescription: 'Manager reviews first and submits a pre-approval or rejection recommendation.',
    managerActions: ['Pre-approve Flag', 'Recommend Reject'],
    adminTitle: 'Final approver',
    adminDescription: 'Admin reviews the manager pre-approval and performs the final approval decision.',
    adminActions: ['Final Approve', 'Final Reject', 'Mark Resolved']
  };
}

export function formatFlagType(flagType: string) {
  return flagType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function formatDecisionStatus(status: string) {
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
