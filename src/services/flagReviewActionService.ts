import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import type { ServiceResult } from './serviceResult';
import { failure, success } from './serviceResult';

export type FlagReviewDecision = 'approved' | 'pre_approved' | 'rejected' | 'resolved';
export type FlagReviewStage = 'manager' | 'admin';

export type FlagReviewActionResult = {
  reviewId: string;
  flagId: string;
  stage: FlagReviewStage;
  decision: FlagReviewDecision;
  reviewedAt: string;
};

type FlagReviewActionRpc = {
  reviewId: unknown;
  flagId: unknown;
  stage: unknown;
  decision: unknown;
  reviewedAt: unknown;
};

const reviewDecisions = new Set<FlagReviewDecision>(['approved', 'pre_approved', 'rejected', 'resolved']);
const reviewStages = new Set<FlagReviewStage>(['manager', 'admin']);

/**
 * Sends an append-only flag review decision through the protected database RPC.
 * The database derives the actor and allowed workflow stage from the authenticated user.
 */
export async function submitFlagReviewAction(
  flagId: string,
  decision: FlagReviewDecision,
  remarks: string
): Promise<ServiceResult<FlagReviewActionResult>> {
  if (!isUuid(flagId) || !reviewDecisions.has(decision) || !hasVisibleRemark(remarks)) {
    return failure('Flag review requires a flag, decision, and remarks.');
  }

  if (isMockAuthMode()) {
    return failure('Flag review actions use mock data while mock authentication is enabled.');
  }

  if (!hasSupabaseConfig || !supabase) {
    return failure('Supabase environment variables are not configured.');
  }

  const { data, error } = await supabase.rpc('submit_attendance_flag_review', {
    p_attendance_flag_id: flagId,
    p_decision: decision,
    p_remarks: remarks.trim()
  });

  if (error || !isFlagReviewActionResult(data)) {
    return failure(getFlagReviewErrorMessage(error?.message));
  }

  return success(data);
}

function getFlagReviewErrorMessage(message?: string) {
  const knownMessages = [
    'An active reviewer account is required.',
    'Reviewer access is required.',
    'Flag review requires a flag, decision, and remarks.',
    'Manager flag review requires active review access to the affected staff member.',
    'Final flag review requires an active HR or Admin user.',
    'This workflow permits exactly one terminal manager decision and no final review row.',
    'This workflow requires exactly one manager recommendation before any final decision.',
    'This workflow permits exactly one final decision after one manager recommendation.',
    'Final review requires a manager pre-approval or rejection recommendation.',
    'This workflow permits exactly one final HR or Admin decision and no manager review row.'
  ];

  return knownMessages.find((knownMessage) => message?.includes(knownMessage))
    ?? 'Flag review could not be saved. Refresh the queue and try again.';
}

function isFlagReviewActionResult(value: unknown): value is FlagReviewActionResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as FlagReviewActionRpc;
  return typeof row.reviewId === 'string'
    && typeof row.flagId === 'string'
    && typeof row.reviewedAt === 'string'
    && reviewStages.has(row.stage as FlagReviewStage)
    && reviewDecisions.has(row.decision as FlagReviewDecision);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMockAuthMode() {
  return import.meta.env.VITE_USE_MOCK_AUTH === 'true';
}

function hasVisibleRemark(value: string) {
  return /[\p{L}\p{N}\p{P}\p{S}]/u.test(value);
}
