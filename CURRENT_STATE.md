# Current State

**Last meaningful update:** 2026-09-22

## Current Workstream

`feature/flag-review-actions-real` is validated and ready for its focused commit. It adds the controlled Manager/HR/Admin attendance-flag action that works with the restricted reviewer queue.

## Recently Completed On `main`

- Controlled attendance recorder, capture integration, and immutable event/flag persistence.
- Durable offline attendance outbox with ordered replay and acknowledgement handling.
- Employee-safe attendance history with a 30-day default and mock reset support.
- Fixed MVP role foundation, including `employee`, `manager`, `hr`, and `admin`, active-profile enforcement, and Admin-only raw attendance evidence.

## In Progress

- The controlled flag-review action derives the actor from the authenticated account. Managers act only on their current direct/delegated team. HR and Admin share the final review stage and follow the existing per-flag workflow configuration.
- HR/Admin receive manager name, recommendation, remarks, and timestamp only when that context is necessary for a `manager_preapprove_admin_final` decision. Managers receive a neutral reviewed state only.
- The current branch intentionally does not wire the existing mock review screens to real data because their display contract is not review-safe. A later UI branch will use the restricted queue.

## Blockers And Risks

- Local reset, database lint, 23 flag-review action tests, 18 reviewer-queue tests, 66 controlled-recorder tests, 19 frontend tests, lint, and production build all pass. Independent review is green after two repair passes.
- No hosted Supabase project was changed.

## Relevant Files

- `supabase/migrations/20260918110000_controlled_flag_review_actions.sql`
- `supabase/tests/controlled_flag_review_actions.sql`
- `supabase/tests/controlled_attendance_recorder.sql`
- `HANDOVER.md`, `docs/business-rules.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/DEFERRED_ITEMS.md`

## Next Recommended Actions

1. Commit, push, and open a pull request for `feature/flag-review-actions-real`.
2. Build Manager/HR reviewer UI against the restricted queue, without granting raw-table reads.
3. Build the authorized, audit-logged attendance-photo evidence path before making photos available to reviewers.
