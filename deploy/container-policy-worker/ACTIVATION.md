# Activation runbook: hosted policy workers

Status on 2026-10-12: assets complete and validated; activation blocked on one
AWS permission and one metta pull request. Nothing here has been deployed.

## Verified access (2026-10-12, read-only)

Identity: the `softmaxx.awsapps.com` IAM Identity Center user for aaron@softmax.com
(valid SSO session; no login was performed).

| Account | Assigned permission sets | Consequence |
| --- | --- | --- |
| 751442549699 SoftMax Infrastructure (EKS `main`, Secrets Manager vault, ESO) | `ReadonlyAccess` only | `aws --profile softmax` requests `PowerUserAccess`, so every call fails `GetRoleCredentials: ForbiddenException`. With `ReadonlyAccess` the EKS cluster is readable: namespaces, pods, deployments and pod logs. Secrets, ExternalSecrets, ClusterSecretStores, nodes and ArgoCD Applications are not readable; nothing is writable. `secretsmanager:ListSecrets` is denied. |
| 879816410702 Softmax Staging | `ReadonlyAccess`, `PowerUserAccess` | No EKS cluster exists in this account; the stale `softmax-staging` kubeconfig context points at nothing. Not a hosting target. |
| 248471876548, 015142856185 | `PowerUserAccess` | Internal/sandbox accounts without the ESO store or the vault; not hosting targets. |

Exact missing permission: an IAM Identity Center assignment of `PowerUserAccess`
(or any permission set mapped to a cluster-admin EKS access entry plus
`secretsmanager:CreateSecret`/`PutSecretValue`) on account `751442549699` for
this user. Without it, cluster writes and secret creation must be done by the
infrastructure owner or through merged metta GitOps changes.

GitHub: `Metta-AI/student-harness` is public with push access; Actions is
enabled; no workflow has run because the workflow file is uncommitted. The
GHCR package `metta-ai/student-harness-worker` does not exist yet. Local Docker
is not running and must not be started. Vercel CLI is authenticated.

## Hosting path (unchanged from the handoff)

One Kubernetes `Deployment` on EKS `main`, namespace `student-harness`, node pool
`workload-type: prod-apps`, secret via `ClusterSecretStore/aws-secretsmanager`,
registered as an ArgoCD Application from metta's `devops/app-manifests`. The
chart is this directory; ArgoCD reads it from the public repository at a pinned
commit. There is no Temporal workflow, Eve cron or second submission service.

Everything below the image step works through pull requests. Only the Secrets
Manager value needs someone with write access on `751442549699`.

### 1. Commit and qualify the image (student-harness)

1. Commit `deploy/container-policy-worker/**`, `.github/workflows/container-policy-worker.yml`,
   `scripts/container-policy-service.mjs`, `tests/runtime/container-policy-image.mjs`
   and the worker sources the Dockerfile copies, from a reviewed source snapshot
   (see `docs/parallel-agent-handoff.md` for snapshot constraints). Push to `main`.
2. Run **Container policy worker image** with `publish=false` first. The summary
   prints the qualified image ID.
3. Re-run with `publish=true`. The summary prints
   `ghcr.io/metta-ai/student-harness-worker@sha256:…`; that digest and the commit
   SHA are the only two values the metta change needs.
4. If GitHub made the package private, either set it public in the org package
   settings or provision an image pull secret and set `imagePullSecrets` in the
   values. Metta's own services use ECR (`751442549699.dkr.ecr.us-east-1.amazonaws.com`);
   moving this image to ECR is an acceptable later change but needs AWS CI credentials.

### 2. Provision the secret (infrastructure owner)

Create one JSON secret `vault/student-harness/container-worker/env` in
`us-east-1` with exactly the keys in `secret.example.json`. The ESO controller
role already allows `GetSecretValue` on every secret in the account, so no IAM
change is needed. Preferred form, in the metta Terraform stack the owner chooses:

```hcl
resource "aws_secretsmanager_secret" "student_harness_container_worker" {
  name        = "vault/student-harness/container-worker/env"
  description = "Student harness hosted policy workers: Supabase service role, token sealing key, artifact bucket, scoped Vercel Sandbox token. JSON."
}
```

Then an operator with write access sets the value once:

```sh
AWS_PROFILE=softmax aws secretsmanager put-secret-value \
  --secret-id vault/student-harness/container-worker/env \
  --secret-string file://secret.json   # local file, deleted afterwards
```

Values: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the production
project; `SESSION_SECRET` must be the existing production sealing key (the local
key was verified on 2026-10-11 to decrypt sampled production records; the Vercel
dashboard exports a redacted placeholder for it); `POLICY_ARTIFACT_BUCKET` is
`preston-policy-artifacts`; `VERCEL_TOKEN` is a new scoped token for team
`team_A0VDEQRuESCZXJg6oNKCradT`, project `prj_SNS0px93Qf5FmIY8tZds4IKcZuQu`.
Never copy a local `VERCEL_OIDC_TOKEN`.

### 3. Register the Application (metta pull request)

`argocd/metta-registration.patch` applies cleanly to metta `main`
(`git apply --check` passed on 2026-10-12 against `86b1a3c5e0`) and renders a
valid Application through `devops/app-manifests`. Replace the two placeholders
with the commit SHA and image digest from step 1, then open the PR:

```sh
cd ../metta && git apply ../student-harness/deploy/container-policy-worker/argocd/metta-registration.patch
```

The entry keeps ArgoCD's default automated sync, so merging is the deployment.
`replicas: 0` and `enabled: true` make the first merge create only the namespace,
the ExternalSecret and a scaled-to-zero Deployment. Verify with read access:

```sh
kubectl --context softmax-main get deploy,pods -n student-harness
```

ExternalSecret health (`SecretSynced`) is only visible to someone with write
access or the ArgoCD UI; a `Pending`/`CreateContainerConfigError` pod after
scaling up means the secret did not sync.

### 4. Handoff from the laptop supervisor

The active local supervisor is `scripts/container-policy-service.mjs
--duration-minutes=1440` started 2026-10-11 19:51 local (PID discovered with
`pgrep -f container-policy-service`). It exits on its own after 24 hours.

1. Record the pending journal state (`container_policy_builds`, uploads and
   practice rows) by ID. Do not cancel anything.
2. `kill -TERM <service pid>`; the supervisor drains children for up to 120 s
   and exits 0. Record the exit. Do not start another local supervisor.
3. Open a one-line metta PR setting `replicas: 1`. Merge.
4. Confirm one pod `Running` and `container_build_pass`, `container_upload_pass`
   and `container_practice_pass` JSON lines in `kubectl logs`. Check the
   journal rows from step 1 kept their IDs and advanced without duplicates.

If the hosted result is ambiguous, do not start a laptop supervisor to
compensate. Inspect the journals first; SQL leases and original operation IDs
are the authority.

### 5. Rollback

Set `replicas: 0` in metta and merge. After the pod is gone, restart the local
supervisor:

```sh
node --env-file-if-exists=.env.local scripts/container-policy-service.mjs --duration-minutes=1440
```

Rollback never deletes journals, retained objects, builder sessions or account
holds. Secret rotation requires a reviewed pod restart after ESO re-sync.

## Validation performed here

- `helm lint`: pass. `helm template` with `enabled=true`, a sample digest and
  the ESO reference renders one Deployment and one ExternalSecret.
- `kubectl apply --dry-run=client` against EKS `main` accepted the Deployment.
  The ExternalSecret could not be dry-run checked because reading that resource
  type is forbidden for `ReadonlyAccess`; its manifest matches
  `devops/charts/disco/templates/externalsecret.yaml`.
- 24 packaging, credential, provider, command-provider and service tests pass.
- metta patch: `git apply --check` pass; `helm template devops/app-manifests`
  renders the Application with the expected source, values and destination.

## Not demonstrated

- Pod replacement against a live journal. The worker entrypoints
  (`scripts/container-policy-*-worker.mjs`, shared with Codex) construct the
  real Sandbox provider at module scope, so a disposable two-generation fixture
  needs a provider injection point first. Requested from Codex in
  `docs/parallel-agent-handoff.md`. Process-restart recovery of the real
  Strategist build, upload and submission is already evidenced in
  `.artifacts/strategist-request/README.md`.
- Laptop-off continuity. Nothing hosted runs yet.
