# Time & Attendance Business Rules

This document is the source of truth for current MVP business rules. Keep it in sync with schema migrations, API behavior, frontend UX, and future stakeholder decisions.

## System Rules

These rules are enforced automatically and are not configurable.

- One stationary session is allowed per user per work date.
- One open roving visit is allowed per user at a time.
- `work_date` is always determined by the date of the Time In event.
- Precise GPS coordinates are nulled after 12 months. Validation status and audit flags remain.
- A location consent screen is required before the first attendance action.
- Offline records are accepted but flagged if received more than 24 hours after capture.
- A clock discrepancy greater than 30 minutes triggers an admin-review flag.
- iOS offline sync only occurs when the app is opened with an internet connection.
- Push notifications on iOS require iOS 16.4 or later and the app installed to the home screen.
- Deactivated user records are accepted if captured before the deactivation timestamp and flagged for admin review.
- Deactivated user records captured after the deactivation timestamp are rejected.
- Refresh tokens are revocable and must be revoked on device de-registration or user deactivation.
- Suspicious offline records are reviewed by admins only.
- Roving travel time is paid but non-productive, reported separately, and excluded from visit hours and working hours totals.
- Original attendance events are immutable. Corrections are stored as adjustment records.
- The frontend route guard is UX only. API authorization is the real permission boundary.
- Every stationary and roving attendance action captures browser GPS when available and compares it against the assigned or selected location radius.
- If the GPS distance is outside the allowed radius, or GPS is unavailable, the record is accepted only after user confirmation and is flagged for manager/admin review.
- If the time between sequential attendance actions is shorter than 30 minutes, show a confirmation window before accepting the action. This applies to stationary punches and to the duration between a roving visit Start Visit and End Visit. It does not apply to travel or waiting time between separate roving visits.
- Users cannot directly edit attendance records; only correction requests are allowed.
- Original attendance events are immutable and are never edited or deleted.
- Manager approval creates a manual adjustment record and does not overwrite original attendance events.
- Users cannot submit a correction request for a session that is still open.
- Users can cancel a pending correction request before a manager acts on it.
- Users can resubmit after a rejection; the original rejection record is preserved.
- Approved corrections cannot be reversed; admin handles disputes separately.
- Manager approval and rejection both require remarks.
- One pending request is allowed per user per session per request type at a time.
- New user setup requires all identity and staff profile fields before saving.
- Employee IDs must be unique across staff profiles; duplicate employee IDs are rejected.

## Configurable Rules

These rules are admin-adjustable through the `attendance_rules` table. They must not be hardcoded in backend business logic.

| Rule Key | Default | Type | Description |
|---|---:|---|---|
| `late_grace_minutes` | `5` | integer | Minutes after scheduled start before a late flag is created. |
| `late_handling_mode` | `flag_only` | enum | Options: `flag_only`, `flag_and_deduct`. Deduction applies only in payroll export logic, not event recording. |
| `default_lunch_minutes` | `60` | integer | Default unpaid lunch duration. May be overridden by `schedule_days.lunch_minutes`. |
| `early_lunch_return_threshold_minutes` | `30` | integer | If a user submits Lunch In with at least this many minutes remaining from the scheduled lunch window, the excess becomes an overtime candidate. |
| `short_attendance_gap_confirmation_minutes` | `30` | integer | Sequential attendance actions closer than this threshold require user confirmation. Applies to stationary punches and individual roving visit duration only; it does not apply between separate roving visits. |
| `overtime_threshold_hours` | `8` | integer | Working hours above this threshold become overtime candidates or overtime totals depending on approval state. |
| `travel_time_reporting_mode` | `paid_non_productive_separate` | enum | Travel gaps are paid but non-productive and always reported separately. |
| `max_edit_request_days_back` | `30` | integer | Maximum days back a user can submit a correction request. |
| `flag_review_workflow_mode_by_flag_type` | per flag type | enum map | Each flag type is assigned one workflow mode: `manager_review_admin_observe`, `manager_preapprove_admin_final`, or `manager_view_admin_approve`. |

## Flag Review Workflow Rules

- Flag review routing is configured per flag type through `flag_review_workflow_mode_by_flag_type`.
- A flag inherits its manager/admin approval workflow from its `flag_type`; reviewers do not choose the workflow during review.
- Example: if `gps_low_accuracy` is configured as `manager_review_admin_observe`, all low GPS accuracy flags require manager approval while admin only reviews the manager decision.
- `manager_review_admin_observe`: manager reviews and approves the flag; admin sees the flag and manager approval for audit review only.
- `manager_preapprove_admin_final`: manager reviews first and pre-approves or recommends rejection; admin performs final approval or rejection.
- `manager_view_admin_approve`: manager can see the flag for awareness but cannot approve; admin is the only approver.
- Flag review remarks are required when a manager or admin performs an approval, rejection, resolution, or escalation action.
- Original attendance records remain immutable regardless of flag review outcome.

## Platform And PWA Rules

- iOS is officially supported for MVP with explicit limitations.
- Offline sync UI must say: "Offline records sync when you reopen the app with internet."
- The app must never imply that iOS can perform automatic background sync.
- Home screen installation is recommended but not mandatory.
- Show persistent in-app copy: "Add to Home Screen to enable push notifications."
- Google Maps Places address search is optional admin setup tooling. Manual latitude/longitude entry must remain available as a fallback when `VITE_GOOGLE_MAPS_API_KEY` is not configured.

## Authentication And Session Rules

- Access token duration: 15 minutes.
- Refresh token duration: 30 days.
- Offline events may be captured when the access token is expired.
- Before flushing the IndexedDB queue, the sync flow must attempt token refresh.
- If token refresh fails, prompt the user to log in again.
- Add `refresh_tokens` table with `id`, `user_id`, `token_hash`, `device_id`, `expires_at`, `revoked_at`, and `created_at`.

## Offline Attendance Review Rules

- No hard maximum offline window for MVP.
- Create `late_sync` warning flag when `received_at_server - captured_at_local > 24 hours`.
- Create `clock_discrepancy` high-severity flag when the delta between local capture time and server receive time is greater than 30 minutes.
- Clock discrepancy flags do not block the record.
- Clock discrepancy flag detail must include the exact delta in minutes.
- Suspicious offline records can be cleared only by admins.

## Flag Review Decision Rules

- `Approve` means the reviewer accepts the flagged attendance exception for reporting or payroll-rule handling, while retaining the original immutable attendance record and flag history.
- `Reject` means the reviewer does not accept the flagged attendance exception or recommendation, and the flag remains part of the audit trail with rejection remarks.
- `Mark Resolved` means the reviewer closes the flag because the issue was addressed elsewhere, confirmed as informational, or no further approval decision is needed.
- `Mark Resolved` is not the same as `Approve`; it should not imply payroll inclusion unless the related attendance/session status is otherwise eligible.
- All flag review decisions require remarks.
- Original attendance records remain immutable regardless of flag review decision.

## Schema Requirements For Phase 2

- `users.deactivated_at`: nullable timestamp.
- `users.location_consent_given_at`: nullable timestamp.
- `refresh_tokens`: `id`, `user_id`, `token_hash`, `device_id`, `expires_at`, `revoked_at`, `created_at`.
- `attendance_rules`: `id`, `rule_key`, `rule_value`, `value_type`, `description`, `updated_by`, `updated_at`.
- `attendance_events.validation_status`: include `normal`, `warning`, `flagged`, `needs_review`, and `overtime_candidate`.
- `attendance_events.gps_expires_at`: not-null timestamp set to capture time plus 12 months.
- `attendance_events`: unique constraint on `(user_id, client_event_id)`.
- `attendance_sessions`: partial unique index on `(user_id, work_date)` where `session_type = 'stationary_day'`.
- `manual_adjustments.adjusted_payload`: validate with the typed shape `{ field: string, old_value: unknown, new_value: unknown }[]`.
- `attendance_flags.flag_type`: include `deactivated_user_record`, `late_sync`, `clock_discrepancy`, and `early_lunch_return`.

## Export Rules

- MVP export infrastructure is synchronous CSV generated as a direct API response stream.
- `pg-boss` is the planned upgrade path when Excel/PDF or large exports become slow.
- Operations exports include all records with a visible status/flag column.
- Payroll-final exports exclude sessions where `status = needs_review` unless explicitly overridden by an admin.
- Early lunch return overtime candidates remain excluded from payroll until resolved.
