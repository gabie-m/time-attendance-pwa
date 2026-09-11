# AI Working Instructions

## Source Of Truth And Orientation

Before substantial work, read `PROJECT.md`, `CURRENT_STATE.md`, `DECISIONS.md`, `AGENTS.md`, and the relevant detailed documents. Inspect the actual repository state before assuming the handoff is current.

Project files and Git history are the source of truth. Do not rely on an AI conversation as the only record. When documentation and implementation disagree, identify the discrepancy rather than silently choosing one.

## Decisions And Requirements

- Do not change a confirmed requirement, scope boundary, architecture decision, or business policy without explicitly describing the proposed change and obtaining Product Owner approval when material.
- Treat learning questions and explanations as questions, not new requirements, unless the Product Owner explicitly confirms a decision.
- Clearly distinguish confirmed requirements, confirmed decisions, assumptions, recommendations, and open questions.
- Do not infer a decision from code alone. Mark unsupported conclusions as uncertain or needing confirmation.
- When recommending an architecture or material product decision, explain the alternatives, trade-offs, risks, and assumptions before treating it as confirmed.

## Engineering And Git

- Follow `AGENTS.md`, including branch discipline, specialist routing, review requirements, and validation standards.
- Inspect existing code and project conventions before proposing or making changes.
- Never discard uncommitted work you did not create. Confirm the branch and working tree before editing.
- Do not add secrets, credentials, or secret-bearing environment files to Git.
- Run appropriate tests and checks; never report completion without stating what was and was not verified.
- Preserve traceability: record significant requirements, decisions, risks, and changes in the relevant detailed document.

## Documentation Discipline

- Avoid duplicate documentation. Use `PROJECT.md` for durable orientation, `DECISIONS.md` for a compact decision register, and `CURRENT_STATE.md` for the live operational handoff.
- Keep detailed policies in `docs/business-rules.md`, architecture rationale in `docs/ARCHITECTURE_DECISIONS.md`, deferred work in `docs/DEFERRED_ITEMS.md`, and practical handoff detail in `HANDOVER.md`.
- Before ending a substantial session, update `CURRENT_STATE.md`; update `DECISIONS.md` for confirmed, changed, or superseded decisions; update `PROJECT.md` only when the durable project definition changes; and update relevant detailed documentation when the work changes it.

## Handoff Standard

Another AI must be able to continue by reading these files and inspecting the repository, without asking the Product Owner to reconstruct previous conversation history. Capture material discoveries, unresolved issues, validation evidence, and the next safe action in project files.

