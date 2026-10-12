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
