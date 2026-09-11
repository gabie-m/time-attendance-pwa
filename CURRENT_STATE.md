# Current State

**Last meaningful update:** 2026-09-11

## Current Workstream

`feature/role-foundation` is committed and pushed for pull-request review. It introduces fixed MVP roles (`employee`, `manager`, `hr`, `admin`), optional staff profiles for review-only accounts, and related mock/auth/route changes.

## Recently Completed On `main`

- Controlled attendance recorder, capture integration, and immutable event/flag persistence.
- Durable offline attendance outbox with ordered replay and acknowledgement handling.
- Employee-safe attendance history with a 30-day default and mock reset support.

## In Progress

- Role foundation implementation and migration work is present only in the current working tree; it has not been committed or merged.
- The role-security repair is implemented: active profiles are required at the database boundary, and raw sessions, events, flags, and reviews are Admin-only until restricted reviewer read APIs are built.
- Mock authentication now follows editable mock staff/profile data, and the mock staff service rejects empty employee IDs for profiles.
- Product Owner completed the focused mock-mode check. Admin attendance capture worked after an active staff profile and a permitted location assignment were present, as required by the capture authorization rules.

## Blockers And Risks

- The local Supabase reset completed successfully, the strict database suite passed 66/66 checks, and frontend tests (19/19), lint, build, and diff validation passed.
- A focused independent reviewer found no other P0/P1/P2 issue in its requested scope, but marked its gate red because its isolated environment could not execute the local Docker database. The lead environment completed that reset and suite successfully; retain this distinction in any merge review.
- Commit `45fbc02` is pushed to `origin/feature/role-foundation`; it has not yet been reviewed or merged as a pull request.
- The HR role exists in the proposed foundation, but its review UI/API and restricted evidence reader are deliberately not implemented yet.
- Documentation is partially stale: `docs/DEFERRED_ITEMS.md` still labels `attendance_events` and `attendance_flags` as not started even though merged migrations and recorder work exist. Reconcile this before the next substantive implementation session.
- Hosted Supabase has not been provisioned or changed. Local migration validation has occurred previously, but the current uncommitted migrations need a fresh confirmed validation run.

## Relevant Files

- `src/auth/AuthProvider.tsx`, `src/auth/permissions.ts`, `src/auth/types.ts`
- `src/screens/AdminScreen.tsx`, `src/services/mockStaffService.ts`
- `supabase/migrations/20260826110000_role_foundation.sql`
- `supabase/migrations/20260827113000_enforce_active_profiles_and_review_privacy.sql`
- `supabase/tests/controlled_attendance_recorder.sql`
- `HANDOVER.md`, `docs/business-rules.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/DEFERRED_ITEMS.md`

## Next Recommended Actions

1. Open and review the pull request for `feature/role-foundation`.
2. Reconcile deferred-item status against the merged migration and implementation history in the next documentation pass.
3. Build the restricted Manager/HR reviewer read APIs before connecting their real Supabase workflows.
