# Time & Attendance PWA

## Purpose

Build a mobile-first Progressive Web App for recording, reviewing, and reporting time and attendance for stationary and roving staff in the Philippines. It supports accountable attendance capture in unreliable connectivity conditions without allowing changes to the original attendance evidence.

## Objectives And Scope

- Capture stationary punches and roving visits, including location and required photo evidence.
- Preserve offline attendance in a durable local outbox and safely replay it when connectivity returns.
- Keep attendance events immutable; corrections use manual-edit requests and adjustments.
- Support employee, manager, HR, and admin responsibilities with server-enforced access controls.
- Identify attendance conditions that need review and retain their audit history.
- Provide employee-safe attendance history and future operations/payroll reporting.

## Key Users

- Employees: stationary and roving staff who capture their own attendance.
- Managers: direct-team attendance and flag reviewers.
- HR: organization-wide review and final manual-adjustment responsibility; detailed workflow implementation is pending.
- Admins: setup, configuration, approvals, and privileged evidence access.

## Architecture

- Frontend: React, TypeScript, Vite, React Router, TanStack Query, and vite-plugin-pwa.
- Local development: mock mode with localStorage-backed mock services.
- Offline durability: Dexie/IndexedDB queue and cached verified attendance setup.
- Backend foundation: Supabase Auth, PostgreSQL, RLS, controlled database functions, and SQL migrations in `supabase/migrations/`.
- Security boundary: frontend guards are usability controls only; database policies and controlled functions enforce authorization and attendance integrity.

## Important Constraints

- `attendance_events` are immutable. Corrections never edit or delete them.
- The controlled recorder is the attendance write boundary; client-side location checks are evidence capture, not authoritative validation.
- All timestamps use timezone-aware formats; the backend time source is authoritative for MVP.
- The app must remain usable in mock mode without Supabase credentials.
- No secrets or `.env` files belong in Git.

## Detailed Sources Of Truth

- [Current operating handoff](HANDOVER.md)
- [Business rules](docs/business-rules.md)
- [Architecture decision log](docs/ARCHITECTURE_DECISIONS.md)
- [Deferred items and known gaps](docs/DEFERRED_ITEMS.md)
- [Engineering guidance](AGENTS.md)
- [Current cross-environment handoff](CURRENT_STATE.md)
- [Decision register](DECISIONS.md)

## Known Out Of Scope Or Deferred

- Configurable roles and permissions beyond the four fixed MVP roles.
- Hosted Supabase provisioning and deployment.
- HR review screens/RPCs and restricted reviewer evidence access.
- Async Excel/PDF/large exports, device management, advanced reporting, and final photo-retention confirmation.

