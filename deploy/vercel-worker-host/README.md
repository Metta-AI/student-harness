# Vercel-hosted policy worker supervisor (interim)

A separate, tiny Vercel project (`student-harness-worker-host`, Softmax team)
whose only job is to keep one named Vercel Sandbox running the existing
supervisor `scripts/container-policy-service.mjs` from a pinned public commit,
so the build, upload and practice workers no longer depend on a laptop. All
Softmax deployments use Vercel; this is the hosting path for the workers.

Nothing in this project admits, cancels or retries policy operations. The
workers inside the sandbox are the unchanged SQL-journal workers; SQL leases
and original operation IDs stay the authority.

## How it works

- `vercel.json` schedules `GET /api/host` every ten minutes (production only).
- `ensure` (default action): with `CONTAINER_POLICY_SANDBOX_HOST_ENABLED=1`,
  `Sandbox.get` by name. Running: leave it. Stopped/failed/absent: delete the
  stale one and `Sandbox.create` with `source: git` at
  `CONTAINER_POLICY_HOST_REVISION`, a 12-hour timeout, 2 vCPUs and the worker
  environment, then run provisioning detached: `python3` check, `npm ci
  --omit=dev --ignore-scripts`, `node scripts/container-policy-service.mjs
  --duration-minutes=700`. The supervisor exits before the sandbox deadline; the
  next tick creates a successor. Expect a gap of up to ten minutes plus a few
  minutes of `npm ci` between generations.
- `status`: sandbox identity, status and the last whitelisted supervisor JSON
  lines (`container_*_pass`, `container_worker_exit`).
- `POST ?action=stop`: SIGTERM the supervisor, wait up to 135 s for it to drain
  its children, then stop and delete the sandbox.

All calls require `Authorization: Bearer $CRON_SECRET`; Vercel adds it to
cron invocations automatically.

## Environment (set on the worker-host project)

| Variable | Value | Set |
| --- | --- | --- |
| `CONTAINER_POLICY_SANDBOX_HOST_ENABLED` | `0` until the laptop supervisor is drained | yes (`0`) |
| `CONTAINER_POLICY_HOST_REVISION` | commit of the source snapshot branch `claude/container-policy-worker-hosting` | yes |
| `CONTAINER_POLICY_PRACTICE_WORKER_ENABLED` | `1` | yes |
| `POLICY_ARTIFACT_BUCKET` | existing private bucket | yes |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET` | production values; the sealing key must be the existing one | yes, sensitive |
| `CRON_SECRET` | random 64 hex | yes, sensitive |
| `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` | `team_A0VDEQRuESCZXJg6oNKCradT`, `prj_SNS0px93Qf5FmIY8tZds4IKcZuQu` (the student-harness project that owns builder sandboxes) | yes |
| `VERCEL_TOKEN` | **missing**: a scoped Vercel access token for the Softmax team. Used by this function for the host sandbox and by the workers for builder sandboxes, so builders stay in the student-harness project where in-flight journals expect them. | no |

`CONTAINER_POLICY_HOST_USE_OIDC` and `CONTAINER_POLICY_HOST_NAME` exist only
for the bounded fixture and must never be set in production.

## Security note

The worker credentials (Supabase service role, the
sealing key and the Vercel token) live inside a Vercel Sandbox VM, and that VM
creates further builder sandboxes with the same token. The repository design
otherwise keeps credentials out of VMs; this host is the accepted exception. The sandbox has full egress; the worker
code only contacts Supabase, the artifact bucket, the registry and Vercel.

## Verification

`node --env-file=.env.local tests/runtime/vercel-worker-host-live.mjs --live`
(from the repository root) creates one uniquely named 15-minute sandbox with
fake worker credentials, proves the pinned checkout, Python, dependency install
and supervisor start, then drains, stops and deletes it. Reports land in
`.artifacts/vercel-worker-host/<run>/report.json`. It never contacts a journal.

## Deploy, enable, roll back

```sh
cd deploy/vercel-worker-host
vercel deploy --prod --scope softmax-3ba1c1cc
# status
curl -s -H "Authorization: Bearer $CRON_SECRET" "https://<deployment>/api/host?action=status"
```

Enable: add `VERCEL_TOKEN`, drain the laptop supervisor (`kill -TERM` the
`container-policy-service.mjs` process and wait for exit), set
`CONTAINER_POLICY_SANDBOX_HOST_ENABLED=1`, redeploy or wait for the next tick.

Roll back: set the flag to `0`, `POST ?action=stop` (drains the supervisor,
then stops and deletes the sandbox), and if local processing is wanted again,
restart the laptop supervisor from the repository root:

```sh
node --env-file-if-exists=.env.local scripts/container-policy-service.mjs --duration-minutes=1440
```

Rollback never deletes journals, retained objects, builder sessions or account
holds. Never run the laptop supervisor and the hosted one at the same time.

## Handoff from the laptop supervisor

1. Record pending journal rows (builds, uploads, practice) by ID. Do not cancel.
2. `kill -TERM $(pgrep -f 'scripts/container-policy-service.mjs')`; it drains
   its children for up to 120 s and exits 0. Do not start another local one.
3. Set `CONTAINER_POLICY_SANDBOX_HOST_ENABLED=1` on the worker-host project and
   call `GET /api/host` with the cron secret (or wait for the next tick).
4. Confirm `?action=status` shows the sandbox `running` and recent
   `container_*_pass` lines, and that the rows from step 1 kept their IDs and
   advanced without duplicates.

If the hosted result is ambiguous, inspect the journals first; SQL leases and
original operation IDs are the authority. Never start a laptop supervisor to
compensate.
