# Time & Attendance PWA - Handover

## 1. Project Overview

This project is a production-minded MVP for a Time & Attendance Monitoring System built as a mobile-first Progressive Web App. The current frontend stack is React 19, TypeScript, Vite, React Router, Dexie for local IndexedDB scaffolding, and vite-plugin-pwa. The app is still mock/frontend-first: no real backend, no Supabase connection, and no production database migrations yet. Current work has focused on validating the core product shape: role-based navigation, stationary and roving attendance capture flows, location/GPS warnings, manual edit requests, admin setup, reports, employee attendance details, and manager/admin flag review workflows.

## 2. Approved Architecture Summary

Frontend: React + TypeScript + Vite PWA with React Router. Mock services currently use localStorage and static files under `src/mocks/`; Dexie is present for IndexedDB offline queue scaffolding and must be used for real offline sync before backend integration.

Backend: planned Supabase/Postgres backend or equivalent Postgres API layer. Route guards in the frontend are UX only; real security must be enforced server-side by API authorization and role checks.

Database plan: Postgres tables for users, staff profiles, locations, assignments, sessions, attendance events, flags, manual edit requests, manual adjustments, refresh tokens, attendance rules, audit logs, and exports. Attendance events are immutable. Corrections create adjustment records.

Hosting plan: practical MVP hosting can use Vercel/Netlify for the frontend PWA and Supabase for Postgres/Auth/Storage. If backend becomes custom Node, host API separately and keep Postgres as the source of truth.

Auth approach: short-lived JWT access token, 15 minutes. Refresh token duration, 30 days. Add a revocable `refresh_tokens` table with token hashes. Refresh tokens are revoked on device de-registration and user deactivation. Offline events can be captured even if the access token is expired; sync must attempt token refresh before flushing the local queue.

Offline sync strategy: browser IndexedDB through Dexie. Offline attendance records capture action, local timestamp, GPS/location data, device information, and pending sync status. On sync, backend stores original local capture timestamp, official server receive/sync timestamp, and offline flag. iOS Safari does not support Background Sync API, so iOS sync happens only when the user opens the app with internet.

Development phases:
- Phase 1A, frontend shell and role-based attendance flows: substantially complete in mock form.
- Phase 1B, admin setup/location management: substantially complete in mock form.
- Phase 1C, manual edit request flow: substantially complete in mock form.
- Phase 1D, reports, attendance detail, and flag review workflows: in progress and mostly complete as static/mock UI.
- Phase 2, backend/schema/auth foundation: not started.
- Phase 3, attendance API and validation engine: not started.
- Phase 4, offline sync implementation: only IndexedDB queue scaffold exists; full sync not started.
- Phase 5+, notifications, exports, payroll-final reporting, security hardening, background jobs: deferred.

## 3. All Confirmed Business & System Rules

### Platform And PWA

- iOS is officially supported for MVP, with explicit limitations.
- iOS offline records sync only when the user reopens the app with internet.
- Offline sync UI must say: "Offline records sync when you reopen the app with internet."
- Do not imply automatic background sync on iOS.
- Home Screen install is recommended but not mandatory.
- Push notifications on iOS require iOS 16.4+ and Home Screen installation.
- Show persistent copy: "Add to Home Screen to enable push notifications."
- Google Maps Places address search is optional admin tooling. Manual latitude/longitude entry remains available when `VITE_GOOGLE_MAPS_API_KEY` is not configured.
- Hover/tap GPS map preview is desired later. Without a Google Maps API key, use a popover with coordinates, accuracy, and an "Open in Google Maps" link.

### Auth And Permissions

- Roles: `user`, `manager`, `admin`.
- Users can log in, capture attendance, view history, request manual edits, see assigned locations, see flags, and sync offline records.
- Users cannot directly edit attendance records, override timestamps, remove geolocation, or modify assigned locations.
- Managers can do user functions plus view assigned staff, see timed-in/out staff, review flags, review manual edit requests, approve/reject manual corrections, and export team reports when implemented.
- Admins manage users, managers, reporting structure, locations, assignments, schedules, temporary roving overrides, attendance rules, flags/approvals, and payroll-ready exports.
- Frontend route guards are UX only. APIs must reject unauthorized requests server-side.
- Access token duration: 15 minutes.
- Refresh token duration: 30 days.
- Refresh tokens must be revocable.
- Deactivated user records captured before deactivation timestamp are accepted and flagged for admin review.
- Deactivated user records captured after deactivation timestamp are rejected.

### Offline Policy

- No hard maximum offline capture window for MVP.
- Flag as `late_sync` warning if server receives an offline record more than 24 hours after local capture.
- Flag as `clock_discrepancy` high severity if delta between local capture and server receive time is greater than 30 minutes.
- Clock discrepancy does not block the attendance record.
- Suspicious offline records are admin-review only.
- Offline records should preserve original local timestamp and server sync timestamp.
- If access token is expired on sync, attempt refresh first; if refresh fails, prompt re-login.

### Attendance Rules

- Attendance is never blocked solely due to GPS/location validation. It is accepted and flagged.
- Every attendance action captures latitude, longitude, GPS accuracy, timestamp, and assigned/selected location comparison when browser GPS is available.
- GPS unavailable or outside allowed radius requires user confirmation and creates a flag.
- Stationary required MVP buttons: Time In, Lunch Out, Lunch In, Time Out.
- No Overtime button. Overtime is automatically calculated.
- Working time is Time In to Time Out, minus lunch deduction.
- Default lunch deduction: 60 minutes.
- Default overtime threshold: above 8 working hours.
- Passive GPS ping while stationary user is timed in: every 1.5 hours.
- If time between sequential attendance actions is shorter than 30 minutes, show a confirmation window before accepting.
- The short-gap confirmation applies to stationary punches and to the duration between roving Visit In and Visit Out.
- The short-gap confirmation does not apply to travel/waiting time between separate roving visits.
- Early lunch return: if Lunch In occurs with at least 30 minutes remaining in scheduled lunch window, create an `overtime_candidate` validation status and `early_lunch_return` flag.
- Early lunch return overtime candidate requires manager approval before payroll inclusion.
- No auto-expiry for early lunch return candidates in MVP.

### Sessions And Date Rules

- `work_date` is always determined by the date of Time In.
- Overnight shifts keep the `work_date` of the Time In event, even if Time Out occurs after midnight.
- One stationary session per user per work date.
- One open roving visit at a time per user.
- Duplicate stationary session API error text: "A session for this date already exists."
- Duplicate roving open visit API error text: "Close your current visit before starting a new one."

### Roving / Field Staff

- Roving staff use Add Attendance / visit flow instead of full-day punch sequence.
- Each visit/session requires selecting location, selecting purpose, Visit In, Visit Out.
- Roving attendance captures GPS only on attendance actions.
- No passive GPS tracking between roving visits.
- Travel gap between visits is derived from previous Visit Out to next Visit In.
- Travel time is paid but non-productive.
- Travel time is reported separately and excluded from visit hours and working hours totals.
- Stationary staff can receive temporary roving override for configured date ranges.

### Location Assignment

- Stationary staff may have one location, multiple allowed locations, rotating schedules, weekly patterns, and effective dates.
- Working at another approved location is accepted but flagged as location assignment conflict when it differs from expected location.
- Admin configures primary location, allowed locations, expected schedules, effective dates, and alternate location allowance.
- Approved locations store name, address, latitude, longitude, allowed radius, and active status.
- Recommended radius examples: store 150m, mall branch 250m, warehouse 400m.

### Manual Edit Requests

- Users cannot directly edit attendance records.
- Original attendance events are immutable and never edited/deleted.
- Corrections are submitted through manual edit requests.
- Manager approval creates a manual adjustment record and does not overwrite original attendance events.
- Request reason is required.
- Request correction field and new value are required.
- Request type is required.
- Allowed date range: today and past dates only.
- Maximum lookback window default: 30 days.
- Users cannot submit a correction request for a session that is still open.
- Session must be selected after date selection; do not rely on date alone because roving users can have multiple sessions per date.
- Request types: `missed_punch`, `incorrect_time`, `missed_visit`, `sync_issue`, `other`.
- Block duplicate pending request for same user/session/type with message: "You already have a pending correction request for this session."
- Users can cancel pending requests before manager action.
- Users can resubmit after rejection; original rejection remains visible.
- Manager approval and rejection both require remarks.
- Approved corrections cannot be reversed in MVP; admin handles disputes later.
- Real file upload is deferred.

### Flag Review Workflow

- Flag review workflow is an admin setting by flag type, not chosen during review.
- Configurable rule key: `flag_review_workflow_mode_by_flag_type`.
- Workflow modes:
  - `manager_review_admin_observe`: manager reviews and approves; admin sees flag and manager approval for audit/review visibility.
  - `manager_preapprove_admin_final`: manager pre-approves or recommends rejection; admin performs final approval/rejection.
  - `manager_view_admin_approve`: manager sees flag for awareness but cannot approve; admin is only approver.
- Manager Flag Review menu must show all flags visible to managers, including admin-approval flags where no manager action is required.
- For manager visibility/admin approval flags, manager sees "visibility only" and no approval action is required.
- Admin Flag Review shows only Admin-specific workflow/action. Manager workflow details belong in Manager Flag Review.
- For manager pre-approval/admin final approval flags, Admin must see manager pre-approval status, manager name, timestamp, and comments.
- If manager pre-approval is pending, Admin sees the flag but no Admin action can be done until manager pre-approval exists.
- Flag review remarks are required when manager/admin performs approval, rejection, resolution, or escalation.
- Original attendance records remain immutable regardless of flag review result.

### Exports

- This is not a payroll system.
- Operations exports include all records with visible flags/status.
- Payroll-final exports exclude sessions where `status = needs_review` unless explicitly overridden by admin.
- Stationary export values: regular hours, overtime, undertime, late minutes, lunch deduction, flagged attendance, manual adjustments.
- Field export values: total visit hours, hours per location, travel time between visits, productive hours, flagged visits.
- MVP export infrastructure is synchronous CSV as direct API response stream.
- Excel and PDF are deferred.
- Planned background job upgrade: pg-boss, Postgres-backed.

### Data Privacy

- GPS coordinates tied to people are PII.
- Precise GPS coordinates retained for 12 months.
- After expiry, null out latitude, longitude, and GPS accuracy while retaining validation status and flags.
- Attendance summaries and audit flags retained according to payroll/legal requirements.
- Location consent screen required before first attendance action.
- Consent text: "This app captures your location only when you submit an attendance action, and approximately every 1.5 hours while you are timed in."

### Configurable Rule Defaults

- `late_grace_minutes`: 5.
- `late_handling_mode`: `flag_only`. Options: `flag_only`, `flag_and_deduct`.
- `default_lunch_minutes`: 60.
- `early_lunch_return_threshold_minutes`: 30.
- `short_attendance_gap_confirmation_minutes`: 30.
- `overtime_threshold_hours`: 8.
- `travel_time_reporting_mode`: `paid_non_productive_separate`.
- `max_edit_request_days_back`: 30.
- `flag_review_workflow_mode_by_flag_type`: per flag type enum map.

Current mock default flag workflow settings:
- `outside_radius`: `manager_preapprove_admin_final`.
- `gps_low_accuracy`: `manager_review_admin_observe`.
- `offline_submission`: `manager_view_admin_approve`.
- `location_conflict`: `manager_preapprove_admin_final`.
- `missing_punch`: `manager_review_admin_observe`.

## 4. Schema Additions & Constraints Confirmed

### Tables

- `users`: core identity and role records.
- `staff_profiles`: one staff profile per user for employee code, staff type, default attendance model, timezone, shift label, active state.
- `locations`: approved work sites.
- `user_location_assignments`: user-location assignment records with type and effective dates.
- `manager_staff_assignments`: reporting relationship records with effective dates.
- `attendance_sessions`: stationary day sessions and roving visit sessions.
- `attendance_events`: immutable attendance actions.
- `attendance_flags`: flags linked to attendance events/sessions.
- `manual_edit_requests`: correction request lifecycle.
- `manual_adjustments`: approved correction records.
- `refresh_tokens`: revocable token records.
- `attendance_rules`: configurable rule store.
- `export_jobs`: planned, but MVP CSV can be direct synchronous response.
- `audit_logs`: required for sensitive actions in later backend phase.

### Column Additions

- `users.deactivated_at`: nullable timestamp.
- `users.location_consent_given_at`: nullable timestamp.
- `attendance_events.gps_expires_at`: not-null timestamp set to capture time plus 12 months.
- `attendance_events.client_event_id`: idempotency key from client.
- `attendance_flags.reviewed_by`: references users and must be admin for suspicious offline/admin-only flags.
- `export_jobs.scope`: supports `operations` and `payroll_final`.

### Constraints And Indexes

- `attendance_events`: unique `(user_id, client_event_id)`.
- `attendance_sessions`: partial unique index `(user_id, work_date)` where `session_type = 'stationary_day'`.
- Roving API must reject `visit_in` if an open roving session already exists for that user.
- Employee codes must be unique across staff profiles.
- Refresh token records store `token_hash`, not raw token.

### Enums / Valid Values

- Roles: `user`, `manager`, `admin`.
- Staff/attendance model: `stationary`, `roving`.
- Location assignment type: `primary`, `allowed`, `temporary`.
- Attendance event validation status: `normal`, `warning`, `flagged`, `needs_review`, `overtime_candidate`.
- Attendance flag types include: `outside_radius`, `gps_low_accuracy`, `offline_submission`, `location_conflict`, `missing_punch`, `deactivated_user_record`, `late_sync`, `clock_discrepancy`, `early_lunch_return`.
- Flag severity: `warning`, `high`.
- Flag status: `open`, `reviewed`, `resolved`.
- Manual request types: `missed_punch`, `incorrect_time`, `missed_visit`, `sync_issue`, `other`.
- Manual request status: `pending`, `approved`, `rejected`.
- Flag review workflow modes: `manager_review_admin_observe`, `manager_preapprove_admin_final`, `manager_view_admin_approve`.
- Flag reviewer decision status: `not_required`, `pending`, `approved`, `pre_approved`, `rejected`.

### Zod / Typed JSON Shapes

- `manual_adjustments.adjusted_payload` and manual request payloads must be validated as:

```ts
type CorrectionPayload = {
  field: string;
  old_value: unknown;
  new_value: unknown;
};
```

- Shape is `CorrectionPayload[]`.
- Do not store raw untyped JSON without validation.

## 5. Current Build Phase

Current phase: Phase 1D, frontend-only/mock UI for admin/manager review, reports, and audit workflows.

Completed in this phase:
- Admin Reports static mock with tabs for Attendance Summary, Late & Undertime, Absences, Overtime, Flagged Records, and Manual Edit Requests.
- Employee Attendance Detail page at `/admin/attendance/:employeeId`.
- Mock attendance detail data with recent days, flags, manual edit history, missing punches, clean days, and deactivated employee history.
- Mock data cleanup under `src/mocks/`.
- Admin Flag Review page at `/admin/flags`.
- Manager Flag Review page at `/manager/flags`.
- Mock Manager/Admin flag review actions that mutate localStorage-backed state and append action history.
- Admin setting page section for per-flag-type workflow configuration.
- Mock flag workflow settings service using localStorage.
- Admin/Manager role-specific workflow display.

Current phase scope and Codex instructions:
- Keep this frontend/mock-only until backend foundation starts.
- Do not connect to a real backend yet.
- Keep mock data shaped close to intended database schema.
- Services can use localStorage for current mock flows; Dexie is reserved for real offline sync queue and should replace localStorage where offline durability matters.
- No screen should define seed data inline; mock seed data belongs under `src/mocks/`.
- Settings and services should be framework-agnostic; React hooks belong under `src/hooks/`.
- Admin setting configuration belongs in Admin setup, not inside daily review flows.
- Review pages should show only role-relevant actions and workflow responsibilities.

Remaining in current phase:
- Add GPS coordinate hover/tap popover with Google Maps fallback link.
- Possibly add shared reusable flag review detail components to reduce duplication between Admin and Manager screens.
- Decide whether to add a dedicated Admin Settings route instead of keeping settings inside `/admin`.

## 6. Open Decisions & Known Gaps

- No real backend exists yet.
- No Supabase project is connected yet.
- No migrations exist yet.
- Mock auth is not secure; it is only a demo role switcher.
- `locationConsentGivenAt` exists in mock auth state for UI consent gate, while database-shaped `users.location_consent_given_at` is only documented for backend.
- Full offline sync is not implemented; only Dexie queue scaffolding exists.
- Background sync on iOS is unsupported; UX must continue to be explicit.
- Google Places address search is scaffolded but requires `VITE_GOOGLE_MAPS_API_KEY`.
- Embedded Google Map previews require an API key; fallback should use `https://www.google.com/maps?q=lat,lng`.
- File upload for manual edit requests is deferred.
- Real notifications are deferred.
- Excel/PDF exports are deferred.
- Manager assignment enforcement is not implemented in mock approval queues; mock may show all records.
- Payroll export calculations are not implemented.
- Security review checkpoints still needed at backend auth phase, offline sync phase, and final hardening.
- Data retention job for GPS expiry is not implemented.
- pg-boss/background job infrastructure is deferred.
- Need decide whether admins should have staff profile/default attendance model in production even if they do not perform attendance.
- Need decide exact backend route/API design and Supabase RLS policies before Phase 2.

## 7. Files Created or Modified

### Root And Docs

- `HANDOVER.md`: this handover file.
- `docs/business-rules.md`: source-of-truth rule document for current MVP decisions.
- `.env.example`: includes optional Google Maps API key placeholder.
- `package.json`: React/Vite/Dexie/PWA dependencies and scripts.
- `pet-runs/`: unrelated generated/local artifact directory present in working tree; do not rely on it for app behavior.

### App And Auth

- `src/app/App.tsx`: route definitions and protected route wrapper.
- `src/auth/MockAuthProvider.tsx`: mock auth provider and demo role switcher state.
- `src/auth/permissions.ts`: frontend route access rules by role/model.
- `src/auth/types.ts`: mock auth user type.
- `src/auth/useMockAuth.ts`: auth context hook.
- `src/mocks/mockAuthContext.ts`: React context object for mock auth.
- `src/mocks/mockUsers.ts`: mock demo users.
- Removed `src/auth/mockUsers.ts`: seed users moved to `src/mocks/mockUsers.ts`.
- Removed `src/auth/mockAuthContext.ts`: context moved to `src/mocks/mockAuthContext.ts`.

### Components

- `src/components/AppShell.tsx`: layout shell, sidebar/bottom nav, role switcher.
- `src/components/ConsentGate.tsx`: location consent screen.
- `src/components/GooglePlaceSearch.tsx`: optional Google Places UI with manual fallback.
- `src/components/Icon.tsx`: inline icon set.
- `src/components/LocationWarning.tsx`: GPS/outside-radius confirmation UI.
- `src/components/ManualEditRequestPanel.tsx`: user manual edit request form/list panel.
- `src/components/MetricCard.tsx`: metric card.
- `src/components/Pill.tsx`: status badge.
- `src/components/PlatformNotice.tsx`: iOS/offline/PWA install notice.
- `src/components/TimeGapWarning.tsx`: short attendance duration confirmation UI.

### Domain, Hooks, Utilities, Offline

- `src/domain/types.ts`: shared core domain types.
- `src/hooks/useStaffSetupRecords.ts`: React hook for staff setup service subscription.
- `src/hooks/useFlagReviewRecords.ts`: React hook for localStorage-backed flag review records/actions.
- `src/hooks/useFlagReviewWorkflowSettings.ts`: React hook for flag workflow settings subscription.
- `src/offline/offlineQueue.ts`: Dexie IndexedDB pending attendance event queue scaffold.
- `src/utils/geo.ts`: distance/GPS helper logic.
- `src/utils/flagReviewWorkflow.ts`: shared workflow labels/copy and formatting helpers.

### Mock Data

- `src/mocks/mockAttendanceDetailData.ts`: employee attendance detail mock data, flags, manual edit history, deactivated employee history.
- `src/mocks/mockFlagReviewData.ts`: flag review records, workflow modes/settings, manager/admin decision mock data.
- `src/mocks/mockLocations.ts`: mock location records.
- `src/mocks/mockManualEditData.ts`: manual edit request seed data and mock attendance sessions.
- `src/mocks/mockReportData.ts`: static report rows and manager dashboard rows.
- `src/mocks/mockStaffData.ts`: user, staff profile, manager assignment, and location assignment seed data.
- Removed `src/data/mockData.ts`: old mixed mock data file; consolidated into `src/mocks/`.
- Removed `src/data/`: folder deleted after cleanup.

### Screens

- `src/screens/LoginScreen.tsx`: mock login/demo user selection flow.
- `src/screens/StationaryScreen.tsx`: stationary attendance flow with GPS/location warnings and short-gap confirmation.
- `src/screens/RovingScreen.tsx`: roving visit flow with location capture and short visit confirmation.
- `src/screens/MyRequestsScreen.tsx`: user request list/history.
- `src/screens/ManagerScreen.tsx`: manager dashboard and manual edit approval queue.
- `src/screens/ManagerFlagReviewScreen.tsx`: manager-specific flag review queue and manager-only workflow actions.
- `src/screens/AdminScreen.tsx`: admin setup for users, assignments, locations, and attendance rule settings.
- `src/screens/AdminFlagReviewScreen.tsx`: admin-specific flag review queue and admin-only workflow actions.
- `src/screens/ReportsScreen.tsx`: static Admin Reports tabs and flagged record linkouts.
- `src/screens/AttendanceDetailScreen.tsx`: admin employee attendance detail page.

### Services

- `src/services/mockStaffService.ts`: mock user/staff/profile/assignment service.
- `src/services/mockLocationService.ts`: mock location service.
- `src/services/mockManualEditService.ts`: mock manual edit request/adjustment service.
- `src/services/mockFlagReviewService.ts`: mock Manager/Admin flag review action service with action history.
- `src/services/mockFlagReviewSettingsService.ts`: mock flag workflow settings service.
- `src/services/googlePlacesService.ts`: optional Google Places loader/mapper.

### Styles And Entry

- `src/styles.css`: application styling, responsive layout, admin/manager flag review UI.
- `src/main.tsx`: app entrypoint.

## 8. Resume Instructions

Resume from Phase 1D. The immediate next task should be either add the GPS coordinate hover/tap popover with Google Maps fallback link, reduce duplication between Admin/Manager flag review detail UI, or decide whether Admin settings should move to a dedicated route. Keep all work frontend/mock-only unless explicitly told to start backend Phase 2. Do not move workflow configuration back into review pages; it belongs in Admin settings. Preserve role separation: Manager screens show manager responsibility only, Admin screens show admin responsibility only. Continue running `npm run lint` and `npm run build` after changes.
