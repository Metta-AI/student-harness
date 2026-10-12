# Always-on harness: what the lecture asks for, what we have, what to do next

Written 2026-10-12 after reading the CS146S lecture transcript on Grokbot, the
repository design docs, the implementation status ledger and the installed Eve
0.68 documentation. Companion to `preston-companion-harness.md` (the design) and
`companion-implementation-status.md` (the ledger). This document is a direction
check, not a new design.

## The lecture in one page

The lecture describes one small loop and a short list of things around it.

| Building block | What it means | Our equivalent today |
| --- | --- | --- |
| Agent loop on a server, not the laptop | Thin client, thick server; the client has one tool, `send_to_user`; the server owns everything else | Eve agent under `agent/`, mounted in Next at `/eve/v1`. Runs on Vercel in production (older build) and on the laptop in development. |
| Durable workflow, not a job queue | A crash resumes at the last completed step; side effects still need idempotency keys | Eve sessions are Vercel Workflow runs; tasks have checkpoints, leases, generations and advance receipts; SQL journals for policy builds. Temporal is the lecture's tool, Workflow is ours. |
| Separate "computer" that sleeps | Firecracker VM, snapshot and restore, started only when needed, independent of the agent loop | Vercel Sandbox per session with snapshot; persistent VMs for the research terminal, browser and desktop, behind flags. |
| Wake-ups beyond typing | Messages, Slack, email, meetings, routines, finished background work; a router that dedupes and decides whether to bother the user | Companion responsibilities with interval, daily, moment, result and webhook triggers; quiet hours; a result inbox; a minute cron that dispatches tasks, research wakes and campaigns. |
| Helpers with fresh context | Subagents run as their own durable workflows and return results, not logs | Six declared subagents, each a durable child session; investigator progress tools. |
| Memory in layers | Core facts in every prompt, dated logs, scratch notes, everything else in files the model greps | Partnership memory slot, bounded context service, learning studies, lessons and disagreements, workspace files. |
| Skills and routines | Procedures written down and reused; cron-style prompts | Learned procedures with human activation; schedules; sandbox skills. |
| Context engineering | Stable prompt prefix, tool names only until needed, long output to files, compaction done while the cache is warm | Compaction at 80 percent; cache telemetry; dynamic connection tools. About sixty root tools are always in context. |
| Auto-review and approval | A model reviews risky commands; irreversible actions go to a human; untrusted input is data | Human approval on league entry, grants, submissions, computers; external text treated as evidence; no model auto-review yet. |
| Evals flywheel | Every failure becomes an eval; harness fixes and new models are measured against it | Fixture-based runtime tests, eight calibration cases, no production replay. |

The lecture's principles matter more than its parts: build as little as
possible, keep the main conversation sparse, make silence a valid outcome, and
assume today's model is the worst it will ever be, so prefer a thin harness that
the next model can use better.

## Verdict

**The design is right. The deployment is not.**

The existing design doc already maps the lecture faithfully, and in places more
carefully than the lecture itself, for example on idempotency, on authorization
being separate from memory, and on silence being an explicit decision. Eve
provides a native primitive for almost every building block: durable sessions,
`turnPolicy`, `defineSchedule`, `defineMemory`, `defineDynamic`, declared
subagents, `approval`, skills, sandboxes and evals. Supabase as the source of
truth and Vercel Sandbox as the sleeping computer match the lecture's split
between server state and rebuildable machines. Temporal is not needed as a second
durable engine; the one Temporal namespace in metta owns platform league rounds
and should stay out of this.

What is wrong is that nothing is actually always on. Every server-side piece the
lecture describes currently runs on one laptop: `next dev`, `eve dev`, the
development dispatcher and the policy-worker supervisor. The hosted production
deployment is from October 8. The companion build exists only as a protected
preview that cannot attach production sessions. Of 57 untracked migrations, most
are unapplied to the primary database. The worker image was qualified and then
discarded. Closing the laptop stops Preston, which is the exact failure the
lecture opens with.

A second concern is breadth. The tree has 737 changed files, 567 of them
untracked, and about eighty evidence directories. Most capability rows in the
ledger read "qualified locally with fixtures; hosted rollout open". The lecture's
"delete the product" principle argues for the opposite shape: a thin vertical
slice that really runs unattended, then capabilities added one at a time behind
flags, each with a hosted acceptance check. Untracked work is also one disk
failure away from loss.

## What to add, in order

The order matters. Items 1 to 3 are the always-on property itself. Items 4 to 8
are the lecture's harness refinements and are cheap once 1 to 3 exist.

1. **Snapshot the tree.** Commit the current working tree to a branch so that
   both agents and the user share one reviewable baseline. This is the user's
   call; nothing below should start from an uncommitted tree.
2. **Make production the companion.** Apply the pending migrations to primary in
   the reviewed order the status ledger already specifies, deploy the companion
   build to the existing Vercel project with its minute and daily crons, set
   `PRESTON_RUNTIME_OWNER` and `PRESTON_RUNTIME_URL`, and route
   `ide.softmax.com` per `ide-deployment.md`. Codex owns this.
3. **Host the policy workers off the laptop.** One named Vercel Sandbox runs
   the unchanged supervisor from a pinned commit, kept alive by a cron in the
   separate `student-harness-worker-host` project; see
   `deploy/vercel-worker-host/README.md`. Deployed, disabled until a scoped
   Vercel token is set and the laptop supervisor is drained. Claude Code owns
   this.
4. **Acceptance demo for always-on.** The design doc's first demonstration: mark
   a replay moment, authorize a bounded investigation, close the laptop, let the
   hosted cron and worker finish, reopen, see the result attached to that moment
   with no duplicate experiment and no unsolicited submission. Turn it into a
   repeatable `test:runtime:*` fixture with virtual time. Until this passes
   against production, do not add new capability surface.
5. **Tool discovery.** Move rarely used tool groups (container pipeline, cloud
   browser and desktop, research administration) behind `defineDynamic`
   resolvers keyed on the active league adapter and an explicit skill that loads
   them, so the root prompt carries names and a short description rather than
   sixty schemas. Measure prompt tokens and cache reuse before and after with
   the telemetry that already exists.
6. **Model auto-review for reversible actions.** Keep `always()` human approval
   for league entry, allowance grants and anything irreversible. For reversible,
   budget-fenced actions such as hosted self-play requests, switch to Eve's
   `auto({model})` approval with the budget hooks as the hard fence. This is the
   lecture's main productivity claim and costs one line per tool.
7. **Notification decision log.** Record, for every finished background result,
   whether Preston spoke or stayed silent and why, and show that log in the
   updates view. The design doc asks for it; the inbox stores the decision reason
   but it is not yet reviewable as a stream. Silence should be visible as a
   decision, not an absence.
8. **Evals from failures.** Every bug the runtime fixtures catch becomes a
   `defineEval` case; run `eve eval --strict` in CI. The month-long continuity
   question the lecture raises is answered with virtual time, not calendar time.

## Design points to hold

- **One presentation contract.** The lecture's single `send_to_user` tool is a
  client-shape decision, not a reason to remove typed tools. Keep typed server
  tools, but converge `present`, `present_view`, `create_view`,
  `compose_workspace` and `companion_finding` on one presentation record so every
  client (web, desktop, voice) renders the same object.
- **Priority is a server rule.** Direct user messages steer; background results
  queue and batch; stop and revocation are fenced in SQL before any model turn.
  Eve's `turnPolicy` gives steer and queue; priority between sources is ours to
  enforce in the channels.
- **Authority never lives in memory.** Recheck grants at the point of effect,
  including after compaction and restart. A memory, skill, tool result or replay
  caption cannot expand permission.
- **Files for bulk, SQL for truth.** Sandbox files hold searchable projections;
  Supabase holds canonical records and authorization. A VM's disk is never a
  second memory database.
- **Compaction while warm.** When a long session goes idle inside the provider's
  cache window, compact then rather than on the next message. Measure before
  adding speculative prompt warming.

## What to stop doing

- Running the development stack as production. The dev dispatcher and the
  laptop supervisor are documented as local-only; treat them that way.
- Starting new capability tracks before item 4 passes. Voice, desktop control,
  cloud browser, learned procedures and campaigns all exist; none of them is the
  bottleneck.
- Adding a second coordinator or a second durable engine. The status ledger's
  rule stands: do not create a second owner for the same work.

## Coordination

Codex owns chat orchestration, the agent tools and instructions, migrations and
the production deployment. Claude Code owns the worker hosting assets listed in
`parallel-agent-handoff.md`. Contract requests between the two go through that
file. The one open request from this side is a provider injection point in the
worker entrypoints so a pod-replacement fixture can run without a live Sandbox.
