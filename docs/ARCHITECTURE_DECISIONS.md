# Architecture Decisions

**Project:** Time and Attendance PWA  
**Last Updated:** 2026-06-29  
**Maintained by:** Development agents and project owner

---

## How to use this document

This document records product and technical decisions that affect how the app behaves. It is intended to answer: "Why does the app work this way?"

Use this alongside:

- `docs/business-rules.md` for current MVP business rules and configurable rule defaults.
- `docs/DEFERRED_ITEMS.md` for deferred work, known gaps, and unresolved decisions.
- `HANDOVER.md` for current project state, branch context, and implementation notes.

When a decision changes, update this document and cross-check the business rules, schema migrations, mock services, and handover notes.

---

## Decision Statuses

- **Accepted:** Approved and should be implemented consistently.
- **Provisional:** Current direction, but still needs validation before final implementation.
- **Deferred:** Intentionally not decided or implemented for MVP.

---

## ADR-001: Supabase is the backend foundation

**Status:** Accepted

**Decision:** Use Supabase for PostgreSQL, Auth, and Storage. The frontend remains a React + TypeScript + Vite PWA.

**Rationale:** Supabase gives the project a managed PostgreSQL database, auth service, row-level security, and storage without requiring a custom backend for the MVP.

**Implementation Notes:**

- Raw SQL migrations are the source of truth for schema changes.
- Do not create or modify database tables manually through the Supabase dashboard.
- No ORM is currently planned.
- RLS, API authorization, and database constraints are the real security boundaries.

**Future Impact:** If a custom backend is added later, Supabase/Postgres remains the source of truth.

---

## ADR-002: Mock mode remains a first-class local development path

**Status:** Accepted

**Decision:** The app must work fully in mock mode when `VITE_USE_MOCK_AUTH=true`, even when Supabase credentials are absent.

**Rationale:** The frontend and UX flows are still being built while schema and backend work continue in parallel. Mock mode keeps development unblocked.

**Implementation Notes:**

- Real Supabase auth is lazy loaded through `AppAuthProvider`.
- Supabase must not initialize in mock mode without credentials.
- Mock data belongs under `src/mocks/`, not inline in screens or services.
- `useAuth` is the shared hook used by screens.
- `useMockAuth` remains available but should not be used by application screens after the shared auth migration.

**Future Impact:** Replace `MockUser` with a production `AuthUser` once the final database shape is merged.

---

## ADR-003: Frontend route guards are UX only

**Status:** Accepted

**Decision:** Frontend route guards improve navigation and user experience, but server-side authorization is mandatory.

**Rationale:** Client-side checks can be bypassed. Role and permission enforcement must happen through API authorization, Supabase RLS, and server-side role checks.

**Implementation Notes:**

- Route guards must not be loosened for UI testing convenience.
- Managers can access only their assigned staff records.
- Admins can access cross-user administrative views.
- Users can access only their own records unless explicitly permitted by role.

**Future Impact:** Backend and RLS review is required before production use.

---

## ADR-004: Attendance events are immutable

**Status:** Accepted

**Decision:** `attendance_events` rows are append-only. No update or delete path is allowed, including for admins.

**Rationale:** Attendance records are audit-sensitive. Corrections must preserve the original event history.

**Implementation Notes:**

- Corrections go through `manual_edit_requests` and `manual_adjustments`.
- Manager approval creates adjustment records and does not overwrite original events.
- RLS, privilege revocation, and database triggers should enforce immutability.
- Original event records remain visible in audit history.

**Future Impact:** All reporting and payroll calculations must account for adjustments rather than expecting edited source events.

---

## ADR-005: Trusted time source is server time, not browser or NTP

**Status:** Accepted

**Decision:** Supabase/PostgreSQL server time is the authoritative time source for MVP. The browser-provided timestamp is captured as evidence, not authority.

**Rationale:** Browsers cannot directly query NTP servers, and device clocks can be inaccurate or manipulated. The backend/database clock gives a consistent receive-time reference.

**Implementation Notes:**

- Store `captured_at_local` when the user submits the attendance action.
- Store `received_at_server` when the backend/database receives the event.
- Compare device-reported capture time to trusted server time using `clock_discrepancy_threshold_minutes`.
- The seeded MVP default for `clock_discrepancy_threshold_minutes` is 5 minutes.
- Clock discrepancy creates a high-severity flag but does not block the record.
- Clock discrepancy flag detail should include the exact delta in minutes.
- Do not create a clock-discrepancy flag solely because an offline record was received later than it was captured. Expected offline queue delay is handled by `offline_submission` and `late_sync`.

**Future Impact:** If an independent time authority is required later, implement it server-side. Do not make the browser responsible for NTP checks.

---

## ADR-006: Attendance rules are admin-configurable in MVP

**Status:** Accepted

**Decision:** Core attendance calculation values come from `attendance_rules`, not hardcoded frontend or backend constants.

**Rationale:** Attendance policy values may change by client or operational need. Making them database-driven avoids code changes for rule tuning.

**Seeded MVP Defaults:**

| Rule Key | Default Value |
|---|---:|
| `late_grace_minutes` | `0` |
| `clock_discrepancy_threshold_minutes` | `5` |
| `photo_time_mismatch_threshold_minutes` | `5` |
| `lunch_deduction_minutes` | `60` |
| `overtime_threshold_minutes` | `480` |

**Implementation Notes:**

- Active rules are date-scoped using `effective_from` and `effective_to`.
- The frontend attendance-rules service caches rules for 5 minutes.
- Mock mode uses approved fallback values without calling Supabase.

**Future Impact:** Per-staff-type or per-location rule scope is deferred. If added later, rule precedence must be explicitly designed.

---

## ADR-007: Work dates are based on Time In

**Status:** Accepted

**Decision:** `work_date` is determined by the date of the Time In event.

**Rationale:** This keeps overnight shifts and daily attendance grouping predictable.

**Implementation Notes:**

- Overnight shifts keep the `work_date` of the Time In event even if Time Out occurs after midnight.
- `work_date` uses the `date` type in the database, not `timestamptz`.
- One stationary session is allowed per user per work date.

**Future Impact:** Payroll and reports must use session work date rather than blindly grouping by event calendar date.

---

## ADR-008: Offline sync uses Dexie and explicit iOS limitations

**Status:** Accepted

**Decision:** Offline attendance records must use IndexedDB through Dexie. iOS sync occurs only when the app is reopened with internet.

**Rationale:** IndexedDB is more durable than localStorage for offline queues. iOS Safari does not support reliable background sync for this use case.

**Implementation Notes:**

- Offline records preserve local capture time, GPS/location data, device information, and pending sync status.
- Before flushing the queue, the app attempts token refresh.
- If refresh fails, the user must log in again.
- UI copy must say: "Offline records sync when you reopen the app with internet."
- Do not imply automatic background sync on iOS.

**Future Impact:** Phase 4 offline sync must migrate remaining localStorage-like behavior to Dexie where durability matters.

---

## ADR-009: GPS validation is server-side; client GPS is capture only

**Status:** Accepted

**Decision:** The client captures GPS, but validation and final trust decisions happen server-side.

**Rationale:** Client GPS can be missing, inaccurate, spoofed, or stale. Server-side validation gives consistent flagging and audit behavior.

**Implementation Notes:**

- Attendance is accepted and flagged when GPS is unavailable or outside radius after user confirmation.
- GPS validation should not silently block a user from recording an attendance event.
- Precise GPS coordinates are PII.
- Precise GPS coordinates are retained for 12 months, then latitude, longitude, and GPS accuracy are nulled.
- Validation status and audit flags remain after GPS coordinates expire.

**Future Impact:** A retention job is required before production.

---

## ADR-010: Photo capture is required only for specific attendance actions

**Status:** Accepted

**Decision:** Photo capture is required for Time In, Time Out, Visit In, and Visit Out. It is not required for Lunch Out or Lunch In.

**Rationale:** Photos support identity verification for primary attendance boundaries while avoiding unnecessary friction for lunch actions.

**Implementation Notes:**

- Camera-only capture is preferred.
- Gallery upload is allowed only if EXIF metadata extraction is supported and reviewed.
- `photo_time_mismatch_threshold_minutes` defaults to 5 minutes.
- Photo verification and facial recognition are Post-MVP.

**Future Impact:** Any future facial recognition feature must remain separate from basic photo capture and should receive a privacy/security review.

---

## ADR-011: Attendance photos use private Supabase Storage

**Status:** Accepted

**Decision:** Store attendance photos in a private Supabase Storage bucket and serve them through signed URLs only.

**Recommended Bucket:** `attendance-photos`

**Recommended Object Path:**

```text
users/{user_id}/{work_date}/{session_id}/{client_event_id}.jpg
```

**Rationale:** Attendance photos are sensitive personal data. They should not be publicly accessible, and paths must work before a database event ID exists.

**Implementation Notes:**

- Use `client_event_id` in the object path because offline capture may occur before the database creates an event ID.
- Store the private storage object path in the database.
- Generate short-lived signed URLs only for authorized viewers.
- Avoid storing permanent public URLs.
- If the schema uses `attendance_events.photo_url`, define it as a private storage object path. Prefer `photo_path` if the schema can still be adjusted before merge.

**Future Impact:** Storage RLS/policies and signed URL access need review before photo upload is implemented.

---

## ADR-012: Photo retention is 12 months by default, pending compliance review

**Status:** Provisional

**Decision:** Retain attendance photos for 12 months by default, then delete the stored object while keeping attendance event metadata, audit history, and verification status.

**Rationale:** Photos are more sensitive than ordinary attendance metadata. The 12-month default aligns with the current precise GPS retention period.

**Implementation Notes:**

- This needs confirmation against client policy, payroll requirements, and applicable Philippine privacy/legal requirements.
- Do not retain punch photos indefinitely by default.

**Future Impact:** Final retention policy should be decided before production photo storage or Phase 7 reporting/export work.

---

## ADR-013: Flag review workflows are configured by flag type

**Status:** Accepted

**Decision:** Flag review workflow is configured per `flag_type`; reviewers do not choose the workflow during review.

**Rationale:** Review routing should be consistent and auditable.

**Workflow Modes:**

- `manager_review_admin_observe`: manager reviews and approves; admin sees the outcome for visibility.
- `manager_preapprove_admin_final`: manager pre-approves or recommends rejection; admin makes the final decision.
- `manager_view_admin_approve`: manager can view for awareness; admin is the only approver.

**Implementation Notes:**

- Manager visibility-only flags show no approval action.
- Admin cannot take final action on manager-preapproval flags until manager pre-approval exists.
- Approval, rejection, resolution, and escalation actions require remarks.
- `Mark Resolved` is not the same as `Approve`.

**Future Impact:** Workflow settings should live in Admin settings, not inside daily review screens.

---

## ADR-014: Roving travel time is paid but non-productive

**Status:** Accepted

**Decision:** Travel time between roving visits is paid but reported separately as non-productive time.

**Rationale:** Roving staff travel is legitimate work time, but it should not inflate location visit hours or productive hours.

**Implementation Notes:**

- Travel gap is derived from previous Visit Out to next Visit In.
- Travel time is excluded from visit hours and working-hours totals.
- No passive GPS tracking occurs between roving visits.

**Future Impact:** Payroll and operations exports must expose travel time separately.

---

## ADR-015: MVP exports are synchronous CSV streams

**Status:** Accepted

**Decision:** MVP exports are generated synchronously as CSV direct API response streams. Excel, PDF, and large asynchronous exports are deferred.

**Rationale:** CSV is sufficient for MVP reporting and avoids introducing background job infrastructure too early.

**Implementation Notes:**

- Operations exports include all records with visible status/flag columns.
- Payroll-final exports exclude sessions where `status = needs_review` unless explicitly overridden by an admin.
- Early lunch return overtime candidates remain excluded from payroll until resolved.
- `pg-boss` is the planned future background job system.

**Future Impact:** When async exports are introduced, use a private export storage bucket, signed URLs, and automatic expiry.

---

## ADR-016: Async export files will use private storage when built

**Status:** Provisional

**Decision:** When Excel/PDF/large exports are implemented, store generated files in a private Supabase Storage bucket and expose downloads through signed URLs.

**Recommended Bucket:** `exports`

**Recommended Object Path:**

```text
{scope}/{requested_by}/{yyyy-mm}/{export_job_id}.{ext}
```

**Rationale:** Export files may contain payroll-sensitive and employee-sensitive data. They should not be public or permanent by default.

**Implementation Notes:**

- Store the private object path in `export_jobs.file_url` or rename the column to `file_path` if schema timing allows.
- Signed download URLs should be short-lived.
- Default file deletion window should be 7 days unless stakeholder policy requires longer.

**Future Impact:** Finalize this before Phase 7 export jobs.

---

## ADR-017: Supabase Auth owns credentials

**Status:** Accepted

**Decision:** Supabase Auth owns credential management. The application `users` table must not store password hashes.

**Rationale:** Password storage should be handled by the authentication provider, not duplicated in application tables.

**Implementation Notes:**

- Application `users` records map to Supabase auth identities.
- Real invite emails and password reset flows are deferred.
- Refresh token records store token hashes, not raw tokens.
- Refresh tokens must be revoked on device de-registration or user deactivation.

**Future Impact:** Single-device enforcement requires device registration and refresh-token revocation behavior.

---

## ADR-018: Location consent is required before first attendance action

**Status:** Accepted

**Decision:** Users must see and accept a location consent screen before submitting their first attendance action.

**Rationale:** Location data tied to people is sensitive PII and requires explicit user awareness.

**Consent Text:**

> This app captures your location only when you submit an attendance action, and approximately every 1.5 hours while you are timed in.

**Implementation Notes:**

- Current mock state uses `locationConsentGivenAt`.
- Production schema currently documents `users.location_consent_given_at`.
- A future `user_consents` table may be considered if consent history/versioning is required.

**Future Impact:** Consent storage should be revisited during real auth/profile completion.

---

## ADR-019: Google Maps integration is optional

**Status:** Accepted

**Decision:** Google Maps Places search and embedded map previews are optional admin tooling.

**Rationale:** Location setup must still work when no Google Maps API key is configured.

**Implementation Notes:**

- Manual latitude/longitude entry must remain available.
- `VITE_GOOGLE_MAPS_API_KEY` enables optional Places search.
- Without an API key, map preview fallback should use coordinates, GPS accuracy, and an "Open in Google Maps" link.

**Future Impact:** Do not make Google Maps a hard dependency for attendance capture or admin location setup.

---

## ADR-020: Staff category defaults are suggestions, not hard locks

**Status:** Accepted

**Decision:** `staff_categories.default_staff_type` suggests a default value, but admins may override staff type per user.

**Rationale:** Real staffing assignments may not always match category defaults.

**Implementation Notes:**

- Employee IDs must be unique across staff profiles.
- New user setup requires all identity and staff profile fields before saving.

**Future Impact:** Staff category management UI should preserve admin override behavior.

---

## ADR-021: Deactivated-user attendance handling preserves auditability

**Status:** Accepted

**Decision:** Records captured before user deactivation are accepted and flagged. Records captured after deactivation are rejected.

**Rationale:** Offline records may legitimately have been captured before the account was deactivated. The system should preserve valid historical records while blocking post-deactivation activity.

**Implementation Notes:**

- Accepted pre-deactivation records should create a `deactivated_user_record` admin-review flag.
- Post-deactivation records should be rejected by backend validation.

**Future Impact:** Sync logic must compare captured time to `users.deactivated_at`.

---

## ADR-022: `client_event_id` uniqueness is per user

**Status:** Accepted

**Decision:** Attendance event idempotency uses a composite unique constraint on `(user_id, client_event_id)`.

**Rationale:** Client-generated IDs prevent duplicate offline submissions while avoiding accidental global collisions across users/devices.

**Implementation Notes:**

- Do not make `client_event_id` globally unique by itself.
- Offline sync should retry safely when a previous submission already succeeded.

**Future Impact:** API responses should handle duplicate client event IDs as idempotent conflict cases rather than creating duplicate records.

---

## Deferred Decisions Still Tracked Elsewhere

These remain in `docs/DEFERRED_ITEMS.md` because they are not final implementation decisions yet:

- Per-staff-type or per-location attendance-rule scope.
- Final photo retention policy after compliance review.
- Final async export storage expiration and bucket policy before Phase 7.
- Full reporting hierarchy beyond one-level manager assignments.
- Photo verification and facial recognition.
- Single-device enforcement.
