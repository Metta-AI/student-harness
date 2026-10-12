# Claude Code workstream: independent policy worker hosting

## Objective

Make the existing hosted policy build, upload and practice workers continue when
the user's laptop sleeps or disconnects. Implement and qualify this workstream;
do not stop at architecture recommendations. Codex owns chat orchestration and
the broader companion integration. This workstream concerns policy workers,
not migration of Eve chat/research Workflow storage.

Read `AGENTS.md`, `README.md`, `docs/runtime-ownership.md`,
`docs/companion-implementation-status.md`, and
`deploy/container-policy-worker/README.md` first. The wider product design is
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

Own `deploy/container-policy-worker/**`,
`.github/workflows/container-policy-worker.yml`,
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
