# Claude Code workstream: independent policy worker hosting

## Objective

Make the existing hosted policy build, upload and practice workers continue when
the user's laptop sleeps or disconnects. Implement and qualify this workstream;
do not stop at architecture recommendations. Codex owns chat orchestration and
the broader companion integration. This workstream concerns policy workers,
not migration of Eve chat/research Workflow storage.

Read `AGENTS.md`, `README.md`, `docs/runtime-ownership.md`,
`docs/companion-implementation-status.md`, and
`deploy/vercel-worker-host/README.md` first. Later dated status updates supersede
earlier deployment instructions: all hosting is Vercel-only. The wider product design is
`docs/preston-companion-harness.md`. Existing infrastructure conventions are in
the sibling `../metta` repository. Inspect available credentials without printing,
copying into artifacts, or committing their values.

## Verified starting point

- The user's original webDiplomacy `strategist:v1` is already built, uploaded and
  placed. Do not recreate or resubmit it. Evidence:
  `.artifacts/strategist-request/README.md` and `status-readback.json`.
- Build and upload waits already survive restarts. League status now supports
  `wait:true`, preserving the original submission and deadline. Actual compiled
  Eve restart qualification passed; evidence:
  `.artifacts/league-submission-wait/5d512848-0856-42b3-94a3-d64671833d76/report.json`.
- The actual Linux/amd64 service image passed all three worker-role imports,
  bounded discovery with networking disabled and graceful SIGTERM shutdown.
  Evidence: `.artifacts/container-policy-image/README.md`. The image was discarded
  with the temporary VM; it is not published or deployed. A new publishable image
  must itself pass qualification before its exact tested digest is used.
- Deployment assets and a manual GitHub image workflow exist locally. Publication
  defaults off; optional publication tags the tested image rather than rebuilding.
  The earlier remote audit found no workflows/runs in the GitHub repository.
- A bounded local supervisor remains active. Its exact PID and remaining lifetime
  must be discovered afresh; do not stop or duplicate it during investigation.
- The last AWS/EKS credential lookup failed with `ForbiddenException`; cluster
  access, ESO and registry pull permissions remain unverified. Verify present
  access, rather than assuming either permanent failure or available credentials.
- Primary schema ledger90 is qualified; applied migrations are immutable. Existing
  background holds and runtime bindings were unchanged. No runtime activation or
  automatic adoption of old sessions has been performed.
- The protected preview passes real authentication and scoped reads, but cannot
  read an original production chat that production can read. Do not infer session
  migration from shared SQL or use the same owner for distinct Workflow worlds.

## Work to complete

1. Inspect the existing deployment conventions and current access. Choose the
   existing supported hosting path and identify its exact project/namespace.
2. Finish and validate worker packaging, image publication and deployment assets.
   Use the existing admission journals, artifact bucket, token sealing key and
   provider identity. Do not introduce another policy submission service.
3. Verify startup configuration and read-only access to the existing durable
   records, private storage and provider. Keep credentials outside the image and
   logs. Stage the deployment without competing with the current supervisor.
4. Coordinate the worker handoff with Codex before changing active ownership.
   Drain the old supervisor, activate one worker, and preserve original operation
   IDs through uncertainty. Do not compensate for an ambiguous result by starting
   another worker or admitting another policy operation.
5. Demonstrate recovery after worker replacement with a disposable, bounded
   fixture: same journal/build/upload IDs, no duplicate registrations/submissions,
   retained artifacts and confirmed cleanup. Do not use the student's completed
   policy as a test. Report which checks use real services versus fixtures.
6. Leave exact commands, image/source identities, sanitized evidence, rollback
   steps and remaining limitations. If access prevents activation, complete the
   deployable assets and document the exact missing permission; do not repeatedly
   retry credentials or claim laptop-off continuity is working.

## File ownership and coordination

Own `deploy/vercel-worker-host/**`,
`scripts/container-policy-service.mjs`,
`lib/container-policy/provider-credentials.ts`, and new hosting-specific tests
and evidence. Coordinate before editing other shared worker files.

Leave `agent/tools/**`, `agent/lib/**`, `agent/instructions/**`,
`lib/chat-league-submission.ts`, `lib/softmax.ts`, runtime-ownership migrations,
and their current tests to Codex. Report contract changes before implementing them.

The shared working tree has extensive uncommitted and untracked implementation.
Do not reset, clean, blanket-stage, or assume a worktree from HEAD contains this
work. Inspect status first. Before using a separate worktree or publishing a
branch, coordinate an exact source snapshot that includes required untracked
files and excludes secrets/state. Preserve others' edits.

Do not launch or focus Electron, open native applications, start local Docker,
use the microphone, or control the user's desktop. Do not run `coworld download`
or `coworld run-episode`, or perform local game simulation. Do not clear holds,
bind accounts, rotate secrets or resubmit policies to make a test pass.
Temporary cloud resources require fixed deadlines and verified cleanup.

An optional second Claude agent can independently review the deployment and
failure-recovery evidence without editing the implementation agent's files.

## Status from Claude Code, 2026-10-12

Read-only findings and completed assets; nothing deployed, no credentials
changed, no journals touched, laptop supervisor left running.

- Access: the SSO user has `ReadonlyAccess` only on account `751442549699`;
  `PowerUserAccess` is not assigned, which is the exact cause of the
  `ForbiddenException`. Read-only EKS `main` access works. Staging has no
  cluster. Details and the exact missing permission:
  `deploy/container-policy-worker/ACTIVATION.md`.
- Assets: Helm chart lint and render pass; client dry-run of the Deployment
  against `main` accepted; 24 packaging/provider/service tests pass; a verified
  metta patch registers the ArgoCD Application
  (`deploy/container-policy-worker/argocd/metta-registration.patch`); the secret
  shape is `deploy/container-policy-worker/secret.example.json`. Activation works
  through pull requests; only the Secrets Manager value needs a write-capable
  operator.
- Direction review requested by the user: `docs/always-on-harness-direction.md`.
  Summary: the design matches the lecture; the gap is that nothing is hosted.
  Recommended order is snapshot the tree, deploy the companion build and
  migrations to production (Codex), host the workers (Claude), then the
  laptop-off acceptance demo before any new capability surface.
- Contract request for Codex: a provider injection point in
  `scripts/container-policy-worker.mjs`, `container-policy-upload-worker.mjs`
  and `container-policy-practice-worker.mjs` (for example an explicit
  `CONTAINER_POLICY_PROVIDER=fixture` that is refused outside tests, or a ports
  argument on their `main`), so a disposable two-generation pod-replacement
  fixture can run against a disposable journal without a live Sandbox. Not
  implemented here because those files are shared.
- Not done: image publication (needs the committed workflow), secret
  provisioning (needs write access), activation and the replacement fixture.

## Codex hosted-runtime evidence, 2026-10-12

Idle original-session read/reset across a same-source, same-preview redeploy now
passes with real authentication and terminal cleanup. Plain CLI redeploy dropped
the learning override; Codex fixed the operator helper and qualified an explicit
flag-preserving REST redeploy. See
`.artifacts/hosted-session-continuity/README.md`. This is not running-task recovery
or worker hosting. No account binding/hold, production promotion or worker handoff
occurred, and the deployed snapshot predates newer local worker changes.

## Worker test entry points available, 2026-10-12

Codex implemented the requested explicit in-process dependency seam in all three
`scripts/container-policy-*-worker.mjs` entry points (build is
`scripts/container-policy-worker.mjs`). Import the role's `main` and call:

```js
await main(['--duration-minutes=1'], {
  ports,   // Complete existing role-specific scheduler ports.
  signal,  // Optional AbortSignal for worker replacement / shutdown.
  storage, // Build only; omit for upload and practice.
});
```

Build ports are `scopes`, `dispatch`, `now`, `wait`, `report`;
upload/practice ports are `candidates`, `advance`, `now`, `wait`, `report`.
Use the existing exported port types in `lib/container-policy/{worker,
upload-worker,practice-worker}.ts`. Have `dispatch` / `advance` close over the
actual controller with disposable database/provider adapters. The production
scheduler still executes, uses the injected clock for its fixed deadline, and
drains in-flight operations on abort. Passing partial dependencies fails; omitting
the second argument retains normal live configuration/credential validation.
There is no fixture environment variable, CLI switch or dynamic module selector.

`tests/container-policy-worker-entrypoints.test.mjs` demonstrates two worker
scheduler generations retaining supplied IDs, abort/drain behavior, no live
network calls and refusal of incomplete injection. These are entrypoint wiring
tests, not SQL/provider/pod-replacement recovery proof. The latter remains the
Claude-hosting acceptance fixture. No deployment files or running workers changed.
Evidence: `.artifacts/container-policy-worker-entrypoints/README.md`.

## Status from Claude Code, 2026-10-12 (second pass)

- Image: workflow committed to `main` (`00b4154`); source snapshot branch
  `claude/container-policy-worker-hosting` (`9bdb7df6`) built from the shared
  tree via a temporary index. Qualification run 38213519221 passed; publication
  run 38213821775 pushed `ghcr.io/metta-ai/student-harness-worker@sha256:0f4027868b42edf8e887eef3bf056218d7f07b3d1bee4d976f2b548fcab27065`
  (public, anonymous pull verified).
- Kubernetes: metta PR https://github.com/Metta-AI/metta/pull/27301 registers
  the ArgoCD Application at `replicas: 0` (user-approved). Blocked on the
  Secrets Manager value `vault/student-harness/container-worker/env`, which
  needs write access on account 751442549699.
- Interim Vercel host (user's "use Vercel for now"): new project
  `student-harness-worker-host` (prj_7rOyJgsHw4Uyd6nDdXlstNsWxT3k, Softmax team)
  from `deploy/vercel-worker-host/`. Production deployed and verified through
  `vercel curl` with the cron secret: status, ensure no-op while
  `CONTAINER_POLICY_SANDBOX_HOST_ENABLED=0`, 401 on a wrong secret; cron
  `*/10 * * * *` registered. It keeps one named Vercel Sandbox running the
  unchanged `scripts/container-policy-service.mjs` from the snapshot commit.
  Needs `VERCEL_TOKEN` (scoped) before enabling. Not a contract change to any
  shared file.
- The laptop supervisor is untouched; no journal, hold, submission or secret
  value was read or changed. Handoff order remains: drain laptop, then enable
  exactly one hosted supervisor (Vercel now, Kubernetes later), never both.

## Status from Claude Code, 2026-10-12 (third pass)

User decision: all deployments use Vercel. Metta PR #27301 closed and its
branch deleted; `deploy/container-policy-worker/` (Helm chart, ACTIVATION.md,
metta patch) and `.github/workflows/container-policy-worker.yml` removed from
the working tree and from `main`. The published GHCR image remains but is
unused. `deploy/vercel-worker-host/` is the hosting path; its README now holds
the handoff and rollback steps. No Secrets Manager value is needed.

Independent restart/recovery verification (handoff item 5) is done:
`node tests/runtime/container-policy-replacement.mjs` runs three generations of
the real build-worker loop, dispatcher, controller, recovery and command stores
against a disposable PostgreSQL 17 + PostgREST journal with every migration
applied, with only the Sandbox provider and command gateway faked. Result: PASS,
31/31 checks, two consecutive runs; one provider create, one observe, zero
duplicates; build ID, provider name, session and tokens unchanged across SIGTERM
replacement. Evidence: `.artifacts/container-policy-replacement/README.md`.
Optional contract request for Codex: a `hosted?: HostedBuildPorts` argument on
`runContainerBuildWorker` and on `scripts/container-policy-worker.mjs` `main`
(loopback-only) so the fixture can spawn the shipped entrypoint instead of its
mirror.

## Codex real hosted chat check, 2026-10-12

One real Opus turn now passes detached-observer completion and identical original
turn readback across two existing previews, with terminal cleanup and a matching
$0.182536 credit receipt. No worker activation, account routing, hold change or
production deployment occurred. This does not replace the active-task/pod-recovery
acceptance check. Evidence: `.artifacts/hosted-chat-continuity/README.md`.


## Current Codex / Claude boundary, 2026-10-12

Codex is separating runtime-specific Eve delivery from the shared scheduling
control plane and removing automatic game creation from receipt reconciliation.
Do not activate an entire primary-backed preview dispatcher as an isolated test:
its shared stages can currently admit work or provision computers for unrelated
accounts. Runtime ownership alone does not narrow those stages.

The worker replacement fixture needs no additional `HostedBuildPorts` argument.
Its existing complete `ports` object already closes over the injected hosted
controller. Replace the mirrored loop with the shipped entrypoint:

```js
import {main as buildWorkerMain} from '../../scripts/container-policy-worker.mjs';
await buildWorkerMain(args, {storage, ports, signal: controller.signal});
```

Keep the disposable database/provider boundaries and loopback guards. Remove the
unused direct worker-loop import and duplicate deadline calculation. Claude owns
that fixture and the Vercel host; Codex has not edited either in this pass.

Cross-workstream validation: `npm run typecheck` currently fails at
`deploy/vercel-worker-host/api/host.ts:60`: installed `@vercel/sandbox` does not
expose `Sandbox.sandboxId`. Claude owns this file; inspect the installed SDK's
current-session metadata API and update its status projection and tests. Codex
has not modified the host to resolve this error.


Codex scheduler changes are now locally verified: `PRESTON_SCHEDULER_ROLE`
selects runtime/shared/both; owned runtimes default to runtime-only and preview
delivery without an owner fails before any claim. Shared stages need a designated
executor. Game receipt reads no longer admit automatic baseline retries.
40 focused tests and the compiled local cron replacement check pass; these changes
are not deployed by the earlier previews. Evidence:
`.artifacts/scheduler-role-reconciliation/README.md`. No worker activation or
handoff was performed; whole-tree typecheck still reports the host SDK issue above.


Codex campaign-lineage follow-up is locally qualified: new unapplied migration
`20261012072124_campaign_runtime_ownership.sql` preserves original root ownership
for campaign descendants after rebinding. 47/47 full-schema DB checks pass.
Recorded ledger90 still lacks the native-shutdown resume fence; its existing test
fails both before and after the new migration. Keep that shared-control-plane
activation prerequisite visible. No live migration or worker handoff occurred.
Evidence: `.artifacts/campaign-runtime-ownership/README.md`.


## Primary campaign ownership and audit-stop rollout, 2026-10-12

Codex applied exactly `20261011104642_audit_runtime_controls.sql` followed by
`20261012072124_campaign_runtime_ownership.sql`. Primary ledger90 → ledger92;
independent readback passes all checks. Existing holds, runtime bindings, task
ownership and campaign roots are unchanged. Existing policy submission untouched.

The actual pinned helper and 54 SQL regression tests passed against the captured
primary append order. Live rollback validation then passed before the single
commit. All six existing audit sandboxes were observed already stopped; six
durable shutdown receipts were created and remain pending at readback. They need
normal dispatcher confirmation; provider observation was not substituted for a
leased receipt. No provider, desktop, scheduler activation or deployment occurred.

This closes the campaign-lineage database rollout and missing native resume fence.
It does not qualify broader shared scheduling, hosted active-task failover or
independent worker activation. Claude continues to own Vercel worker hosting.
Evidence: `.artifacts/campaign-runtime-rollout/README.md`.

Next Codex qualification after ledger92: append desktop event expiry
(`20261011165533_companion_desktop_events.sql`) and durable revocation
(`20261011171428_desktop_durable_revocation.sql`) to the exact applied ledger in a
disposable database. The shared dispatcher currently calls missing
`desktop_expire_controls`. Preserve the already-installed companion event routing
when qualifying this late append. No native UI is needed for these checks.

Independent activation audit also found a campaign promotion gap: pending
`campaign_submission_admit` checks campaign approval/lease/generation but does not
serialize admission against `research_execution_controls`. `promoteStudy` checks
campaign state; the account hold is checked only earlier by the outer dispatcher.
Qualify and fix a hold-after-dispatch race before activating campaign submission.
Applying the pending approval-table migration alone is insufficient. Browser
schema closure remains separate (browser base plus desktop-session kind support).


## Campaign submission Stop fence and desktop expiry qualification, 2026-10-12

Codex implemented `20261012075305_campaign_submission_hold_fence.sql` as a new
unapplied migration. Admission serializes account controls and captures their
stamp; the new `campaign_submission_authorized` RPC validates the original
admission immediately before POST. Promotion checks Stop before upload, retains
upload receipts, and never resets a denied/uncertain admission for automatic
retry. The controller handles `stopped` without completing the research cycle.
Final SQL checks include lease/approval expiry after waiting for row locks.

Exact ledger92 → submission authority → hold fence passes 39/39 database, real
PostgREST integration and promotion checks, plus 8/8 controller regressions.
Independent review passed. Stop committed before dispatch, during upload or after
admission produces zero external submissions in actual promotion integration.
No primary mutation/deployment occurred; these app changes are not yet deployed.
A Stop after final authorization cannot retract a request already in flight.
Held campaigns still need broader receipt-only reconciliation qualification;
current tests do not establish automatic polling in every held state.
Evidence: `.artifacts/campaign-submission-hold/README.md`.

In parallel, exact ledger92 → desktop events → durable revocation passes 34/34
SQL and local API integration checks. No provider or Electron action occurred.
Before applying those two pending migrations, inspect existing expired grants
and commands and qualify the live receipt backfill/event implications.
Evidence: `.artifacts/desktop-control-rollout/README.md`.

Primary remains at the last verified ledger92. No hold or runtime binding was
changed, and Strategist was not resubmitted. Whole-tree typecheck still reports
only Claude-owned `deploy/vercel-worker-host/api/host.ts:60` (`Sandbox.sandboxId`).


## Shared-control schema closure applied, 2026-10-12

Codex applied exactly desktop events, desktop durable revocation, campaign
submission authority and campaign submission hold fence in that order. Primary
ledger92 → ledger96; all previous ledger checksums/timestamps and protected
row snapshots remain unchanged. Existing account hold remains set; bindings0;
verified deployment unchanged. Desktop preflight found0devices/grants/commands,
so this closure does not touch an active native session.

Final actual helper and combined SQL/local API qualification pass81/81, zero
skips. Helper pins exact migration bytes and the qualified baseline, defaults to
rollback, and rejects unreviewed concurrent ledger changes. Live rollback check
passed, then one apply committed four files. Independent SQL readback and
service API schema readback passed. No provider/Electron/scheduler activation.
Evidence: `.artifacts/shared-control-closure/README.md`.

The app-side final pre-POST fence is still not deployed; do not claim hosted
end-to-end Stop behavior from schema rollout alone. Claude retains worker-host
ownership and its known Sandbox SDK typecheck fix. Next Codex closure is browser
base plus desktop-session kind support, then current-source app deployment and
scoped hosted scheduling/failover qualification. Do not enable the whole shared
dispatcher to test an owned runtime.


## Small worker-host SDK integration fix, 2026-10-12

Codex corrected only the blocking status projection in
`deploy/vercel-worker-host/api/host.ts`: installed SDK3.5.1 exposes the session ID
through `sandbox.currentSession().sessionId`, not `sandbox.sandboxId`. Whole-tree
typecheck now passes. Worker lifecycle, credentials, deployment and activation
remain Claude-owned and untouched. This is a local source change; no worker host
was started or deployed. Evidence: `.artifacts/current-source-preview/typecheck.log`.


## Current-source preview qualification and Vercel tests, 2026-10-12

Codex replaced obsolete Helm/Docker packaging assertions with isolated tests of
the current Vercel host: disabled provisioning, pinned source, credential
allowlisting, immutable session lookup, uncertain discovery, shutdown and worker
source imports. All provider/network access is blocked in these tests. The old
Docker diagnostic now refuses execution and points to the Vercel qualifier; old
image evidence is historical, not qualification of the current hosting path.

The broad credential-free suite passes 1,188 tests with 370 conditional skips
(`.artifacts/current-source-preview/unit-final.log`). Isolated Next and Eve
production builds pass at
`.artifacts/production-build/d1392f9a-3b9e-4047-9151-66ac048a829c/report.json`.
Eve sandbox prewarming was deliberately skipped. A new authenticated, no-store
`/api/runtime/configuration` read reports actual nonsecret runtime owner, scheduler
role, recovery origin and generic-learning flag; it is not a liveness claim.

Browser schema qualification on exact ledger96 plus browser/desktop-session
migrations passes75/75 with cleanup and no provider/native actions. Evidence:
`.artifacts/browser-control-rollout/7c5a36c6-a7ce-4528-b1f7-99b3105163d9/report.json`.
Those two migrations are still unapplied. Receipt reads after Stop/expiry and
provider-project consistency still need qualification before browser activation.

A fresh-source preview uploader now journals creation intent and its original
deployment ID, with no automatic create retry. It pins this project, runtime-only
scheduling and the already-qualified preview owner; production promotion is not
part of this operation. Claude retains worker hosting and activation ownership.


## Durable computer receipts and cross-game tools, 2026-10-12

Codex made isolated browser/desktop tools account-scoped in GoTA and webDiplomacy
chat while retaining signed conversation league, approvals, account holds,
feature flags and per-computer ownership. Focused registration/transport tests
passed28/28 before receipt integration.

New migration `20261012083021_cloud_computer_command_receipts.sql` adds a private
immutable command journal. Only the first exact intent may dispatch. Status
reads survive account Stop and computer expiry; a still-live original physical
worker can supply a bounded read-only receipt. Completion requires the worker's
canonical command hash to match the saved intent. Older un-hashed receipts stay
unknown. The journal stores no typed input, screenshots, URLs or credentials.
Worker HMAC duplicate guards are retained. The transport strips the internal
command hash before returning results to the client.

Exact ledger96 plus browser base, desktop-session support and the new receipt
migration passes117/117 tests, including actual SQL/TypeScript roundtrips,
concurrent admission/Stop, post-lock expiry, worker hash agreement and restart.
Disposable PostgreSQL cleanup confirmed. Evidence:
`.artifacts/cloud-computer-receipts/d98b7ecd-0c3a-4a88-992d-9b1fa64bdc33/report.json`.
All three browser migrations remain unapplied; no provider/native activation.

New `scripts/hosted-task-continuity.mjs` supplies offline planning and explicit
read-only preflight/observation for a separate fixture account. Its13 tests pass.
It does not create/dispatch a task or prove Workflow takeover: production lacks
an exact-task wake endpoint. Next execution work is a narrowly authenticated
queued-task wake using a new exact-task claim RPC and the existing Eve channel,
retaining immutable runtime owner and original execution session. Generic
`start_task` also still needs signed non-GoTA scope and no GoTA baseline read.

Preview attempt08:27UTC recorded an uncertain creation acknowledgement and no
deployment ID. Bounded project-list reads have found no corresponding deployment;
the original journal is retained at
`.artifacts/current-source-preview/deploy-20261012-current/`. The uploader now
sends bounded SHA-addressed files before a small create request, and logs safe
HTTP status categories. No automatic retry or production promotion.


## Current app preview READY and verified, 2026-10-12

Fresh-source preview `dpl_rdrMRe452gT7uTzXce9pvruggLQm` is READY at
https://student-harness-aj5yo8ugv-softmax-3ba1c1cc.vercel.app .
Source SHA256:4ab74e4d50e441f962d65866ffd803186269cbdd6cc3c281affa757b65655fed.
The corrected uploader includes nested desktop source; only the top-level
Electron application is excluded. A prior filtered-source build failed and is
terminal; no uncertain creation was automatically retried.

Live health, authentication, scoped webDiplomacy reads and old completed-session
readback pass. The actual app reports the expected preview owner, runtime-only
scheduling, generic learning enabled and its own recovery origin. Primary
read-only inspection confirms ledger96, account hold/bindings/deployment snapshots
unchanged. No active task, model, game, native or shared scheduler was invoked.
Evidence: `.artifacts/current-source-preview/README.md`.

The preview contains campaign final submission fencing, cross-game computer tool
registration, runtime config readback and durable computer receipt code. Browser
schema/receipt migrations remain unapplied, so computer activation is not proven.
It excludes the newer exact-task wake and generic start_task work below.

## Exact task wake and generic task creation qualified locally, 2026-10-12

New migration20261012084508_task_exact_delivery.sql plus helper/production Eve
route/Next proxy permit one authenticated queued-task wake with the original
runtime, generation, address and canonical execution. Final authorization fences
Stop/deadline/budgets; uncertain delivery cannot mint another root. Historical
attempted deliveries without an attached root cannot be cold-replaced. Exact96
plus this migration passes77/77 with five actual SQL concurrency tests. Evidence:
`.artifacts/task-exact-delivery/9db07bf7-87ab-4216-9e2c-66a58472c6f4/report.json`.
Migration is still unapplied and endpoints undeployed. The task panel now has
a compact Start now button for queued sessions linked to a runtime. It reports
uncertain acknowledgements and refreshes status instead of creating new work.

start_task now permits enabled non-GoTA general research, pins signed league
scope, rejects cross-scope request-key reuse and saves no GoTA baseline.36 focused
and regression tests pass; whole-tree typecheck passes. This local source needs
an isolated real channel compilation and combined schema rollout before hosted
activation/continuity qualification. Worker hosting remains Claude-owned.

## Computer and exact-task schema applied, 2026-10-12

Codex qualified exact primary96 plus browser base, desktop-session kind, durable
computer receipts and exact-task delivery together:197/197 tests, zero skips.
The actual pinned helper was exercised with rollback, apply, repeat apply and
checks for altered source, unrelated migrations and changed ledger timestamps.
Evidence: `.artifacts/runtime-control-combined/095fb94e-6f07-4afa-bccb-a5f8da0bbc73/`.

After a live rollback-only validation, Codex applied exactly those four migrations
using `scripts/computer-task-closure-migrate.mjs`. Primary ledger is now100.
Read-only before/after inspection confirms all original ledger rows/timestamps
and19 protected relation snapshots unchanged, account hold still set, bindings0,
and new RPC/table access protected. These migrations are now immutable.
Evidence: `.artifacts/computer-task-closure/{before,after}.json` and check/apply.log.
No task, model, computer, native or provider work was started by this rollout.

A separate live routing check found current preview `/task-execution/health`
returns404 while `/eve/v1/health` returns200. Eve0.68 withEve does not automatically
publish authored channel URLs. Codex is qualifying an explicit task health/wake
bridge in next.config.ts and lib/eve-channel-routing.ts. Do not claim hosted
Start now works until deployment and actual route checks pass.

## Task routing and generic task UI qualified, 2026-10-12

Codex fixed the concrete non-GoTA task permalink→New session mutation: creation
keeps the viewed task's league, uses general research, hides GoTA campaigns, and
rotates the request key when scope changes. GoTA campaign/session behavior and
unsent drafts are preserved. Two headless UI checks and typecheck pass.

`lib/eve-channel-routing.ts` now explicitly routes only task health/wake paths
to the unnamed Eve service. Independent Next+Eve builds and actual loopback
Next→Eve checks pass:health204, unauthenticated wake401, unrelated sibling404.
Final generated Vercel routes and local rewrites are saved at
`.artifacts/production-build/a27ee121-1f1c-4aba-b730-0f4070477088/`.
An earlier local HTTP fixture failed because it had not launched the Eve server;
the corrected fixture starts both compiled processes and confirms cleanup.

Credential-free unit suite:1,261 passed,399 conditional skips, zero failures.
New frozen preview source SHA256:
6bad6c27e431733b135f0b8be9125eb3c9a0417ecd4932309b5966edb4eef1c0.
All814 uploaded source paths match the qualified snapshot except next-env.d.ts,
a generated Next declaration excluded from git-based build snapshots and
regenerated by Next builds. Deployment is tracked in
`.artifacts/task-wake-preview/deploy/journal.jsonl`; no production promotion.

## Task wake preview READY and live routing verified, 2026-10-12

Latest preview: `dpl_9cR6E2utjT2TeLi3eb8FGrK2n71q`,
https://student-harness-q0oqm91aj-softmax-3ba1c1cc.vercel.app .
Source SHA256:e2a07d6b8c5b8bcbc3b59da633282327dc58b97788ff1c4da6e3a83b8bb00d96.
The first bridge build failed on Vercel's parent-output directory layout; Codex
corrected output discovery to match Eve and qualified actual VERCEL=1 builds.
This new source deployment is READY; original failed attempt remains recorded.

All12 live route checks pass:health204, authenticated config, absent task404,
proxy/direct rejection of anonymous401, foreign-origin403, malformed400 and
nonexistent-task409. WebDiplomacy scoped reads and old completed chat readback
also pass. No existing task/model/game/computer was invoked and no production
promotion occurred. Evidence: `.artifacts/task-wake-preview/README.md`.

Exact-task wake and generic start_task are now deployed, superseding earlier
local-only notes. Primary remains100. Runtime owner is unchanged, role runtime,
generic learning1, recovery origin the current preview. Original account hold
and zero bindings remain intact. Successful active task dispatch/recovery,
account routing, full laptop-off journey and production rollout remain open;
rejected-request checks are not evidence for those. Claude owns worker hosting.

## Create-and-wake continuation qualified locally, 2026-10-12

Local source now connects `start_task` and `POST /api/tasks` to
`lib/tasks/create-and-wake.ts`. Creation keeps its existing idempotent request
key; only a queued task already owned by the configured runtime can request the
existing authenticated exact-task channel. No binding, adoption, generation
change, hold release or replacement task occurs. One HTTP request has a15-second
limit and8KiB receipt bound; unknown acknowledgements are not automatically
retried. The API retains `{task}` and adds `dispatch`; the chat tool retains flat
task fields and adds the same dispatch receipt. Held/unbound/foreign/unavailable
work remains saved and is not described as running.

A successful cold send can normally return202/uncertain before the task channel
attaches its canonical root. That is not proof of failed execution. The existing
exact delivery journal allows later readback of that original root without a
second send; the helper never treats a candidate session ID as canonical.

Local qualification:23 tests across `task-create-and-wake.test.mjs`,
`task-create-route.test.mjs`, `start-task-generic.test.mjs`,
`task-exact-wake-route.test.mjs` and `task-exact-wake-channel.test.mjs` passed;
11 additional chat-schema/generic-creation tests passed; `npx tsc --noEmit`
passed. Tests use mocked external boundaries, not live task/model execution.
These continuation changes are **not deployed** by this work.

The post-save review found and fixed two local boundaries: `createTask` now
returns its committed row if its bounded3-second enqueue attempt errors or loses
its acknowledgement; the hold preflight also passes a3-second AbortSignal through
the real RPC. Actual insertion failures still fail. Exact claim creates its
original event when absent (task_exact_delivery SQL lines68–75), and scoped
scheduler claim discovers queued tasks without pending events
(task_runtime_ownership SQL lines183–186), so enqueue failure does not require a
replacement task. Additional regression qualification:28 tests passed, including
actual3-second stalled-control cancellation, saved-row recovery after enqueue
errors, stable retry identity, and insertion-error preservation; typecheck passed.
No live holds or account bindings changed. UI dispatch notices remain root-owned.
All post-save fixes above are local source, not deployed by this work.

## Task creation and exact lifecycle qualification, 2026-10-12

Codex connected createTask → bounded exact wake in start_task and POST /api/tasks.
Saving succeeds independently of enqueue/dispatch acknowledgement. Enqueue is
bounded to3s; held preflight aborts its underlying RPC after3s; exact send is
bounded to15s and never retried automatically. Runtime binding/holds unchanged.
TaskPanel now consumes generation-scoped dispatch receipts, explains held,
unbound and uncertain outcomes, and no longer promises queued work will start
shortly.30 focused tests, two headless UI fixtures and typecheck passed.

Actual compiled channel/cookie/team auth, production task budget hook and
applied100 disposable SQL passed9 lifecycle checks, including lost finish-RPC
responses and SIGKILL while running/after terminal SQL checkpoint. Same original
root/generation resumes; foreign runtimes denied; cleanup confirmed. Evidence:
`.artifacts/task-exact-runtime/82173bbf-d632-4e34-8f0d-60e858287446/report.json`.
Synthetic model/task body means this is NOT hosted completion/failover evidence.
Successful cold send commonly returns202 uncertain before canonical attachment;
observe the original task rather than creating a replacement.

Isolated Next+Eve builds and loopback routing pass in
`.artifacts/production-build/f8e795b5-4f71-4dc1-9750-a45c4275b38e/`.
Frozen815-file preview source is byte-matched to that qualification at
`.artifacts/task-create-preview/qualified-source/`; source SHA256
0e053dc7f94e8858df47360d4ddaa413217b66d0d350892a9cc9343f478b5dc1.
New preview tracked by `.artifacts/task-create-preview/deploy-linked/journal.jsonl`;
READY/live verification pending. First preparation failed before any API create
because frozen source lacked project-link metadata; failure journal retained.

Atomic bind→insert/enqueue→unbind for a single trial task passed6 applied100
SQL tests, including actual lock waits with concurrent creators and rollback.
No live admission/trial was performed. Original hold and bindings remain intact.
The recovery grant allows5 model reservations over15min; task cost field is
reported-cost control, not a guaranteed hard provider spend ceiling.

## Creation preview READY, 2026-10-12 09:43 UTC

Latest preview is dpl_14AxDFhAmU2gaYNbZ9oGYKhyhKEe,
https://student-harness-gy8uu3xih-softmax-3ba1c1cc.vercel.app .
Source0e053dc7f94e8858df47360d4ddaa413217b66d0d350892a9cc9343f478b5dc1.
12 hosted routing checks pass, plus authenticated generic readback and prior
completed chat13events. Exact-create/wake and receipt UI changes above are now
DEPLOYED; no production promotion or account binding. Evidence is
`.artifacts/task-create-preview/README.md`.

Two blob-upload transport attempts ended before deployment creation. The upload
helper now drains bounded successful responses; local HTTP proved socket reuse
and17 regressions passed. Final upload completed and only its original deployment
was observed to READY. Older failure journals remain, with no create intents.

The actual operator trial-admission helper is qualified (9 helper+10 real SQL
tests) and remains LOCAL/operator-only. No primary invocation, trial grant or
model send. User has been asked via pending async question for one five-call,
15min hosted recovery trial while preserving the global hold. Do not infer
approval from elapsed time; wait for response before changing its exception.
Claude owns hosted policy workers and chat build/upload/submission path.

## Control continuation and generic voice, 2026-10-12

Codex added control-and-wake after eligible Resume/Steer. It matches the
immutable original control receipt to the current generation and direction
revision before exact wake. Old receipt retries, paused steering, Pause and
Cancel cannot restart newer work. One25s signal bounds control/receipt/token/
wake; saved controls remain readable if continuation is unavailable. TaskPanel
consumes matching control dispatch receipts and ignores stale ones.

Chat task_status and voice start_session/session_status/control_session now
support generic evidence research behind GENERIC_LEARNING_ENABLED. Signed chat
or voice lease pins the league. Listings scope tasks, campaign metadata and
fallback roots; foreign tasks reject before control. Voice starts use the same
saved-task/wake helper and stable call key; generic mode cannot start games or
policy work. GoTA auto routing retains its allowance/review requirements.

56 focused tests passed before a response-note correction; final generic/GoTA
note tests10passed. Voice suite70passed/17conditional skips. Typecheck passes.
Actual applied100 control+receipt+hold SQL with mocked wake HTTP passed17/17;
`.artifacts/control-and-wake/5588f836-1210-48c4-8b9f-e17f4dc1098b/`.
Headless notice fixture verifies Resume receipt, paused steering, stale receipt
and later progress without remounting. No native UI/audio/model/game effects.
Final build/deploy evidence will be in `.artifacts/task-control-preview/`.

Scheduler audit found production already READY with enabled minute and daily
cron definitions (dpl_C8rkKEBg45TJD4ZbDmJf8Z1jt3x4), but its configuration API404
means deployed ownership/role remain unverified. Only project default domain is
attached. Preview exact wakes may finish detached but receive no platform cron
ticks. Do not confuse schedule registration with observed execution, or same-owner
redeploy with active-work migration. Evidence: `.artifacts/scheduler-readiness/`
and `.artifacts/production-runtime-readiness/README.md`.
Scoped trial approval remains pending. No account hold, binding or production
configuration changed. Claude still owns hosted policy build/upload/submission.

## Control preview READY, 2026-10-12 09:59 UTC

Latest qualified preview: dpl_9YWBMaPEvxZ8bGLn6qvReV1DwggJ,
https://student-harness-f1gjv8vpa-softmax-3ba1c1cc.vercel.app .
Source SHA256: de42351616210879bc96c0f4401294ec14bcc71ae994a3674d99660b7c63bd32.
817 uploaded paths match final Next/Eve qualification
`.artifacts/production-build/fba36b66-538a-4632-abb6-9d6ff22c6c6a/`.
Original deployment reached READY;12 live routing checks and authenticated
scope/config/old-chat reads pass. Control continuation + generic voice task
lifecycle are now deployed, superseding earlier local-only status.
Evidence: `.artifacts/task-control-preview/README.md`.
No account binding, hold/trial change, real model/game/native action or production
promotion. Pending user answer still required before scoped recovery trial.

## Hosted trial runner qualified locally, 2026-10-12 10:21 UTC

Codex prepared `scripts/hosted-task-trial.mjs` with admission, conditional grant/
cleanup, and original Eve result verification helpers. Default is fully offline;
apply is still awaiting the scoped recovery-trial approval. Resume can observe
and reconcile the original operation only, never admit/grant/wake again.

54 focused tests and20 real applied100 disposable-database tests pass, including
lost acknowledgements, later user controls, actual usage/background-result proof,
crash after saving terminal SQL but before saving observer progress, and underlying
CLI/credential-query deadline cancellation. Final CLI dry run passes. Evidence:
`.artifacts/hosted-task-trial-qualification/README.md`, source hashes beside it;
DB evidence `.artifacts/temporary-task-admission/8cc25cde-82e3-4e5b-87b7-fabae51aa269/`.

Read-only primary check10:21:13 confirms original control/deployment snapshots
unchanged,held1,bindings0,schema100. No live trial or production promotion.
Cleanup receipts prove SQL state only; no claim of provider/session termination.
Unverifiable stale mutation locks remain inspection-only with original expiry.
See `docs/hosted-task-trial.md` for protocol and remaining hosted acceptance.
Claude retains complete chat policy build/upload/submission ownership.

## Scheduler execution evidence and observability, 2026-10-12

Read-only current-production logs show15 GET200 responses at roughly minute
intervals on the registered cron route,10:10–10:25 UTC. Deployment remains
`dpl_C8rkKEBg45TJD4ZbDmJf8Z1jt3x4`. Both schedules share a route; caller identity
and application records are missing, so automatic invocation and handler
completion remain unproven. `.artifacts/production-scheduler-execution/report.json`.

Codex added correlated tick/stage/final handler records in both schedules,
plus pure receipt classification and a bounded read-only provider-log reader.
Task/research send failures now surface after existing retry handling, without
additional sends. Returned handlers never imply successful downstream effects.
The old read-only task observer no longer falsely reports exact dispatch absent.

75 focused tests pass. Compiled local Nitro cron/replacement fixture verifies
failed1/returned1 handler passes and two distinct synthetic task completions,
with no duplicate delivery; all processes cleaned. Actual Next+Eve builds and
loopback routing pass, with scheduler source hashes matched. Evidence:
`.artifacts/scheduler-observability/README.md`.

Instrumentation remains LOCAL, not deployed. No account hold/binding change,
cron invocation, live model/game/native action, or production promotion. Scoped
trial approval remains pending. Claude retains the policy pipeline track.

## Scheduler preview verified — 2026-10-12 10:40 UTC

Scheduler lifecycle instrumentation is now deployed in READY preview
`dpl_6irGNYmZJMx8m5VA9TdEfzmow4bM`, superseding the earlier local-only status.
823 upload files match the qualified Next/Eve build;12 live routing checks and
runtime/authentication/league-scoped/old-chat readback pass. Evidence:
`.artifacts/scheduler-preview/README.md`. Preview has no automatic platform cron;
production scheduling and live task acceptance remain unverified. Hold and
account routing were not changed; the scoped trial still awaits an answer.

Claude worker-host read-only audit: READY production
`dpl_CditjbvwStkXVxr7bzx9tBGPcvm9`, but required production `VERCEL_TOKEN`
configuration is absent. Enabled/active sandbox remains unknown because status
authentication was unavailable. No status request or ensure call was sent.
Evidence: `.artifacts/vercel-worker-host-readiness/README.md`.

## Saved task availability and bounded history — local, 2026-10-12

Codex added read-only queued start availability to task details and the permalink
UI. Reload retains held/unassigned/foreign-runtime explanations; Start now requires
matching current-generation eligibility. Expired task/call limits and unavailable
control reads cannot enable it. Execution denial from closed studies/responsibilities
is distinguished from a confirmed account hold. This is eligibility, not worker
liveness or a durable delivery acknowledgement. No claim or assignment runs on GET.

History now reuses complete terminal streams, handles resumed roots, stops after
settled task/log/cleanup state, spaces automatic reads by one minute with backoff,
and expires after15minutes until explicit Retry. Failed detail reads/lease expiry
invalidate start availability while preserving saved content. Transcript-only
failures retain current checks. Notifications cannot extend an expired lease.

34 tests pass including nine headless hook scenarios; the headless reload/start/
control fixture, existing control-refresh fixture and typecheck pass. Independent
review findings were corrected. Evidence: `.artifacts/task-observation-readiness/`.
These newest changes are LOCAL; the scheduler preview predates them. No live task,
model/game/native action, schema write, hold change or production promotion.

## Task status preview verified — 2026-10-12 10:53 UTC

Saved task readiness and bounded history are now deployed to READY preview
`dpl_9CyMRTPPDDx6AHxRWyGq4ES7vZAP`:
https://student-harness-abmjbon0y-softmax-3ba1c1cc.vercel.app .
825 upload paths match the isolated Next/Eve production build;12 live routing
checks, authenticated runtime/league/old-chat reads and three existing owned task
detail reads pass. Existing tasks were paused, so hosted queued eligibility is
not established by these reads. Source SHA256:
`a112e8cfd47ffe148406b054095cb61d6e4f69dc02ce5ac0fb8341886ca1bb71`.
Evidence: `.artifacts/task-status-preview/README.md`.
No production promotion, live work, hold/binding change or native UI action.
Cross-device control conflict recovery is subsequent local work and not included.

## Cross-device control conflict recovery — local, 2026-10-12

Codex fixed repeated Resume/Steer failure after another device advances task
generation. Exact SQL pre-mutation conflicts produce a typed409. The UI preserves
drafts, requires a successful post-rejection read and newer generation, then lets
the next explicit click use a new operation key. Unknown outcomes keep their
original key/generation. A synchronous read counter covers the read-before-conflict
React scheduling race. Refresh never automatically resends a control.

17 focused tests, the headless lost-ack/conflict/race fixture and typecheck pass.
Independent review plus12 focused tests pass. Source and validation record:
`.artifacts/task-control-conflict/`. No owned test processes remain.
This code is LOCAL and not in task-status preview dpl_9CyMRTPPDDx6AHxRWyGq4ES7vZAP.
No schema, hold, binding, real model/game/native or production changes. Pending
scoped trial approval remains unanswered; Claude still owns policy workers.

## Cross-game activity and cross-device feed refresh — 2026-10-12

SharedActivity now follows the selected league, including webDiplomacy. Keyed
remounts abort previous reads and reset the cursor; strict response validation
rejects foreign/malformed pages before either cursor or display changes. Actual
SQL page outputs pass the client parser for separate accounts and leagues.

The existing task feed now invalidates selected detail when a known task changes
generation, direction or status on another client. Hints are deduplicated, ignore
their own origin and do not extend history leases or authorize controls. Local
control receipts fence older feed snapshots.

10 focused event/route/feed tests,9 disposable primary100 PostgreSQL tests,
headless activity and external-source integration fixtures, typecheck and
independent review pass. Combined production Next/Eve build and loopback routing
also pass. Evidence: .artifacts/shared-activity-scoping/ and
.artifacts/production-build/63eb020f-e3b6-4e2a-96f1-ce9d4f5741b3/.
Preview upload is in progress; source freezes827 paths at SHA256
62f2da08d6f257ca22ed8c824bf7bae979172b18a9eb7494453be2852779ab99.
No primary writes, hold/binding changes, live tasks/models/games or native actions.

## Client continuity preview verified — 2026-10-12 11:15 UTC

Cross-device conflict recovery, task-feed refresh hints and cross-game activity
are now deployed to READY preview dpl_2GP2CekFJgbniLyUJ4b3GbaEW1nC:
https://student-harness-a20wikx6y-softmax-3ba1c1cc.vercel.app .
827 paths match the isolated Next/Eve production build.12 hosted routing checks,
authenticated configuration, scoped webDiplomacy reads, existing completed-chat
readback and three paused-task detail reads pass. No hosted active/queued task
execution is established. Evidence: .artifacts/client-continuity-preview/README.md.
No production promotion or primary hold/binding change. The subsequent scoped
SharedMemory page/link work is LOCAL and excluded from this frozen deployment.

## Shared memory follows selected league — 2026-10-12

The memory page now validates and preserves league scope on initial authenticated
reads, search, refresh, retry and workspace/source navigation. The companion
exposes its scoped memory link in webDiplomacy and other games. Generic memory
rejects foreign or unscoped records; keyed remounts fence delayed responses and
preserve unrelated drafts. Disabled learning displays its actual scope reason.
No backend, schema or policy-pipeline changes were required.

Page tests, both memory browser fixtures, generic sidebar/discovery fixture and
TypeScript pass. Independent review found no blocker. Production qualification
then caught an optional page-argument type incompatibility; it was corrected and
page tests/TypeScript rerun. Corrected Next/Eve production builds and loopback
routing pass (4cbb294a-c811-45e5-bf08-c6ac1cc2b6f8).
Evidence: .artifacts/scoped-shared-memory/. Frozen827-path preview upload is in
progress with SHA256 a733dccb0f37b1dc26e959d19d19c3bd6a6a5cee6a8e2f16abfc531ca36c8a03.
No primary writes, live task/model/game, native UI or hold/binding changes.

## Scoped memory preview verified — 2026-10-12 11:22 UTC

Latest READY preview dpl_HRqoArYSwpipbxcK1kD7UchdCKAQ:
https://student-harness-mabbo5r01-softmax-3ba1c1cc.vercel.app .
Includes client-continuity fixes and scoped SharedMemory page/navigation.827
upload paths match corrected production Next/Eve build.12 hosted routing checks,
authenticated configuration, scoped learning/responsibility reads and prior-chat
readback pass. Both webDiplomacy and GoTA memory pages/APIs return200 and exact
scope with available=true; both were empty, so populated provenance/race coverage
is still isolated-fixture evidence. No production promotion, primary writes,
hold/binding changes, live task/model/game or native action.
Evidence: .artifacts/scoped-memory-preview/README.md.

## Saved work restores its game — 2026-10-12

Task permalinks now resolve the owned task's league before selecting a shell.
Generic task controls, companion, discussion, task-result feed, Workspace and Back
retain that league. The GoTA sidebar now routes unknown/foreign-game task IDs
through the server resolver; its legacy chat history excludes generic sessions.
Saved chat short links use bounded account/host metadata to canonicalize their
league; only true absence retains query-selected local drafts. Saved links reload
after sign-in, preserving the original route.

Optional league-filtered Updates preserve chat finding scope through paging and
workspace navigation while retaining the all-account inbox. Pages reject mixed
league results before display and fence late responses. Evidence:
.artifacts/league-navigation/README.md (15 focused tests,8 inbox/finding regressions,
headless task/inbox fixtures, typecheck and independent review). Final Next/Eve
production qualification5304fb27-04c5-4087-afee-a0a283c8a84b passes. Frozen830-path
preview upload is in progress with SHA256
f72ec7074c97f88e06d89d5e97be7d9cfb3de379959b9bc7e04fc582ae0d7594.
No primary writes, live task/model/game/native or hold/binding changes.

## League navigation preview verified — 2026-10-12 11:36 UTC

Latest READY preview dpl_2rTTfLq3DPhqPA9t3JED5uWB6LHP:
https://student-harness-fuio6wjef-softmax-3ba1c1cc.vercel.app .
830 source paths match final qualified Next/Eve build.12 hosted routing checks,
authenticated runtime/league/old-chat reads,3 paused-task reads, scoped/account
inbox reads and scoped Updates page checks pass. Invalid league routes reject.
The actual owned conversation-scope helper also matched3 existing saved webDip
records without reading prompt/token payloads. Positive hosted permalink UI
behavior and populated inbox pages remain isolated-fixture coverage.
Evidence: .artifacts/league-navigation-preview/README.md. No production promotion,
primary writes, live task/model/game/native action or hold/binding change.

## Learning history and correction repair — 2026-10-12

Codex fixed real SQL experiment proposal/control events crashing study review.
Both recent and exact reads now retain their audit identity, plan/prediction/task
links and canonical evidence. Control receipts are not empirical outcomes.
Corrections of older debriefs/lessons retrieve their exact missing reference;
superseded references require an explicit choice, while failed or delayed reads
preserve drafts. A refreshed correction invalidates previously hydrated targets.

25 focused backend tests,2 real disposable database lineage tests,15 scheduled
review/finding/transition integration checks, correction-form browser scenarios,
existing study browser workflow and TypeScript pass. Independent review passes.
Next/Eve production qualification a31534d4-1a5f-4e5f-beb7-c6ffe2b1da15 and actual
loopback routing pass; temporary servers/builds cleaned. Evidence:
.artifacts/learning-loop-repair/README.md. Frozen832-path preview upload is in
progress with SHA2563572597a4444526c7d85815582863391611697d3ea43721de9e0b3c75637a738.
No primary writes, models/games/native effects, migration or hold/binding change.
Scoped live trial remains pending; Claude retains the policy pipeline workstream.

## Learning-loop preview verified — 2026-10-12 11:51 UTC

READY preview dpl_BzRpDpmXwPAJRX6N1S2VZd7LUsQn:
https://student-harness-c2dpqi97d-softmax-3ba1c1cc.vercel.app .
832 uploaded paths match qualified Next/Eve source.12 hosted routing checks,
existing-account authentication, runtime configuration, scoped learning and
responsibility reads and prior completed-chat access pass. Both GoTA/webDip
study lists are enabled and empty, so populated proposal/correction behavior
remains actual disposable-SQL/headless evidence. No primary writes, live tasks,
models/games/native effects, migration, hold/binding change or production
promotion. Evidence: .artifacts/learning-loop-preview/README.md.


## Codex coordination update — 2026-10-12 12:12 UTC

Codex has applied the exact learned-procedure closure to primary103:
`20261011134508_companion_procedure_discovery.sql`,
`20261011135503_companion_investigator_trials.sql`,
`20261012115716_scoped_learned_skills.sql`.
All earlier migration hashes/timestamps remain unchanged; hold1/bindings0 remain.
Treat all103 applied files as immutable. The protected preview is now
`dpl_D3Son2MsuBbzrjDDJcB9PPZLtwya`; no production app promotion or worker ownership
handoff occurred. Cross-game skills/store/UI/voice code belongs to Codex.
Qualification and precise scope: `.artifacts/scoped-procedures/README.md`.


## Codex coordination update — 2026-10-12 12:19 UTC

Latest protected preview: `dpl_H6HFWwEHK8VV32YqFBLuLiVGjt6v`. Procedure pointers in
shared memory now follow the selected league. Compiled generic investigator
crash/control tests and a bounded synthetic real-model assessment pass. No primary
writes or worker handoff this turn; ledger103 and existing holds/bindings remain.
Evidence: `.artifacts/scoped-skill-recall/qualification.json`.


## Account usage preview verified — 2026-10-12 12:38 UTC

READY preview `dpl_A9CYKvDWbkf9nRVkoc93e8bVziLt`:
https://student-harness-7a7gg4kqc-softmax-3ba1c1cc.vercel.app/usage .
840 uploaded paths match the qualified build. Authenticated page/API and first two
50-row usage pages match direct database reads. Anonymous/scope-injection/duplicate
query rejection,12 routing checks, existing completed-chat read and runtime
configuration pass. Details: `.artifacts/account-usage-preview/README.md`.
Primary104 includes only the new usage read migration this turn; existing hold1
and bindings0 remain. No production app promotion or live task/model/game/native
activation. The broader capability objective remains active.

Codex owns `lib/usage`, `/api/usage`, `/usage`, credit menu linkage, and Shared
Memory procedure validation. Claude continues policy build/upload/submission.
Treat migration `20261012122442_account_usage_ledger.sql` as applied and immutable.
The new history exposes many historical unpriced reservations; it does not change
settlement producers or clear holds. Do not infer that these operations are still
running or resubmit them because no final cost was recorded.


## Finding return preview verified — 2026-10-12 12:53 UTC

READY `dpl_2aW8PsWibUcmx4B9SAKumG1PCE7z`:
https://student-harness-d4oqlswk9-softmax-3ba1c1cc.vercel.app/updates .
843 source paths match qualified build;12 routing checks, existing-account auth,
exact runtime configuration, prior completed-chat read and scoped finding lists
pass. Both live finding lists are empty, so populated finding/discussion behavior
remains actual disposable-SQL and local headless evidence. No primary writes,
migrations, hold/binding changes or production promotion. Evidence:
`.artifacts/finding-return-preview/README.md`. Full capability goal remains active.

Codex added immutable human-summary projection and discussion references across
finding API/documents and workspace request metadata/context. No changes to
Claude’s policy build/upload/submission workstream. Current primary remains104.
Next identified gaps: generic companion active-task summary is hidden by the
campaign-only card; native notification claim migration is not in primary104.
Neither is evidence of completed hosted autonomous execution.


## Generic companion ongoing work — local, 2026-10-12

The previous coordination turn did not change the implementation; this turn
resumed the verified missing generic task card. Preston now shows selected-game
standalone work on Performance, with saved status, blocker, timestamp and exact
task navigation. Tasks needing input and ongoing work precede terminal history;
terminal campaigns cannot hide an ongoing standalone task, and campaign roots
are excluded from standalone selection. Campaign root state takes precedence
over a lagging campaign record. Malformed display fields cannot crash selection.

The shared task feed stays enabled for authenticated generic users. Both shells
supply account identity; account changes fence late reads and hide old rows,
and 401/403 clears content. Automatic observations run at minute intervals,
suppress hidden-tab reads, back off on errors and expire after20minutes until
explicit refresh. Mutation notifications do not extend the lease. A local
mutation epoch prevents a pending older GET from replacing a saved control or
newly created task. Existing campaign behavior and independent composer drafts
remain covered.

14 focused tests plus the actual generic workspace browser fixture and TypeScript
pass. Independent cross-review found and drove the campaign-selection and local-
upsert fixes. Evidence: `.artifacts/generic-companion-progress/focused.log`,
`.artifacts/generic-companion-card/report.json`, and
`.artifacts/generic-companion-workspace/0d7fba44-afba-46b7-a1bc-45d8c9fd08d5/report.json`.
The last fixture renders real Explorer, PresentPanel, task feed, composer and task
panel with HTTP/voice boundaries mocked; it does not establish live worker execution.

These changes are local; the last verified hosted preview predates them. No
primary mutation, schema change, hold/binding change, model/game/native effect or
production promotion. Claude continues to own policy workers. The full capability
objective remains active; this fixes visibility, not hosted execution admission.

Final isolated Next/Eve builds and loopback routing pass in
`.artifacts/production-build/cc950d56-de5a-4cf0-a40d-9985702ac9bf/report.json`.
All11changed production/test files match that source snapshot. Temporary build
servers and directories were cleaned. Combined evidence:
`.artifacts/generic-companion-progress/report.json`.


## Generic companion preview verified — 2026-10-12 13:09 UTC

READY preview `dpl_DdYXmvmfL823zc6xvbDeuPUHLsEV`:
https://student-harness-98cnlfwl2-softmax-3ba1c1cc.vercel.app .
843uploaded paths match qualified buildcc950d56 at source SHA256
`b2cd86df44e52c4a33552049836a77ef6eb2fdf1d853f98e976a962c413efda5`.
12routing checks, exact runtime configuration, authenticated scoped reads and
prior13-event completed-chat access pass. The existing task feed contains207
owned tasks; worker/campaign references remain owned. It contains no webDiplomacy
tasks, so populated generic companion behavior remains local headless evidence.
No production promotion, primary writes, task/model/game/native effect or
hold/binding change. Evidence: `.artifacts/generic-companion-preview/`.
The subsequent inline study-review setup is separate local work.


## Inline study review setup — qualified locally, 2026-10-12

A study now offers **Set up Preston review** using the existing responsibility
workflow. Setup resolves the exact owned study, including studies outside the
latest 50, and pins it in the shared form. The default is one review; the human
chooses its trigger, model-call/cost limits and expiry. Opening setup performs
reads only. Saving preserves existing background holds and does not launch games
or enter a league. Daily/interval/event timing is stated explicitly.

An immutable request is retained by account, league and study before POST. Exact
request-key receipt lookup recovers uncertain acknowledgements even after expiry
or removal from the bounded recent feed. Web Locks serialize pending-request
storage across tabs; a competing draft cannot replace an unresolved request,
and a late acknowledgement cannot delete a newer key. Receipt validation checks
the original configuration rather than trusting a matching title. All receipt
API responses, including authentication/errors, are no-store. No migration added.

Evidence: `.artifacts/study-review-setup/final-report.json`. Fifteen focused
store/route tests, TypeScript, existing learning and Between-visits browser
regressions, and the new two-tab headless scenario pass. Browser evidence uses
scripted HTTP responses. Three additional production-route/store integration
tests pass against disposable PostgreSQL/PostgREST with the captured 104-migration
ledger; only HTTP identity is mocked. This proves exact receipt recovery, scoped
access and unchanged hold/task/binding state, not live model execution.

Final Next and Eve builds plus loopback routing pass at
`.artifacts/production-build/b90f6f7a-068b-422f-88cc-f12330017e8c/report.json`;
all nine browser/database evidence source files match that build. Temporary test
services are cleaned up. The preview upload is separately recorded under
`.artifacts/study-review-preview/`; hosting is only verified once its READY and
readback reports exist. No production promotion or real responsibility creation.

The next verified product gap is returning a completed review directly to its
study. The backend retains immutable study-linked task result events, but the
study's visible entry filter excludes these generic records unless a separate
debrief was authored. Add a scoped, released findings projection with original
evidence/discussion links; do not infer findings from mutable task text.


## Study review preview verified — 2026-10-12 13:30 UTC

READY protected preview: https://student-harness-ij3hovn8x-softmax-3ba1c1cc.vercel.app
(`dpl_H1Fe1yWDQAUJDEnMSgPzFGjebHjr`). All 845 uploaded paths match the qualified
b90f6f7a build; source SHA256 is
`82698298157a3110ff7aad79cd113426a39c6ff969396cda5467938ef8cc11c8`.
Twelve routing checks, authenticated runtime configuration, exact recovery origin,
and prior 13-event completed-chat read pass. New exact request receipt lookup
returns null for a fresh missing key with no-store; scoped reviews are enabled,
held, and empty. Learning is enabled but the selected live league has no studies,
so populated study UI and saved-review recovery remain local browser/actual
disposable-database evidence. Anonymous responsibility reads return 401/no-store.
No real review was created and no background hold, runtime binding, primary
schema, model/game/native state or production deployment was changed.
Evidence: `.artifacts/study-review-preview/{build-source-match.json,routing.jsonl,readback.json,hosted-review.json}`.
The following study-findings return work is separate and is not in this preview.


## Review findings returned to studies — local qualification, 2026-10-12

The study now displays released Preston review findings independently of authored
learning entries. The new read-only `/api/companion/findings` endpoint verifies
the exact owned study, then filters by account, league, study and release status
before the 20-row keyset page. Dismissed inbox findings remain accessible as study
history; deferred results remain hidden. Saved summaries link to the original
finding document and the existing scoped discussion flow. Mutable task results
are never substituted for the original report. Closed studies retain history.

The compact study section loads once and refreshes only on explicit action.
Errors retain the last successful snapshot with a warning; authentication/scope
failures clear it. Account identity fences pagination, and scope changes abort
and reject late responses. Explicit older batches allow traversal beyond 200
findings while retaining at most 200 rows. Finding/discussion links visibly open
a new tab so the existing reasoning draft remains intact. No read acknowledgement,
new chat send, work admission, model call or navigation occurs from background
refreshes. No new SQL migration or worker changes.

Qualification: 10 focused tests (new list/route plus existing finding summary and
page coverage), TypeScript and independent review pass. Three real disposable
PostgreSQL/PostgREST tests use actual task-transition triggers and the captured
104-migration ledger. They prove older-study discovery beyond 50 unrelated
results, tied-timestamp cursor ordering, dismissed/deferred/foreign handling,
immutable original reports after later task changes, closed-study access and
no read-induced task/hold/binding/acknowledgement changes.

Headless study findings coverage passes at
`.artifacts/study-findings/f0ca2bda-0583-448b-b4a1-81ee98493f3a/report.json`,
including 240 results, failed batch recovery, separate document navigation,
late league responses and unchanged drafts. Existing learning and two-tab review
setup regressions pass; the latter's current combined-source report is
`.artifacts/study-review-setup/26a579ae-d229-4184-af99-330b955b59e8/report.json`.
Browser APIs are scripted; these results do not prove live review execution.

Final isolated Next/Eve builds and loopback routing pass at
`.artifacts/production-build/3d994008-3d35-4372-884a-41f8cd47073e/report.json`.
All production source hashes covered by browser/database evidence match that
build. Browser fixture edits followed the snapshot and are recorded separately.
All temporary services/browsers were cleaned. Combined evidence:
`.artifacts/study-findings/final-report.json`.

This subsequent findings feature is local only. The verified hosted preview
remains dpl_H1Fe1yWDQAUJDEnMSgPzFGjebHjr, which includes review setup but predates
this return view. No production promotion or real review was created. Full
capability goal remains active. Next safe product gap: provide a guided link
from a completed container practice to an existing study/prediction, preserving
exact source/build/result identity and leaving the assessment explicitly human.
That should use existing practice receipts and learning APIs, not change Claude's
worker hosting or execute another practice automatically.


## Study findings preview verified — 2026-10-12 13:43 UTC

READY protected preview: https://student-harness-h9k4b1wln-softmax-3ba1c1cc.vercel.app
(`dpl_EDpoCpWgUBJhujVva7pPWm3CUeda`). All 849 uploaded paths match qualified
build 3d994008; source SHA256
`d18a99947fdfd4de885e99b711b808c6dc1825e9f5250f271daaa5180f433d88`.
Twelve routing checks, authenticated runtime configuration/recovery origin and
prior 13-event completed-chat reads pass. Scoped learning/review reads pass.
The new findings route returns authenticated 404 for a missing study, 400 without
exact study selection, and anonymous 401, all no-store. The live selected league
still has no studies, so populated findings/history remains local browser and
actual disposable-database evidence. Background work remains held.

Evidence: `.artifacts/study-findings-preview/` (frozen source, upload journal,
routing.jsonl, readback.json and hosted-findings.json). No browser or mutations
were run against this preview; no live review/model/game/native actions, primary
schema writes or production promotion. Subsequent practice-learning work is local
and not included in this preview.


## Practice-to-study assessment locally qualified — 2026-10-12

Completed container practices now offer an explicit human observation/debrief form
with exact source provenance, scoped study selection and older prediction paging.
Assessment defaults to inconclusive. Fresh saves verify the current prediction;
unresolved original saves retain their exact body/key across reloads and two tabs,
and can recover after later study closure or prediction correction. Opening the
form starts no work. No prospective timing or gameplay improvement is inferred.

Qualified snapshot: isolated Next/Eve build and loopback routing
`37338636-054b-4d9d-99ae-49322dd44bc7`; browser `b6dcc54a` passes nine scenarios
with desktop/mobile screenshots; disposable PostgreSQL/PostgREST `618af802` passes
4/4 on the captured 104-migration baseline with no appended migrations. Focused
preparation/route tests pass 4/4, typecheck passes, and existing operation/replay
regression `4840af58` passes. All 13 recorded production source comparisons match
the build; the later browser-fixture-only change is recorded separately.

Combined evidence: `.artifacts/practice-learning/final-report.json` and
`.artifacts/practice-learning/README.md`. All local services/browsers were cleaned.
This is local qualification only: no deployment, primary mutation, live game/model,
provider action, native interaction or production promotion. The existing study
findings preview remains the hosted version. Shared-learning practice-evidence
projection is a subsequent feature under development, not covered by this report;
keep this snapshot intact and qualify that follow-up separately.


## Shared practice evidence for chat and voice — qualified 2026-10-12

The existing learning readers now return a separately labelled current practice
receipt alongside the immutable attachment. Chat and signed voice use the same
reader: exact request, policy version, game/manifest, build, upload and recomputed
source identity; recorded positional scores; nullable reported costs; retrieval
time explicitly separate from unknown completion time. This supports discussing
the evidence behind a human assessment without granting execution or asserting
comparative improvement. Original learning payloads are never rewritten.

The preparation form reuses the same verified journal reader. Incomplete,
non-completed, unavailable or mismatched snapshots expose no receipt. Fresh reads
strip stale derived fields. History checks at most three distinct practices; exact
entry reads allow all twelve references. Each receipt is capped at 8,192 UTF-8
bytes, with shared detail budgets and at most two concurrent lineage checks. A
ten-second deadline stops new batches; already-started SQL reads have their own
timeouts and may finish afterward. No provider requests, mutations or migrations.

Evidence: 38 focused tests; typecheck; independent review; five actual disposable
PostgreSQL/PostgREST tests at
`.artifacts/practice-learning-integration/7fe4fc57-a8b0-4ea4-bf42-759f15ac165c/report.json`.
The fifth uses the real chat tool and signed voice HTTP handler against the same
saved human debrief, checks identical outcomes and unknowns, verifies unchanged
original payloads, and rejects a current journal whose request changed. HTTP
identity and the Eve tool-definition wrapper are fixture adapters; no model or
live audio ran. The first four retain the completed-practice assessment coverage.

Next/Eve builds and loopback service routing pass in build
`9e943005-ba07-4f28-989a-38c7fadc7b84`. All 17 production sources covered by the
actual database and nine-scenario browser evidence match that build. The browser
transport is scripted and does not establish live game or hosted review quality.
Combined report: `.artifacts/practice-evidence/final-report.json`.

A frozen protected preview deployment is in progress from
`.artifacts/practice-learning-preview/qualified-source`; its journal is the
authoritative handle. This section does not claim hosted readiness. Primary
execution holds and bindings remain unchanged; no live review/game/model/native
action or production promotion was performed. The full capability goal remains
unproven; broader hosted lifecycle, live coaching quality, native delivery and
other gaps in the capability table remain open.

## Status from Claude Code, 2026-10-12 (activation)

- The laptop supervisor (PID 12114) was drained with SIGTERM at 13:58 UTC while
  the journals were idle (no active builds or practices; the only upload row is
  the completed Strategist upload `08cd51ce…`). It was not restarted.
- The hosted supervisor is active: Vercel project `student-harness-worker-host`,
  `CONTAINER_POLICY_SANDBOX_HOST_ENABLED=1`, named Sandbox
  `preston-policy-workers` (session `sbx_DPKJwrKozsyY3VpfYv97dwDRIlmw`, 12 h
  lease, created 14:02 UTC) running the unchanged supervisor from commit
  `10d13ac7`. Builder sandboxes are created in the `student-harness` project
  with a token scoped to that project.
- Root cause of the first activation failure: Vercel's system variable
  `VERCEL_PROJECT_ID` shadowed the configured builder project. Fixed by reading
  `CONTAINER_POLICY_VERCEL_PROJECT_ID` in the host and forwarding it to the
  sandbox as `VERCEL_PROJECT_ID`.
- No journal row, hold or submission was changed. Real journal processing on the
  hosted path will be proven by the next student build/upload/practice.


## Practice assessment and shared evidence preview verified — 2026-10-12 14:03 UTC

READY protected preview:
https://student-harness-epafsvfcx-softmax-3ba1c1cc.vercel.app
(`dpl_ATzbtcnxFD42rSMhtXc9Lyx4B9kJ`). All856 uploaded paths match qualified
build9e943005; frozen source SHA256
`3170e545bc25a096b6d47c82982a395fd2feb03d06405cbadd9bb5a3c46ab9d1`.
This preview includes completed practice → human study assessment and the shared
verified practice evidence reader for chat/voice. It supersedes the preceding
section's in-progress deployment status.

Twelve routing checks pass; authenticated runtime ownership, exact recovery
origin, generic-learning enablement and prior13-event completed-chat reads pass.
The new practice preparation endpoint returns authenticated404 for a missing
practice,400 without its ID and anonymous401, all no-store. Study/review/findings
guards also pass. The selected live league has no studies: populated assessment
and chat/voice evidence remains the local browser and actual disposable-database
qualification described above, not live game/model/audio proof. Background work
remains held. No primary schema/control writes, live model/game/native actions
or production promotion occurred. All qualification processes exited cleanly.

Evidence: `.artifacts/practice-learning-preview/{build-source-match.json,deploy/journal.jsonl,routing.jsonl,readback.json,hosted-practice.json}`.
Full capability goal remains unfinished; the capability table retains its open
requirements.


## Cross-game evaluation exports — qualified locally, 2026-10-12

Selected study entries can now become reviewed evaluation cases in webDiplomacy
and other enabled games as well as GoTA. Account, league and study scope are
retained through the page and export route. Selected metadata reads share one
deadline and exclude private replay notes, source and full practice receipts.
Practice availability stays unknown. Automatic desktop aliases are deduplicated;
explicit references survive. Downloaded pretty JSON is limited to 256 KiB, matching
the offline assessor. Changing account, league or study resets review state.

Evidence: `.artifacts/generic-evaluation-export/final-report.json`. 37 focused
tests, eight actual disposable PostgreSQL/PostgREST tests, seven headless browser
scenarios and independent review pass. Build `70e605a6-5441-4f74-85cc-fce8bfa52144`
passes Next/Eve compilation and loopback routing. All evidence production hashes
match that build. Temporary services were cleaned. No primary writes, migration,
live model/game/native action or hold/binding change. The existing protected
preview predates these exports; this is local qualification. Full goal remains
active. Subsequent readiness guidance, regression corpus and study paging work
is separate from this frozen qualification.


## Assessment readiness, offline regression and older studies — local, 2026-10-12

Evaluation previews now show the exact latest selected Preston answer and local
assessment readiness. Missing answers, omitted corrections and later selected
context have concrete explanations; source-only files remain downloadable after
review. Ready examples remain ungraded. No provider path was added to the UI.

The new `npm run check:learning-corpus -- --manifest FILE --output NEW_FILE`
checks up to 50 reviewed local cases against supplied human expectations. It
binds saved assessments to case/target/contract/prompt digests, revalidates exact
citations and recomputes judgments. Missing, failed and invalid reports cannot
pass as model results. Input sizes and regular-file reads are bounded; symlink
escapes, FIFOs, input overwrite and existing outputs are rejected. Summaries
contain counts and source fingerprints without case text. Labels, report origin
and semantic correctness remain unverified; this is not agent replay or training.

Completed-practice assessment now offers explicit Older studies. Account/league/
active filters precede 50-row keyset pages; timestamp ties use the study ID.
The UI retains at most 200 options before batch replacement and pins the selected
study. Failed pages, unsent reasoning and original uncertain-save bodies/keys
survive retries/reloads. Predictions keep their independent cursor. Concurrent
edits can move studies between pages; this is current browsing, not a snapshot.

Combined evidence: `.artifacts/learning-regression-progress/final-report.json`.
Nine actual disposable database tests, nine export-browser scenarios, eleven
practice-browser scenarios, seven paging tests and five corpus tests pass. The
CLI rechecked eight previously saved synthetic cases, including four original
model assessments, without inference. Independent review and TypeScript pass.
Next/Eve build `32d69e81-59f4-4b87-9997-4071cb584736` and loopback routing pass;
all evidence production hashes match it. Temporary services are cleaned.

These changes are local, not included in the last protected preview. No primary
write, schema migration, live model/game/native effect, execution-hold/binding
change or production promotion. Full capability goal remains active; hosted
lifecycle recovery, broader model/coaching quality and native delivery remain
open in the capability table. Claude still owns hosted policy workers.

## Status from Claude Code, 2026-10-12 (IDE navigation)

User request: better navigation in the IDE and a way to look into Preston's
brain. Added `components/navigation/` (destinations list, `SiteNav`,
`PagesMenu`) and two one-line insertions in shared files: `app/layout.tsx`
renders `<SiteNav/>` (it returns null on `/`, so the workspace shell is
unchanged), and `components/student-app.tsx` renders `<PagesMenu/>` in the
header after the mode switch. The destination list is the single source for
both surfaces: Work (Workspace, Lab via `?view=lab`), Preston's brain (Shared
memory, Learned procedures, Updates), Computers (Browser, Desktop), Account
(Connections, External sources, Usage, Settings). Existing ad-hoc
"← Workspace" links on secondary pages were left in place.
Also removed the duplicate local header (brand + "Back to workspace") from
`components/user-settings.tsx`, since the site navigation now provides both.


## Ongoing delivery isolation and exact procedure continuity — 2026-10-12

The previous goal turn was progress (cross-game evaluation exports, offline
regression checks and older-study browsing). This turn fixes two continuity gaps.
Research wake control failures and task lookup/receipt failures no longer abort
the remaining claimed batch. Each item retains existing attempt/lease behavior;
foreign-runtime claims remain untouched. Failures are aggregated after processing
later items, and saved retry diagnostics are sanitized. No within-pass resend.

Learned procedures now return exact active and explicitly requested historical
versions separately from the newest 20 history rows. Chat and signed voice no
longer lose the human-selected version after many drafts. Exact owned version
links fail closed instead of substituting another draft. Current source lessons
resolve under the shared ten-second read deadline. UI selection rejects stale
refreshes, resets trial judgment and hydrates the selected source before revision;
a corrected source can be repaired using another current lesson.

Qualification: 25 focused scheduler tests, 16 procedure tests, TypeScript and
headless GoTA/webDiplomacy workflows pass. Five real disposable PostgreSQL/
PostgREST tests cover 25 newer drafts, distinct archived source lessons, discovery,
HTTP, signed voice, corrections and foreign scope. The actual production-compiled
cron completes two automatic minute ticks across SIGKILL/process replacement,
three synthetic tasks and one research completion, with injected control/lookup/
receipt failures and foreign-owner claims. Earlier diagnostic callback-binding
failures remain recorded as failed fixtures; the final run uses Eve's documented
session initiator attributes. All temporary services were cleaned.

Evidence: `.artifacts/companion-continuity-progress/local-report.json`. Next/Eve
build `94604251-9429-4613-96c9-34e3a8f1a0ab` and loopback routing pass. Applicable
production fingerprints match the build. The database report also fingerprinted
two unexecuted frontend files subsequently fixed; current frontend qualification
is the final browser/page tests and build, not that earlier database fingerprint.

A frozen protected-preview upload is in progress under
`.artifacts/learning-regression-preview/deploy-after-refresh/journal.jsonl`. The
first attempt failed before creation because the CLI token expired; existing CLI
authentication refreshed successfully. No primary writes, migration, account
hold/binding changes, live model/game/native actions or production promotion.
No claim of hosted cron delivery or in-flight recovery follows from local cron
evidence. Full goal remains active. Next identified gap: procedure applicability
only has free-text scope; current evidence availability does not compare current
game release/manifest/source with saved procedure evidence. That needs a shared
explicit matching/different/unknown projection before claiming safe reuse across
release changes. Broader hosted lifecycle and native delivery remain open.


## Learning and procedure continuity preview verified — 2026-10-12 14:54 UTC

READY protected preview:
https://student-harness-mbtsqk78q-softmax-3ba1c1cc.vercel.app
(`dpl_G4esbA6faFvEb29U41TtZHj2qwb1`). All 863 uploaded paths match qualified
build `94604251-9429-4613-96c9-34e3a8f1a0ab`; frozen SHA256
`f3134b699d6f4190d6dc987072e354255553298e51e94df308e76c42fcc7fe11`.
Includes cross-game evaluation exports/readiness, offline corpus command, older
study browsing, per-item scheduler isolation and exact active/historical
procedure retrieval. This supersedes the preceding upload-in-progress status.

Twelve routing checks pass. Authenticated runtime owner, runtime scheduler role,
generic learning and exact recovery origin are verified, and the existing
13-event completed chat remains readable. Skills, study/review/findings and
practice reads retain scope and anonymous guards. Invalid explicit procedure
versions and incomplete study cursors return 400/no-store. The selected live
league contains no studies or skills; populated behavior remains the actual
disposable-SQL and local headless qualification, not live model or hosted job
proof. Execution is still held. No primary control/schema writes, task/model/game/
native actions or production promotion. All deployment/readiness handles exited.

Evidence: `.artifacts/learning-regression-preview/{build-source-match.json,deploy-after-refresh/journal.jsonl,routing.jsonl,readback.json,hosted-learning.json}`.
The first `deploy/` journal records a preflight failure with no creation, followed
by normal existing CLI credential refresh. The later journal owns the only new
deployment. Full capability goal remains active with the broader unresolved
requirements in the table above.


### 2026-10-12 — procedure release comparison
Codex added a separate exact-version release comparison to learned procedures;
backend, UI and independent resolver/review agents are finished. Current evidence
availability is unchanged. Fully verified pinned evidence can compare against the
selected league’s authenticated manifest; missing/mixed/corrected evidence stays
unknown and current policy-source compatibility is explicitly unknown. No SQL
migration or primary mutation. 36 focused, 6 disposable SQL, 10 UI cases and both
league procedure workflows pass. Build/preview progress is recorded under
`.artifacts/skill-release-progress/report.json`. Claude still owns hosted policy
workers. No Electron/native launch, live model/game action, hold change or
production promotion. Full goal remains active.

Release comparison preview READY and read-only verified:
`dpl_6XePLgiVR4t1evchmjuDStSJJ8M4`,
https://student-harness-lau564sg3-softmax-3ba1c1cc.vercel.app.
Build `4b703642-5f8c-4410-af67-b78873c7f884`; 866 uploaded paths match it.
Runtime owner remains `preview:65aedf69-72df-44dd-a591-d8c50e509479`, role runtime,
recovery origin matches, existing completed session readable, execution held.
All handles exited. Next gaps: verified selected policy-source context,
semantic/coaching-quality evaluation and broader hosted/native lifecycle proof.
Do not duplicate the original submitted Strategist or enable live work.


### 2026-10-12 — conversation evaluation and inbox account isolation
Codex backend, workspace UI and independent review work finished. Conversation
cases select original durable events, pin a completed answer, redact reviewed
excerpts and download locally. They reuse the offline assessor/corpus with a
separate contract; no session replay or provider/training authorization is implied.
Inbox paging/read receipts now fence account switches and late responses.
34 conversation tests, nine inbox tests, ten export browser cases, six inbox
account cases and two existing browser regressions pass; TypeScript and isolated
Next/Eve build pass. Reports: `.artifacts/conversation-evaluation-progress/`.
The frozen protected preview source matches build
`1429a29e-f8e2-473e-a480-0cd8b259b0b9` (873 paths). Deployment/readiness pending
in that report. Claude still owns hosted policy workers. No live work was enabled,
no primary writes or native launches occurred, and the full goal remains active.


Conversation evaluation preview READY and read-only verified:
https://student-harness-7kpzxj21b-softmax-3ba1c1cc.vercel.app
(`dpl_G26FizJoD5mx41HT7N1DtCUaMUWp`). All 873 uploaded source paths match the
qualified build; frozen SHA256
`198c34ca06c75895115acdd38ee89415a7491337ab1bb083dfe53ec4061471e5`.
Twelve routing checks, authenticated runtime configuration, exact recovery origin,
the existing completed 13-event session, conversation anonymous/missing/invalid
scope guards and account-discriminated inbox reads pass. Populated conversation
export remains local fixture proof. Execution stays held; no production promotion
or primary writes. Deployment and readback handles exited. Evidence:
`.artifacts/conversation-evaluation-progress/report.json`. Full goal remains active.


### 2026-10-12 — explicit saved-source comparison
Codex added exact owned saved revision comparison to learned procedure versions,
with the same read-only operation available to chat and signed voice. BASIC bytes
and release-scoped container bundles remain distinct identity types. Existing
activation/reuse authority is unchanged. Missing/unpinned/mixed/corrected evidence
stays unknown. Root actualSQL8, independent actualHTTP6, UI8 and releaseUI10 pass;
backend/tool regressions and typecheck pass. No new migration/primary/native/model
effects. Progress/build/preview evidence: `.artifacts/skill-source-progress/`.
Claude still owns hosted policy workers; do not duplicate original Strategist or
enable held work. Full capability goal remains active.
Follow-up (user): "Preston's Lab" removed from the navigation destinations
(it is the workspace); the shell's own Workspace/Lab mode switch is untouched
and is Codex's to retire. Added history back/forward carets, the Softmax
brandmark (`public/brand/softmax-mark.svg`, inlined in
`components/navigation/brand-mark.tsx`) in both the site nav and the shell
brand, and a desktop variant: inside Electron (user agent) the nav drops the
wordmark since the title bar already carries it.


Saved-source comparison preview READY and read-only verified:
https://student-harness-hm0e2fgas-softmax-3ba1c1cc.vercel.app
(`dpl_7yQdVzsmCMk1wEiyPbaXV9Hsrt2W`). 877 uploaded paths match build
`970252eb-f4c0-42d8-831c-2c06bde16650`; source SHA256
`2f6f1cc0c28db8d53823bb82d992cf75cbb5341cfe3f34ead34830d233fde364`.
Routing, runtime identity/recovery, prior completed session, bounded owned source
metadata list and invalid/anonymous source guards pass. Populated source comparison
is actual disposable database proof, not a hosted model trial. Execution remains
held. All handles exited; no production promotion. Full goal active.
The user subsequently emphasized app-wide game independence; the next work audits
and removes remaining shared-path GoTA assumptions while retaining real adapters.
Follow-up (user): the shell's Workspace / Preston's Lab mode switch is removed
from `components/student-app.tsx` (the `labMode` state and lab tab strip remain
for sessions opened from History or Updates; the brand link returns home). The
site nav now shows Workspace plus one dropdown per group instead of inline
sections. Desktop: the title-bar "+" is now "New workspace" (`desktop/app/
shell.html`, `shell.js`, `main.cjs` action `new` and File → New Workspace ⌘N),
loading the app home at "/"; "Open Recording…" stays on the File menu and the
offline page. Desktop changes are syntax-checked only; Electron was not launched.
Aligned with the new root routing (`/` = game library, `/?league=` =
workspace): the nav's Work group is Games plus Workspace when a league is
known; the desktop "+" keeps the current league when opening a fresh workspace
and otherwise opens the game chooser.
