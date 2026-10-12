# Independent container workers

This chart packages the existing SQL-journal workers on the same Kubernetes
hosting pattern as Metta's orchestrator workers. It is **not deployed**. Defaults
render no resources; enabling rendering still leaves zero replicas. There is no
Temporal workflow, extra scheduler, web server, native desktop, or Docker daemon
inside the service. Policy builds continue in their original Vercel Sandbox.

The image contains Node24, Python3, the production dependency lockfile, actual
worker/import graph, `league.json`, and pinned-at-admission worker assets. The
Dockerfile-specific allowlist excludes `.env*`, local artifacts, credentials,
node_modules, and the desktop app from the build context. Runtime runs as uid1000
with read-only root and a bounded temporary volume. Durable archives and operation
identities remain in Supabase, never in the pod filesystem.

## Ownership and publication

`Metta-AI/student-harness` owns image CI and this chart. The manual-only
`.github/workflows/container-policy-worker.yml` builds and qualifies the image
with network disabled. Its default invocation only qualifies; `publish=true`
explicitly enables GHCR publication after qualification succeeds. The fixture runs
against the immutable local image ID, and publication tags and pushes that exact
image without rebuilding. The summary records the qualified image ID and, when
published, its registry digest. It never deploys. Invocation requires these files
to be committed and available in GitHub Actions.

For a separate headless qualification before CI publication, run
`node --env-file=.env.local tests/runtime/container-policy-image-live.mjs --live`.
This explicit opt-in creates one named Sandbox with a20-minute provider lease,
transfers only the Dockerfile source allowlist, verifies its hashes, and runs the
same image fixture with network disabled and fake credentials. The SDK receives
provider credentials only on the control plane; they are never copied into the
VM. Reports retain the source hash, immutable image ID, and confirmed Sandbox
shutdown under `.artifacts/container-policy-image/`. It never publishes or deploys.

Metta owns cluster registration in `devops/app-manifests/values.yaml`. That
repository already supports custom `source` chart paths; a reviewed ArgoCD
Application can pin this repo's chart at an exact revision in a dedicated namespace.
Use the existing `prod-apps` nodes and `aws-secretsmanager` ClusterSecretStore.
Do not add these jobs to the existing Temporal ladder worker: its platform league
round ownership is independent of these account-owned build/upload/practice
journals. Do not add another Eve cron for these jobs either.

The deployment uses `Recreate`, one replica maximum, and 150 seconds for SIGTERM
shutdown (the existing supervisor drains children for up to120 seconds). The
supervisor renews bounded child processes and exits after24 hours; Kubernetes
restarts it. SQL leases, original command/registration identities, and exact
request bytes remain the authority after node/process loss. Recreate alone is
not a cross-worker quota or an exactly-once side-effect guarantee.

## Configuration and activation prerequisites

Provision one JSON secret separately and reference its name through ESO; never
put secret values in Helm values, image layers, or CI variables. Required fields:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: the same project as the journals.
- `SESSION_SECRET`: preserve the existing64-hex-character sealing key so stored
  student tokens remain readable. Never generate a replacement for this rollout.
- `POLICY_ARTIFACT_BUCKET`: existing qualified private bucket,32MiB object limit.
- `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`: a scoped access token and
  the original builder project/team. The provider explicitly passes these to SDK
  create/get. A missing token preserves normal managed OIDC; an explicitly set
  empty token or partial token configuration fails closed. Never deploy a copied
  local `VERCEL_OIDC_TOKEN`, which expires rather than refreshing on this host.

If GHCR remains private, supply an independently provisioned image pull secret
through `imagePullSecrets`. ESO and image registry read permissions must be verified
in the target namespace. Current source uses the canonical Supabase storage origin;
any deployment needing an alternate existing origin must explicitly preserve and
review that storage setting before activation.

1. Run image qualification, record the exact digest, and verify source revision.
2. Confirm migration readiness and read-only storage/token/provider access using
   the same account/project. Check original retained work remains accessible.
3. Prepare the Argo Application and ESO reference with enabled=true, replicas=0.
   Wait for secret synchronization; inspect rendered config without secret values.
4. Arrange a controlled handoff: drain the existing laptop supervisor, record its
   exit and original operation IDs, then activate one hosted replica. Do not run
   another laptop scheduler to compensate for an uncertain hosted result.
5. Verify all required roles produce bounded count reports, then prove recovery
   after replacing only the new worker pod using a disposable fixture and original
   durable IDs. A running Pod alone does not prove successful reconciliation.
6. Practice polling is separately controlled by practiceEnabled. This must stay
   enabled during practice cleanup even if new practice admission is disabled.
   All app admission flags in this worker remain off; workers process only already
   admitted journal rows. Changing chart settings does not grant new actions.

Secret environment rotation requires a reviewed pod restart after ESO sync.
Stopping the pod does not cancel admitted work; use the existing explicit Stop
controls when cancellation is intended. Rollback scales this Deployment to zero
and drains it before restoring the earlier worker owner; it never deletes journals,
retained objects, active builder IDs, or account holds.

## Qualification

```sh
helm lint deploy/container-policy-worker
node --experimental-strip-types --experimental-test-module-mocks --test tests/container-policy-packaging.test.mjs tests/container-policy-provider-credentials.test.mjs tests/container-policy-provider.test.mjs tests/container-policy-command-provider.test.mjs tests/container-policy-service.test.mjs
# With an already-running Docker daemon, no native application launch:
docker build -f deploy/container-policy-worker/Dockerfile -t policy-worker-qualification:local .
node tests/runtime/container-policy-image.mjs policy-worker-qualification:local
```

The image check has a bounded lease, network=none, fake credentials, three real
worker imports/discovery loops, and a SIGTERM drain assertion. It removes its
own container in finally and cannot call hosted services. It does not run games.

Current access audit (2026-10-12): the SSO user holds only `ReadonlyAccess`
on the infrastructure account `751442549699`; the `softmax` profile requests
`PowerUserAccess`, which is not assigned, so it fails `GetRoleCredentials:
ForbiddenException`. Read-only EKS access to `main` works (namespaces, pods,
deployments, logs); secrets, ExternalSecrets, ArgoCD Applications and all writes
are forbidden, and Secrets Manager listing is denied. Local Docker is not
running. GitHub repository access is available; no workflow has run because the
files are uncommitted. The exact missing permission, the pull-request based
activation path, the metta registration patch, the secret shape and the
handoff/rollback steps are in [ACTIVATION.md](ACTIVATION.md).

Headless Linux/amd64 image execution passed in a separate bounded Sandbox:
[qualification report](../../.artifacts/container-policy-image/3e8f21a2-075d-45d5-bb88-5ced7b9504ce/report.json),
image ID `sha256:661e24bbcf811094167353dfdd5a6ca148fe9ab8eb61e69fb02062c30d8fdcf8`.
All three real worker roles imported and attempted bounded discovery with network
disabled and fake credentials; SIGTERM drained successfully. Source hashes were
verified before building. The Sandbox was confirmed stopped and deleted. This
image was not published or deployed; no policy admission or game ran. A future
CI build must qualify its own exact image before optional publication.
