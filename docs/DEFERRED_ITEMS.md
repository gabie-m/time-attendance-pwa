# Deferred Items, Known Gaps & Future Decisions
**Project:** Time and Attendance PWA
**Last Updated:** 2026-06-15
**Maintained by:** Claude (Development Consultant)

---

## How to use this document

This document tracks three categories:
- **Deferred Features** — scoped and decided, just not built yet
- **Known Gaps** — identified limitations in the current build that need addressing later
- **Open Decisions** — items that need a decision before they can be built

Update this document whenever a deferred item is built, a gap is resolved, or a decision is made.

---

## Deferred Features

### Authentication & Access
| # | Item | Notes | Priority |
|---|------|-------|----------|
| D-01 | Single device enforcement | Prevents users from being logged in on multiple devices simultaneously. Devices table has `is_primary` flag ready. | Post-MVP |
| D-02 | Password reset flow | Real email-based password reset via Supabase Auth. | Post-MVP |
| D-03 | Real invite emails | Sending actual onboarding emails to new staff. | Post-MVP |

### Attendance Features
| # | Item | Notes | Priority |
|---|------|-------|----------|
| D-04 | Roving overrides UI | Admin UI for temporarily giving stationary staff roving access. Table exists in schema. Service layer stub to be built in `feature/session-integrity`. | Phase 6 |
| D-05 | Temporary roving overrides | Full workflow for admin to assign and manage overrides. | Phase 6 |
| D-06 | Multi-location schedules | Assigning staff to multiple locations with scheduled rotation. | Post-MVP |
| D-07 | Passive GPS pings | GPS ping every 1.5 hours while timed in for stationary staff. Approved architecture includes `gps_ping` event type. | Post-MVP |
| D-08 | Full reporting hierarchy engine | Manager-to-staff reporting chains beyond simple one-level assignment. | Post-MVP |

### Admin Features
| # | Item | Notes | Priority |
|---|------|-------|----------|
| D-09 | Export functionality | CSV, XLSX, PDF exports. `export_jobs` table exists in schema. UI placeholder already built. | Phase 7 |
| D-10 | Attendance rules UI | Admin screen for viewing and updating configurable attendance rules. Backend table exists. | Phase 6 |
| D-11 | Staff categories management UI | Admin screen for adding and managing job categories. Table exists in schema with seed data. | Phase 6 (feature/staff-categories) |
| D-12 | Device management UI | Admin screen showing registered devices per user, primary device flag, suspicious device flags. | Post-MVP |
| D-13 | Admin manual edit oversight | Admin view of all correction requests and disputes across all managers. | Phase 5 (after manager workflows) |

### Manager Features
| # | Item | Notes | Priority |
|---|------|-------|----------|
| D-14 | Manager approval flow | Manager approve/reject attendance correction requests. Needed before admin oversight. | Phase 5 |
| D-15 | Manager level reports | Team daily status, flagged records, pending corrections. UI mockup done, real data pending. | Phase 5 |

### Payroll & Reporting
| # | Item | Notes | Priority |
|---|------|-------|----------|
| D-16 | Payroll computation summary | Per employee attendance summary for payroll processing. | Phase 7 |
| D-17 | Raw attendance events export | Full audit export of all events in CSV or XLSX. | Phase 7 |
| D-18 | Offline submission audit report | Report specifically for offline-submitted events with review status. | Phase 7 |

### Security & Anti-fraud
| # | Item | Notes | Priority |
|---|------|-------|----------|
| D-19 | Photo verification | Future facial recognition or manual photo verification workflow. `photo_verified` column exists on `attendance_events`. | Post-MVP |
| D-20 | Facial recognition at punch | Automated identity verification using punch photo. | Post-MVP |

---

## Known Gaps

### Database
| # | Gap | Where | Notes |
|---|-----|-------|-------|
| G-01 | Self-service profile updates | `users` table RLS | No UPDATE policy for users editing their own name or email. Currently admin-controlled only. Needs proper approval workflow when built. |
| G-02 | Manager visibility of inactive staff categories | `staff_categories` RLS | Managers cannot see inactive categories when reviewing historical staff profiles that reference them. Minor edge case. |
| G-03 | Manager SELECT policy on users and staff_profiles tables | `users` and `staff_profiles` RLS | `manager_staff_assignments` now exists on `feature/supabase-schema`; confirm these policies during schema review before merge. |
| G-04 | Auth consent model | `users` table | `locationConsentGivenAt` is currently a UI-only mock field on MockUser. Needs a proper home — likely `user_consents` table or field on `staff_profiles` — when real auth is implemented. |
| G-05 | attendance_rules scope | `attendance_rules` table | Currently global rules only. Future consideration: per-location or per-staff-type rules if clients need different configurations. |

### Frontend
| # | Gap | Where | Notes |
|---|-----|-------|-------|
| G-06 | localStorage vs Dexie | `offlineQueue.ts` | Currently scaffolded with local IndexedDB. Must migrate to Dexie before Phase 4 offline sync is built. |
| G-07 | `ConsentGate.tsx` | `src/components/` | Uses `locationConsentGivenAt` from MockUser. Needs revisiting when real consent model is built. |
| G-08 | `googlePlacesService.ts` | `src/services/` | Optional scaffold only. Runs if `VITE_GOOGLE_MAPS_API_KEY` is configured. No hard dependency. Needs proper scoping before backend phase. |
| G-09 | `MockUser` type still used as auth user type | `src/auth/AuthContext.ts` | Should be replaced with a proper `AuthUser` type once the database schema is complete and all fields are confirmed. |
| G-10 | `expectedLocation` hardcoded as empty string | `src/auth/AuthProvider.tsx` | Placeholder in `fetchAuthenticatedUserProfile`. Needs to pull from `user_location_assignments` once that table is wired to the frontend. |
| G-11 | `users` array in real auth provider | `src/auth/AuthProvider.tsx` | Leftover mock pattern. Real auth provider only needs the single authenticated `user`. Clean up after auth is stable. |
| G-12 | `giveLocationConsent` in real auth provider | `src/auth/AuthProvider.tsx` | Present but will be revisited when proper consent model is built. No immediate impact. |
| G-13 | `useMockAuth` still exists | `src/auth/` | Not deleted, just unused after `useAuth` migration. Clean up after `feature/supabase-auth` is stable. |

### Architecture
| # | Gap | Where | Notes |
|---|-----|-------|-------|
| G-15 | No open session constraint enforced in frontend | Attendance capture screens | Backend will reject duplicate stationary sessions but frontend should also disable the action with a clear message. |

---

## Resolved Items

| # | Item | Resolution |
|---|------|------------|
| G-14 | Attendance engine reads hardcoded values | Resolved by `feature/attendance-rules-engine`, merged to `main` in PR #4. Active rules are date-scoped, cached for five minutes, and have approved mock-mode fallbacks. The existing stationary lunch deduction calculation now reads from the rules service. |
| G-16 | Attendance-rule default documentation mismatch | Resolved on 2026-06-15. Seeded defaults are late grace `0`, clock discrepancy `5`, photo time mismatch `5`, lunch deduction `60`, and overtime threshold `480` minutes. All are admin-configurable in the MVP. |

---

## Open Decisions

| # | Decision Needed | Context | Status |
|---|----------------|---------|--------|
| O-01 | `attendance_rules` per-staff-type scope | Currently global only. If a client needs different overtime rules for roving vs stationary staff, schema needs a scope column. | Defer to post-MVP |
| O-02 | NTP server selection | Which trusted time server to use for clock discrepancy detection. Needs to be reliable in Philippine network conditions. | Decide before `feature/attendance-integrity` |
| O-03 | Supabase Storage bucket structure | How to organize photo storage — by user, by date, by session? Affects photo URL format stored in `attendance_events.photo_url`. | Decide before `feature/attendance-integrity` |
| O-04 | Photo retention policy | How long are punch photos kept? Storage costs grow over time. | Decide before Phase 7 |
| O-05 | Export file storage | Where do generated export files live? Supabase Storage bucket needed for `export_jobs.file_url`. | Decide before Phase 7 |

---

## Ari's Pending Branches

| Branch | Status | Depends On |
|--------|--------|------------|
| `feature/supabase-auth` | ✅ Merged to main | — |
| `feature/attendance-rules-engine` | ✅ Merged to main | `feature/supabase-auth` merged ✅ |
| `feature/attendance-integrity` | ⏳ Not started | `feature/attendance-rules-engine` merged ✅ |
| `feature/session-integrity` | ⏳ Not started | `feature/supabase-auth` merged ✅ |
| `feature/staff-categories` | ⏳ Not started | `feature/supabase-auth` merged ✅ |
| `feature/device-registration` | ⏳ Not started | `feature/supabase-auth` merged ✅ |

---

## Mira's Migration Progress

| Table | Status |
|-------|--------|
| `attendance_rules` | ✅ Approved |
| `users` | ✅ Approved |
| `staff_categories` | ✅ Approved |
| `staff_profiles` | ✅ Approved |
| `manager_staff_assignments` | 🔄 Implemented on `feature/supabase-schema`, pending merge/review |
| `locations` | 🔄 Implemented on `feature/supabase-schema`, pending merge/review |
| `user_location_assignments` | 🔄 Implemented on `feature/supabase-schema`, pending merge/review |
| `schedules` | 🔄 Implemented on `feature/supabase-schema`, pending merge/review |
| `schedule_days` | 🔄 Implemented on `feature/supabase-schema`, pending merge/review |
| `attendance_sessions` | 🔄 Implemented on `feature/supabase-schema`, pending merge/review |
| `attendance_events` | ⏳ Not started |
| `attendance_flags` | ⏳ Not started |
| `manual_edit_requests` | ⏳ Not started |
| `manual_adjustments` | ⏳ Not started |
| `audit_logs` | ⏳ Not started |
| `devices` | ⏳ Not started |
| `export_jobs` | ⏳ Not started |
| `roving_overrides` | ⏳ Not started |

---

## Architecture Notes to Carry Forward

| # | Note |
|---|------|
| N-01 | `attendance_events` is immutable — no UPDATE or DELETE ever, enforced by RLS, privilege revocation, and trigger |
| N-02 | All timestamps use `timestamptz` — never plain `timestamp` |
| N-03 | `work_date` uses `date` type not `timestamptz` |
| N-04 | All schema changes through migration files only — never through Supabase dashboard UI |
| N-05 | `client_event_id` uniqueness is composite on `(user_id, client_event_id)` — not globally unique |
| N-06 | Corrections are append-only through `manual_edit_requests` and `manual_adjustments` — original events never touched |
| N-07 | GPS validation is server-side — client GPS is capture only, never authoritative |
| N-08 | Role guards enforced at router level — not just UI conditionals |
| N-09 | All mock data lives under `src/mocks/` — never inline in components or services |
| N-10 | `staff_categories.default_staff_type` suggests only — admin can override per user |
| N-11 | Photo capture required on Time In, Time Out, Visit In, Visit Out — not on Lunch Out or Lunch In |
| N-12 | Camera-only photo capture preferred — gallery allowed only with EXIF metadata extraction |
| N-13 | Clock discrepancy flag suppressed for offline events — gap between captured_at_local and received_at_server is expected when offline |
| N-14 | Offline queue must use Dexie — not raw IndexedDB |
| N-15 | Supabase Auth owns all credential management — no password_hash in users table |
| N-16 | Real Supabase provider is lazy loaded via AppAuthProvider — never initialized in mock mode |
| N-17 | Auth provider does not handle redirects — routing logic belongs in ProtectedRoute only |
