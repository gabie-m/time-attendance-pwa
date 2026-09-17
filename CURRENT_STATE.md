# Current State

**Last meaningful update:** 2026-09-16

## Current Workstream

`feature/reviewer-read-models` is committed locally and awaiting final independent security re-check before it is pushed for pull-request review. It adds the restricted Manager/HR/Admin reviewer queue and corrects delegation scope enforcement.

## Recently Completed On `main`

- Controlled attendance recorder, capture integration, and immutable event/flag persistence.
- Durable offline attendance outbox with ordered replay and acknowledgement handling.
- Employee-safe attendance history with a 30-day default and mock reset support.
- Fixed MVP role foundation, including `employee`, `manager`, `hr`, and `admin`, active-profile enforcement, and Admin-only raw attendance evidence.

## In Progress

- Commit `d2c7662` on `feature/reviewer-read-models` adds a review-safe queue for Manager, HR, and Admin without granting raw-table access.
- Manager scope is evaluated from current assignments/delegation at access time. HR and Admin are organization-wide. Session-level flags are included even without an attendance event.

## Blockers And Risks

- Local Supabase reset passes with the current migration. Reviewer queue tests pass 16/16 and the existing controlled attendance suite passes 66/66. Lint and production build pass.
- Independent review found two P1 issues (inactive role fail-open and UTC date scope). Both are repaired and covered by regression tests. A final re-check identified a deterministic timezone-test improvement, which is being applied before push.
- No hosted Supabase project was changed.

## Relevant Files

- `supabase/migrations/20260915113000_reviewer_flag_queue.sql`
- `supabase/tests/reviewer_flag_queue.sql`
- `supabase/tests/controlled_attendance_recorder.sql`
- `HANDOVER.md`, `docs/business-rules.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/DEFERRED_ITEMS.md`

## Next Recommended Actions

1. Re-run the final independent security review, then push and open a pull request for `feature/reviewer-read-models`.
2. Build Manager/HR reviewer actions and UI against the restricted queue, without granting raw-table reads.
3. Build the authorized, audit-logged attendance-photo evidence path before making photos available to reviewers.
