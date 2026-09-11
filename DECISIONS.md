# Decision Register

This is a compact register of durable project decisions. The detailed, authoritative rationale and implementation notes live in [docs/ARCHITECTURE_DECISIONS.md](docs/ARCHITECTURE_DECISIONS.md) and [docs/business-rules.md](docs/business-rules.md).

| ID | Date | Decision | Status | References |
|---|---|---|---|---|
| D-001 | Not documented | Supabase/PostgreSQL is the backend foundation; raw SQL migrations are the schema source of truth. | Confirmed | ADR-001 |
| D-002 | Not documented | Mock mode remains fully usable without Supabase credentials. | Confirmed | ADR-002 |
| D-003 | Not documented | Attendance events are immutable; corrections are append-only manual requests and adjustments. | Confirmed | ADR-023; business rules |
| D-004 | Not documented | Dexie/IndexedDB provides the durable offline outbox; replay is ordered, idempotent, and removes a payload only after exact acknowledgement. | Confirmed | ADR-009; HANDOVER.md |
| D-005 | Not documented | Supabase/PostgreSQL server time is the trusted time source for MVP; browser time is evidence. | Confirmed | ADR-004 |
| D-006 | Not documented | Attendance validation flags do not block capture; configured review workflow determines the follow-up. | Confirmed | ADR-013; business rules |
| D-007 | Not documented | Photos are private Supabase Storage objects accessed with signed URLs; retention is provisionally 12 months pending compliance confirmation. | Pending Confirmation | ADR-011, ADR-012 |
| D-008 | Not documented | The MVP uses fixed `employee`, `manager`, `hr`, and `admin` roles. Review-only non-employees may have no staff profile; an active profile enables own attendance capture. | Confirmed | ADR-025; business rules |
| D-009 | Not documented | Managers and HR receive derived GPS context only; exact coordinates/maps remain Admin-only. The authorized reviewer photo path is required but not implemented yet. | Confirmed policy; implementation pending | ADR-025; deferred G-19 |
| D-010 | Not documented | Manager action creates a proposed manual adjustment; HR/Admin gives final approval for reporting, and HR/Admin may directly decide a request. | Confirmed | business rules; HANDOVER.md |
| D-011 | Not documented | Employee attendance history defaults to the latest 30 calendar days and uses an employee-safe read model. | Confirmed | ADR-024 |

Do not treat implementation behavior as a confirmed decision unless it is supported by one of the referenced documents or explicit Product Owner approval.

