# GoTA workspace and active Preston — proposed design

Status: initial implementation shipped locally. Scope: Gods of the Arena only; chat and live voice share the typed presentation tool.

## Product contract

The human owns the workspace navigation. Preston owns a presentation area beside chat. Both participants inspect the same policies, experiments, and evidence, with independent selections and filters. A chat answer can change Preston's presentation without changing the human's tab, replay position, editor selection, or scroll position.

Preston is the persistent companion and research orchestrator. It chooses questions, starts autoresearch sessions, delegates work, runs experiments, evaluates results, selects promising development policies, and decides what to try next without requiring a human response at each step. It decides when to continue, change direction, or stop. The human can participate, redirect, disagree, or pause at any time; absence of a human response does not block ordinary research.

The user-facing experience is ongoing work with meaningful updates. Evidence, hypotheses and evaluations remain inspectable internal research structures, not a mandatory human approval funnel.

## Five primary tabs

| Tab | Question | Default content | Drill-downs |
| --- | --- | --- | --- |
| Performance | How are we doing? | Current entered policy, league rank and score, win/loss/time-limit record, sample size and reporting window | Rank history, version comparison, opponent filters, league rounds and replays |
| Strategy | What does this policy do, and why? | Selected policy's situation → decision → action structure | Source-linked components, supporting and contradicting replay moments, beliefs, disagreements, candidate changes |
| Experiments | What are we trying next? | Compact table of experiments, baseline/policy revisions, execution status and evidence links | Baseline and candidate revisions, test conditions, worker progress, results, evidence and decision |
| Episodes | What happened in play? | League rounds and sortable practice-game tables | Replay viewer, match statistics, annotations and coaching |
| Development | What is underneath? | Policy source and version history | Diffs, game reference, knowledge index, source mappings, execution receipts and diagnostics |

Performance is the normal landing tab. With no uploaded policy, show a compact start state that opens Strategy and starts the first-policy workflow. The tabs remain available before data exists.

Remove Overview as a catch-all. Episodes is the dedicated home for league rounds, practice games and replays. Performance and experiment evidence links open the relevant replay there. Understanding's hypotheses, lessons and disagreements become linked objects surfaced in Strategy and Experiments; Development provides their full index.

Do not introduce a separate Beliefs or Components tab yet. Components belong to Strategy; source and dependency details belong to Development. Avoid maintaining multiple versions of the same belief across tabs.

## Layout and navigation ownership

Desktop: stable human workbench on the left; Preston on the right, with its existing avatar/status, a presentation area, and chat. Use a user-resizable divider. The presentation expands within Preston's allocated space; it does not resize or navigate the human pane on its own. Dense presentations can be opened explicitly in the main workspace.

The presentation header identifies its subject and scope, for example “Last 10 league rounds · r12”. Actions:

- Open in workspace: copy this view's route and filters into the human pane.
- Pin: retain this presentation while the conversation continues.
- Back: revisit the previous presentation.
- Follow Preston: optional, explicit mode for synchronized human navigation. Manual navigation exits follow mode immediately.

When a pinned presentation receives an update, show a small “New view” affordance rather than replacing it. Background work updates the experiment table and a curated briefing without opening the human pane. Preston chooses which findings to surface based on significance, the current conversation, and the human's interests. Routine worker events stay in the activity history.

At narrow widths, chat and Preston's presentation switch within the companion panel. The human workspace retains its state while hidden. Screen sharing and cursor control stay optional; showing first-party workspace data does not require a screen-sharing grant.

## View contract

Replace ordinary agent-driven DOM navigation with a typed presentation tool. Example:

```json
{
  "view": "performance",
  "policyVersionId": "policy-version-id",
  "filters": { "source": "league", "last": 10, "opponentPolicyVersionId": "opponent-version-id" },
  "selection": { "episodeId": "episode-id" },
  "highlight": "outcomes",
  "reason": "These are the rounds behind the result I am describing."
}
```

This is a proposed contract, not an existing callable tool. Validate view-specific fields, user ownership/access, allowed highlights and filters. Return a browser acknowledgement distinguishing displayed, queued behind a pin, unavailable, and rejected. A view command never saves code, starts a test, changes the active policy, or enters the league.

Share one route/selection model between tabs, presentation templates and evidence links, but keep human and Preston view state independent. Bind commands to a conversation turn and sequence so late results cannot replace a newer answer. Persist useful presentation descriptors and evidence references; fetch their data with freshness labels. Persist historical snapshots when the user needs an immutable account of what was shown.

Provide the model structured current context: selected revision, active/entered policy, viewed evidence, filters and draft/recording state. Distinguish viewing context, human instructions, and standing research settings. Simply looking at a policy neither directs Preston to modify it nor stops its current investigation. Do not send tokens or arbitrary screen contents for ordinary navigation.

Initial templates: performance summary, version comparison, replay moment, strategy branch, experiment detail and evidence comparison. Reuse those components inside the human tabs. HTML generation is deferred until a question cannot be answered with the standard templates. Any future generated view must be isolated, have explicit data bindings, and remain separate from executable policy or privileged app actions.

## Evidence and shared understanding

An important empirical claim links to evidence and a useful next action. An untested hypothesis is allowed to lack supporting evidence but must say so and specify a test that could support or refute it. Do not manufacture evidence to satisfy the UI.

Use the representation that answers the question:

- Performance difference: comparison table or time series with sample size and scope.
- Policy decision: situation/action branch tied to the exact source revision.
- Behavior claim: replay moment with observation and interpretation separated.
- Experiment planning: compact table with status and evidence links; expand a row for investigation context.
- Disagreement: human and Preston positions beside the shared evidence and the proposed discriminating test.

Distinguish game facts, observations, hypotheses, and working agreements. Facts have a source and game/version date. Opponent observations identify the opponent policy version and observed episodes. Confidence labels represent evidence quality, not invented numeric certainty. Agreement does not establish truth, and generated strategy explanations are not executed traces unless instrumentation verifies them.

## Experiments and policy identity

A question or hypothesis has multiple experiments. Each experiment pins its baseline, candidate (if any), game/league context, test conditions, success criterion, stop condition, budget, author, and evidence. A completed game is a run; it is not by itself a conclusion.

Current policy means the active development policy. Show the league-entered policy separately when it differs. Selection of a new active policy by either participant does not retroactively change an experiment's baseline. Preston can rebase or retest its pending candidates automatically, recording the decision. Work on isolated candidates and atomically advance the active development policy only if its parent remains current; preserve human drafts and competing changes rather than silently overwriting them. Keep the previously selected version available for rollback. Resolved experiments can be supported, contradicted or inconclusive. Execution failure is a separate state.

Existing research cycles and plans provide the starting model. Add an explicit hypothesis link for grouping multiple experiments, and persist test context sufficient for meaningful comparisons. Keep experiment table state separate from research findings and from worker execution status. Evaluating is Preston doing analysis, not a queue awaiting human approval. Preston can conclude an experiment and select a development candidate itself. Its evaluation is attributed to Preston; it must never be recorded as human review or human agreement.

## Autonomous companion and research orchestrator

Preston owns a durable research agenda across conversations. An autoresearch session is an investigation with a purpose, baseline, resource allocation, workers, evidence, current direction and stopping condition. It survives closed tabs and chat changes. The human does not need to create each session or provide each next step.

Preston can independently:

- Notice a weakness, uncertainty, opponent pattern, or promising improvement and start an investigation.
- Choose and revise hypotheses, prioritize investigations, and retire questions that are no longer useful.
- Spawn parallel analysis or candidate workers with isolated versions; coordinate dependencies and shared resources.
- Edit and upload candidate policies, run hosted tests, inspect results and replays, and arrange follow-up experiments.
- Assess its own evidence, reject candidates, select or roll back the active development policy, and continue researching.
- Update its beliefs and methods while preserving the human's independently owned position.
- Explain a useful discovery even when it does not improve competitive performance.

These are decisions Preston makes and records, not a fixed sequence of forms that the human must approve. A chat request is one input into its agenda; experiment outcomes and new information can also initiate work.

### Standing operating settings

Research uses a workspace-level resource envelope shared across sessions and workers. Preston allocates that envelope itself; there is no new grant dialog for every investigation. Keep research enabled/paused, resource limits, current usage, and priority controls in account/workspace settings with a compact status indicator. Do not invent a numeric spend allowance as part of this design or confuse reported model cost with a hard billing cap.

Preston cannot evade the envelope by starting another session, retrying, or spawning more workers. When capacity is exhausted, it parks affected work and communicates that once. Human pause and stop instructions persist; scheduled events cannot restart stopped work. League entry remains a separate externally visible operation under the existing explicit-entry rule; autonomous selection here refers to the development policy.

### Continuing without busywork

Events enter an idempotent inbox and wake the orchestrator, which chooses whether further work is worthwhile. Sources include new hosted results, new league rounds, meaningful performance changes, a user direction, contradictory evidence, and available capacity. Use cooldowns, novelty checks, finite experiment allocations, and diminishing-return stopping criteria. Being autonomous includes deciding that another test would not be useful.

Start with hosted-result events and an initial agenda evaluation when research becomes active. Idle cadence can reconsider unresolved questions, but must not manufacture experiments simply to remain busy. Track live tasks and dispositions so repeated polling or delivered events cannot duplicate a session or test.

### What Preston brings to the human

- Progress worth knowing: a selected candidate, an observed regression, a changed explanation, or a completed investigation.
- Something worth learning: a clear replay moment, a surprising comparison, or a strategy explanation related to the human's interests.
- A disagreement worth discussing: Preston's position, the human's recorded position, evidence, and what Preston is doing to resolve the uncertainty.
- A genuine need for direction: conflicting human goals, an inaccessible dependency, or a resource limit that prevents continuing.

Most updates are nonblocking. Use a short briefing and a selected presentation with direct evidence links. Deduplicate similar findings and combine routine progress. An unavailable optional metric or an inconclusive result generally leads to a revised test or conclusion, not a human approval request.

The human can say “show me why”, “try this instead”, “stop this line of research”, or “tell me more about positioning”. Store explicit interests and corrections; inferred interests remain tentative and editable. Offer More like this / Less like this on useful updates. Do not suppress important regressions just because the human prefers success stories.

### Example experience

Preston notices a recurring retreat pattern, opens a research session, compares candidate changes, and selects one for the next development baseline when the evidence supports that choice. It can continue another branch while the human is away.

On return, the human sees: “I tested two retreat changes. One reduced isolated retreats in the evaluated games; I selected it as the development policy. Here is the clearest before/after moment. League improvement is still unverified.” This is illustrative copy, not a report of an actual run.

Preston chooses a replay comparison for its presentation. The human can inspect, reverse the selection, disagree, redirect research, or keep working. No acknowledgement is required for the next investigation to proceed within the standing settings.

## Existing foundations and missing work

Already present in source: league results and replays, revision/source mappings, claims with independent stances, research cycles and allowances, queued durable tasks, evidence references, and a permission-gated screen tool. This describes code availability, not confirmed production deployment or live policy improvement.

Missing: independent presentation state, typed presentation commands and receipts, shared view descriptors, an autoresearch-session board, precise test-context comparison, and automatic event-to-investigation orchestration. The existing dispatcher starts previously proposed work; it does not yet own an evolving research agenda. Current cycle creation and policy selection are gated through a human-approval tool, so autonomous orchestration needs new actor-aware operations rather than merely deleting approval flags. Standing workspace allocations must replace per-cycle human grant requirements without losing atomic accounting. Rank trends require real historical snapshots; current leaderboard data must not be drawn as invented history. Existing self-play results cannot establish competitive improvement against other policies.

## Implementation order and acceptance

1. Establish standing research settings and actor-aware autonomous operations: create sessions, allocate existing capacity, record Preston evaluations, select/rollback development policies, and respect stop instructions. Gate: ordinary research never waits for a human click; Preston cannot write a human approval or stance, overwrite a human draft, or overspend by creating more sessions.
2. Add the persistent orchestrator and event inbox. Gate: a session starts, tests, evaluates, chooses a follow-up or concludes, and resumes after interruption with the browser closed; duplicate events do not duplicate work, and pause stops new dispatch.
3. Extract reusable GoTA views and introduce independent human/presentation state, then reorganize into five tabs. Gate: existing operations remain reachable; Preston does not change the human's tab, scroll, draft or replay position; stale commands and pins behave predictably.
4. Connect typed presentations and curated briefings to chat and research events. Gate: Preston shows a grounded result on its own initiative, makes uncertainty explicit, and respects interests and quiet presentation preferences without hiding regressions.
5. Build the research-session/experiment table over the orchestrator. Gate: hypotheses with multiple experiments retain pinned baselines, worker progress, actor attribution, immutable evidence and findings; evaluation is autonomous and intervention optional.
6. Add trustworthy historical performance and deeper strategy instrumentation where needed. Keep full-duplex voice and free-form HTML out of this first release.

Pilot measure: does Preston make useful independent progress and help the human understand it? Track investigations started and concluded without prompts, decisions reversed, grounded versus corrected claims, useful versus dismissed updates, duplicate work, resource use and time to insight. Measure competitive policy improvement separately with a comparable evaluation protocol. Do not optimize for number of experiments or notification volume.


## Implemented in this iteration

- Five primary tabs; Performance is the landing view. Tab panels remain mounted so filters, selections and replay state survive tab changes.
- Source-linked Strategy decision flow; Development retains the full source/IR inspector, versions, shared hypotheses, disagreements and game references.
- A compact experiment table shows real plans, workers and hosted tests without duplicate test rows; selecting a plan opens its research question, baseline revisions, evaluations and results. A single research direction queues work within standing settings; no per-test approval form.
- Independent Preston pane with `present_view`, current-turn tokens, Back, Pin (saved per account in local browser storage), pending views, Open in workspace, and optional Follow. Manual workspace interaction exits Follow. Chat tool results render without parking a conversation for UI approval; the next client context reports displayed/queued/rejected. Live tools receive the browser receipt directly.
- Reusable performance summary and strategy templates. Structured descriptors and revision ownership checks; no generated HTML or arbitrary URLs/scripts. Human view context is sent separately from agent selection.
- Performance exposes recent outcome sequence, opponent/window filters, current leaderboard and version comparison. These are loaded-sample outcomes and a current 72-hour leaderboard, not fabricated historical rank data.

Remaining extensions: persistent historical rank snapshots, a richer opponent selector, embedded replay presentations and timestamp linking in Preston's pane, and saved presentation snapshots shared across devices. Current replay inspection lives in Episodes; pins preserve descriptors and fetch fresh data rather than freezing historical evidence.
