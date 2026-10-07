# Preston partnership implementation

## Scope

Implement the partnership paradigm for the existing NeuralHub GoTA harness. The shared experience is replay review, not a newly invented human-controlled game mode. Existing policy files, league authorization, and conversation history remain intact. No production migration or hosted experiment is run as part of implementation.

## Method

For each stage: state the hypothesis, implement a bounded change, run behavioral tests (including disposable PostgreSQL for transaction boundaries), inspect failures, and record the result here before continuing. Integration tests use controlled fixtures; they do not establish live policy improvement.

## Ordered stages

1. **Research cycles and evidence** — durable partnership identity, cycles pinned to a baseline, attributable append-only events, contextual memory and semantic evidence links. Gate: ownership isolation, immutable events, idempotency, valid evidence, disagreement distinct from empirical support.
2. **Budget authority** — explicit human grants, atomic allocation of model-call and hosted-game allowances, reported-dollar accounting, expiry, pause, and release of unused allocations. Dollar totals remain estimates/partial unless provider accounting is complete. Gate: concurrent allocation cannot overspend, duplicate requests cannot charge twice, Preston cannot increase its own grant.
3. **Grounded voice review** — replay anchors captured at speech onset, voice/text moment marking, stale-anchor rejection, interruption and quiet controls. Gate: delayed transcription preserves the original moment; wrong-frame and stale messages cannot become evidence; stopping speech works.
4. **Between-visit research** — Preston proposes and prioritizes an experiment queue; the existing scheduler executes within the grant while the browser is closed. Worker briefs carry a snapshot of positions, evidence, and instructions. Gate: expiry/pause fence new work, recovery is idempotent, task results append receipts, failed/inconclusive tests do not promote policies.
5. **Evaluation and continuity** — evaluation records separate from proposals, explicit active-policy selection/rollback, cycle review, model-upgrade events, and a central research-cycle experience with evidence and allowance views. Gate: newest does not imply promoted, unmatched evaluation cannot prove improvement, budgets and memories survive model/session changes, desktop/mobile end-to-end checks.

## Experiment log

- Baseline inspection: existing durable task coordinator, claims and replay timestamps are reusable. Claims currently mutate a JSON record; task cost limits are retrospective and exclude infrastructure. Current voice is half-duplex spoken chat. Task proposal workers do not receive shared partnership memory. These are implementation gaps, not claimed completed capabilities.
- Stage 1 result: implemented cycle creation, stable partnership identity, immutable event history, claim snapshots, typed evidence links, and current-memory projection. Typecheck and model tests passed. Disposable PostgreSQL checks passed for ownership, event immutability, retry idempotency, evidence isolation, and existing claim updates. No production database was touched.
- Stage 2 result: implemented human allowance grants and expiry, atomic per-experiment reservations, idempotent starts, immutable reservation/result receipts, and unused-capacity release. Disposable PostgreSQL tests passed for exhaustion, duplicate calls, retained consumed capacity, pause, and no implicit promotion. Model-call/game allowances are hard bounds; USD is explicitly a reported-cost review threshold, not a guaranteed invoice cap.
- Stage 3 result: implemented speech-onset replay anchors, durable human moment receipts, manual replay marking, interruption and quiet-reply controls. Model tests passed for delayed transcripts, stale anchors, invalid viewer payloads, and cleared replay context; typecheck passed. This browser voice implementation supports explicit interruption, not a claimed full-duplex audio transport. Integrated browser checks follow after the research-cycle selector is connected.
- Stage 4 result: connected the prioritized experiment queue to the existing once-per-minute dispatcher, included partnership memory in durable worker briefs, fenced model/game operations on cycle authority, and added candidate branching with workspace-wide revision numbers. Disposable PostgreSQL execution checks and all 13 legacy task database checks passed. Pausing prevents subsequent operations; already-started external work may finish. Completion records evidence and releases unused capacity without promotion.

- Stage 5 result: implemented exact-version behavioral reviews, explicit selection/rollback, capped allowance transfer, model-change events, human contribution corrections, and the research workbench. Added a readable chat confirmation card for human authority. Desktop/mobile browser checks passed for cycle creation, allowance grants, proposal, pause/resume, review, selection, rollback, chat, voice controls and Escape.
- Integration feedback: the browser test caught an ambiguous candidate-select label; added an explicit accessible name. Lifecycle review found that a closed cycle could retain the student's task slot; dispatcher cleanup now cancels remaining work and releases unused reservations. An evaluation retry after selection was not idempotent; corrected the lookup order and added a regression assertion. Pending approval now exits the voice “thinking” state and points to the exact decision card.
- Baseline bootstrap check: added an unchanged-policy experiment mode under the same allowance. It skips proposal workers and policy saves, preserves the active revision, and reserves one idempotent hosted-game operation. The review selector now resets correctly after changing the active policy.
- Final gates: 76 automated tests passed with zero skips against disposable PostgreSQL, including a genuine two-connection race for one allowance, tenant/actor isolation, immutable history, idempotency, pause/expiry boundaries, active-policy lineage, and approval policy. The repeatable Playwright fixture passed. TypeScript, Next production build, and the Eve diagnostic build passed. All 16 migrations applied to a fresh disposable database; rerunning the migration command skipped applied files successfully.

## Boundaries and next experiment

This implements the five-stage foundation; it does not establish the product hypothesis. The next live
pilot should compare policy behavior under a fixed research allowance with and without human coaching,
using a separate matched evaluation protocol. Current human-reviewed hosted self-play cannot support
claims of competitive improvement or improvement per dollar.

- Background execution runs a prioritized proposed queue; it does not recursively invent new experiments after every result.
- Voice review is half-duplex and authority cards require an explicit click. Full-duplex interruption and speech-only approval remain separate work.
- Dollar accounting is partial/provider-reported; only model-call and hosted-game quantities are hard research bounds.
- The history is attributable and append-only, not sealed from database operators. Privacy/retention and export/exit need a product decision before any stronger promise.
- Production migrations and scheduler activation were not performed. No real policies were changed, uploaded or entered, and no hosted experiment funds were spent.
