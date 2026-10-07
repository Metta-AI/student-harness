# Preston replay audit worker

The web app submits hosted games to Softmax. This separate service audits downloaded replay bytes against a pinned native engine and re-executes the subject's exact BASIC source, checking every recorded world hash. It never downloads a game or runs `coworld run-episode`.

## Dedicated sessions and VMs (default)

A replay request creates its own auditor session and a persistent named Vercel Sandbox microVM. Sessions appear in the left rail with their own `/sessions/:id` URL, progress history, job receipts, expandable outputs and shared evidence artifacts. They never use Preston's conversational sandbox. A campaign reuses its auditor for the same release; separate standalone parent sessions receive separate VMs. Pause/resume/cancel control the auditor, not a generic chat worker.

Apply migrations through `0034_audit_sessions.sql`. Server-side Vercel Sandbox authentication is required (`VERCEL_OIDC_TOKEN` for local development; use the SDK's supported project credentials in deployment). The sandbox receives only replay bytes, policy source, release metadata and a unique sealed worker key—not Softmax or model credentials.

`bootstrap_vm.py` installs the toolchain **inside the VM**, checks out the exact canonical engine commit and locked dependencies, verifies the Nim 2.2.10 archive digest, and registers the compiled binaries. It requires outbound access to GitHub, the OS package repositories and nim-lang.org. The HTTP worker starts first and keeps queued jobs on the persistent disk while compilation finishes. Readiness gates new study games. Immutable container digests identify equivalent public and execution-registry mirrors; changed digests and other manifest fields still invalidate the release.

The Eve minute dispatcher polls audit jobs even after their parent session ends. In local development, `npm run dev` also starts the development scheduler. Idle VMs stop after 15 minutes with no queued work and resume from their persistent files; VM timeout is 30 minutes. Model spending and hosted requests are recorded separately. Vercel compute pricing is not yet imported into the usage ledger and must not be shown as zero.

An actual hosted replay (`ereq_29e20917-c099-4d30-9bfa-60769839919d`, subject seat 2) was audited in a dedicated VM on October 6: all 28,909 world hashes, source identity, reward ledger and outcome matched. This validates that replay and release, not every future release or an entire competitive campaign.

## Manually managed worker (optional adapter)

The student harness never starts native simulation locally. Python 3.11+ and Nim compatible with the selected engine are required on a separate research host. Provide an engine checkout at the canonical source commit, and dependency checkouts matching its `coworld/dependencies.lock`. The build script verifies these identities and records binary digests; it does not clone dependencies or execute games.

```sh
python3 workers/build_engines.py \
  --engine /srv/polyworld \
  --deps /srv/polyworld-deps \
  --output /srv/preston-audit/bin/RELEASE \
  --registry /srv/preston-audit/engines.json \
  --source-url CANONICAL_SOURCE_URL \
  --fingerprint CANONICAL_MANIFEST_SHA256
```

Get the source URL and canonical manifest fingerprint from the campaign's baseline artifact. A new game release requires its own entry. Do not relabel an old binary as a new release.

Configure the worker through its process manager:

```sh
export PRESTON_AUDIT_DATA=/srv/preston-audit/jobs
export PRESTON_AUDIT_ENGINES=/srv/preston-audit/engines.json
export PRESTON_AUDIT_WORKER_KEY='a-shared-secret-from-your-secret-store'
export PRESTON_AUDIT_BIND=127.0.0.1
export PORT=8097
python3 workers/replay_audit.py
```

Use a persistent data volume, restart-on-failure process manager, and private TLS ingress. For direct adapter calls without a session scope, set `PRESTON_AUDIT_WORKER_URL` to that origin and the same `PRESTON_AUDIT_WORKER_KEY` in the web app's server environment. Normal session/campaign calls use their dedicated VM instead. Never use `NEXT_PUBLIC_` for either credential. Standalone native concurrency defaults to two; managed four-vCPU VMs start four audit workers. Set `PRESTON_AUDIT_CONCURRENCY` to override it. Apply process-setting changes after active audit jobs drain; preserve the jobs directory.

`GET /engines/:fingerprint` verifies the registered binary digests before new evaluation games are submitted. `POST /jobs` accepts replay bytes, source, seat and release identity. `GET /jobs/:hash` resumes persisted unfinished jobs after a restart. Identical inputs reuse one job. Unknown releases wait; hash mismatches fail. Pending inputs, replay, source and final receipts remain under the job directory.

Optional release-specific mechanisms can be registered under `instruments`, each with `binary`, `sha256`, and optionally `requiresSource: true`. A tool receives `--replay PATH`, `AUDIT_SOURCE` and `AUDIT_SLOT` and must emit a JSON object on its final stdout line. These instruments are operator-owned executables; agents cannot supply commands or paths. Private opponent source may be unavailable: replay decoding still works, but no subject-VM claim is made. Mechanism evidence is distinct from competitive treatment effects.

Newly built replay decoders include source-derived hero names, coordinate and time units, fort HP snapshots, subject item/draft commands, and sparse subject death/XP milestones. Timelines cap at 1,000 entries with explicit counts and truncation; they are not a complete reward-event ledger or proof of inferred intent. Cached receipts retain the decoder digest and original evidence that produced them. Active VM deadlines are renewed before expiration where the provider permits it; persisted jobs recover after a hard lifetime limit.

Verification without running a game:

```sh
python3 tests/python/replay_audit_test.py
```

This contract test uses fake executables and checks authentication, identity, persistence, engine readiness and input reuse. Each new production release still needs a known-replay audit before its results can support promotion.

Candidate preflight uses authenticated `POST /validate` with `{release, source}`. The release registry pins `validatorBinary` and its SHA-256. `native/validate.nim` includes the exact hosted BASIC compiler and host schema without importing the game entry point or advancing any game ticks. Receipts return `valid`, `sourceHash`, `release`, `compilerHash`, and compiler errors when invalid. Infrastructure errors remain retryable. The campaign records these receipts and sends invalid candidates to a repair session before any hosted evaluation.

Candidate diagnostics use a separate `candidate-prefix-probe` job identity and
registered `probeBinary`. It runs the proposed source at the recorded subject
seat while applying recorded rival commands, stopping at the first world-state
hash divergence. An unchanged source must match the full recorded prefix. Once
divergence occurs, the worker does not continue or report a counterfactual win.
The receipt is a `candidate-probe` artifact, never a full subject-VM audit and
never eligible for promotion evidence. No divergence does not prove a BASIC
branch never executed; unsuccessful or equivalent commands can leave the world
unchanged. The candidate builder's `probe_candidate` tool accepts only completed
baseline replay evidence on the same release and source, before fixtures freeze.

Probe receipts include `diagnostic_output`: the last 256 BASIC PRINT events,
each stamped with total/battle tick, total event count and truncation status.
Text events retain at most 256 bytes. Output is captured only for probes and
does not change VM work/output limits. An instrumented source has its own hash;
verify an instrumentation-only baseline against every recorded world hash
before interpreting its observations. Remove diagnostic additions and probe
the clean candidate separately before freezing. Printed labels or requests do
not prove action acceptance, damage, or competitive improvement.


The replay decoder is built with the pinned engine's `replayEvents` diagnostic
flag. `objective_effects` records effective building/fort damage and deaths with
actor/target identities (up to 10,000 entries); `subject_events` records the
selected subject's XP awards, portal lifecycle and item purchase/consumption
(up to 4,000). Counts and truncation are explicit. `xp_reconciliation` sums all
engine XP awards, including any beyond the retained cap, against initial/final
subject XP. Event `related` references the full same-tick engine buffer, not the
filtered output array. XP reward source is not necessarily kill credit. These
are omniscient replay effects; they do not establish policy visibility or a
competitive treatment effect. Verify full replay hashes, unchanged state and XP
reconciliation on known receipts whenever changing the decoder.
