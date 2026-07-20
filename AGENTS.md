# Engineering Agent Guide

## Scope And Branches

- Work from `main` or a focused `feature/`, `fix/`, or `docs/` branch.
- Never commit directly to `ui/visual-cleanup`.
- Do not discard or revert work you did not create.
- Use one logical feature or fix per branch and commit.

## Specialist Routing

- Database, RLS, security, architecture, authentication, attendance integrity, and payroll reviews use `gpt-5.6-sol` with high reasoning.
- Standard React and TypeScript implementation or QA work uses `gpt-5.6-terra` with reasoning selected for task risk.
- Low-risk mechanical support may use `gpt-5.6-luna` with low reasoning; do not spawn an agent when direct work is simpler.
- High-risk implementation requires an independent reviewer who did not implement the work.

## Implementation And Review

- Read `HANDOVER.md`, `docs/ARCHITECTURE_DECISIONS.md`, and `docs/DEFERRED_ITEMS.md` before significant work.
- Implementation agents must self-review, run relevant validation, iterate on findings, document residual risks, and provide evidence of completion.
- Ari independently verifies requirements, business rules, architecture, security implications, integration, and validation evidence before recommending a merge.
- A reviewer does not approve its own implementation.
- When the implementation agent, independent reviewer, and Ari cannot agree on a review finding or its resolution, do not merge. Present the disagreement to the Product Owner with the competing options, supporting evidence, risks, and Ari's recommendation for a business or architecture decision.

## Completion Reporting

- Before a pull request is recommended, report what changed, why it was built that way, where it fits, validation evidence, review findings and resolutions, residual risks, and GREEN/YELLOW/RED status.
- For major milestones, include a concise learning note: what was built, why, where it fits, and one relevant technical concept.
