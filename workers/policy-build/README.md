# Hosted container policy builder

This worker packages a game policy in a dedicated remote VM. It builds a Linux
amd64 OCI archive, records its identity, and never uploads a policy or enters a
league. The gated chat build tool admits work for this backend worker; upload,
registration, practice and league entry have separate authorization.

The qualified path is the published webDiplomacy Herald example. Its Dockerfile
uses the manifest's immutable starter image in place of the example's local base
image alias. The bot source is unchanged. The qualification compiles the Python
file and checks its bytes inside the resulting image with networking disabled;
it does not launch the bot, a game, or a local simulation.

## Worker contract

Provision one credential-free VM for an admitted build. The controller's hosted
entrypoint verifies all three admitted worker-file hashes, takes an exclusive
command claim, installs Docker/buildx, records the actual toolchain, builds once,
and stops its Docker daemon in `finally`:

```sh
node worker.mjs --hosted /absolute/envelope.json /absolute/builds
```

The envelope contains `input` (the request below), `commandToken`,
`providerSessionId`, a fixed `deadlineAt`, and `workerIdentity` with
`workerSha256`, `inspectorSha256`, and `installSha256`. Its separate
`hosted-receipt.json` binds these identities to setup/build status and actual
Node, Docker, buildx and Python versions. A duplicate bootstrap returns the
original receipt; a missing receipt after a claim stays uncertain. Private
subprocess output is bounded, and cancellation stops child process groups.

For a preconfigured worker, install Docker/buildx using `install.sh`, start
Docker, and create the named builder:

```sh
docker buildx create --name policy-builder --driver docker-container --use
node worker.mjs /absolute/request.json /absolute/builds
```

The request contains:

```json
{
  "id": "<operation UUID>",
  "leagueId": "<selected league ID>",
  "coworldId": "<authoritative game ID>",
  "manifestHash": "sha256:<published manifest digest>",
  "platform": "linux/amd64",
  "dockerfile": "Dockerfile",
  "files": [{"path": "Dockerfile", "content": "<source text>"}]
}
```

The source bundle accepts at most 256 UTF-8 text files and four megabytes. Paths
must be relative, unique, and contain only letters, numbers, dots, underscores,
hyphens and directory separators, without dot or parent segments. Files are
written with mode 0644 and epoch timestamps. Binary files, symlinks, executable
mode metadata and automatic Git checkout are not supported by this contract.

`buildIdentity` hashes the sorted file paths, byte counts and SHA-256 digests
together with the game, league, manifest, Dockerfile and platform. The operation
ID is separate from the source identity. The source hash is not an assertion of
reproducible output: mutable dependencies and network reads in a Dockerfile can
still change the result. The final image and archive receive their own digests.

An exclusive claim precedes execution. The same operation/source returns its
existing receipt, including an in-progress or terminal failure receipt. An
operation ID reused for different source is rejected. A claim without a receipt
is uncertain and does not start another build. Recover by observing the original
VM and operation record; do not infer failure from a read timeout or provision a
replacement VM under another name.

The default worker deadline is four minutes, with a maximum of ten minutes.
Cancellation and command deadlines terminate the command process group. The
owner must still stop the VM and its detached Docker daemon; the VM also needs
an independent provider lease. Private logs remain in the operation directory.
Receipts expose bounded failure descriptions rather than source or credentials.

## Artifact verification and retention

`inspect_oci.py` reads the archive without extracting files or loading a container.
It verifies the OCI index, image and configuration descriptors, layer sizes and
digests, expanded layer identities, and Linux amd64 target. It bounds metadata,
entry count, layer count and expanded layer size. It rejects duplicate entries,
outer archive links and unsupported formats. This validates packaging integrity,
not game compatibility or the safety/correctness of the policy program.

The controller calls `retainArtifact` from `artifact.mjs` **outside the builder**
with the original admitted request, completed worker receipt, downloaded archive
and an account-owned destination directory. It:

1. Recomputes source identity and compares every identity field and operation ID.
2. Checks build metadata against the image receipt and bounds the archive size
   (250 MB by default; configurable up to 2 GB).
3. Streams a regular, non-symlink download into a private staging directory,
   enforcing its exact size and SHA-256 as it copies.
4. Independently inspects that staged OCI archive and compares image identities,
   layer count, image size, entrypoint and command with the receipt.
5. Atomically publishes `source.json`, `receipt.json`, `image.tar` and
   `artifact.json` under the operation UUID. The manifest binds the exact source
   and receipt JSON files to the archive and inspected image.

Concurrent identical deliveries share one published bundle. Conflicting receipts
or damaged retained files cause failure without replacing the original evidence.
Interrupted staging is removed in `finally`; process death can leave a hidden
staging directory for an owner-scoped janitor to remove later. The helper has a
two-minute deadline and never executes the built image.

This helper provides local filesystem retention outside the VM. Hosted transfer
is supplied separately by `storage.mjs`, described below. Neither is signed build
attestation. A matching receipt ties evidence to an
admitted request under the trusted builder; it cannot prove arbitrary source was
faithfully built by a compromised worker. Account ownership and trusted worker
identity must be established by the surrounding controller. The qualification
additionally checks actual source bytes inside its known example image.

## Private object storage

`PolicyArtifactStorage` uses Supabase's TUS protocol with six-mebibyte requests,
following the [resumable upload guide](https://supabase.com/docs/guides/storage/uploads/resumable-uploads).
The transport checks that the configured bucket is private before transferring
data. Object keys bind a hashed account ID, build UUID, content digest and fixed
artifact filename. Credentials stay in the controller; they are not sent to the
builder, recorded in checkpoints or forwarded to redirects/foreign upload URLs.
Uploads never overwrite an existing object.

The original qualification archive is about 74 MB. The configured storage project
rejected a 250 MB per-object bucket limit, so `retainArchive` represents an OCI
archive as immutable parts of at most six mebibytes plus `image.tar.parts.json`.
This works with an eight-mebibyte bucket limit without changing project settings.
The index records each part's key, size and digest and the original complete
archive's byte count and SHA-256. `verifyArchive` reads the index, checks every
part's account/build scope and digest, and hashes their ordered concatenation to
verify the original archive. It does not execute or extract the image.

`retain` accepts a checkpoint adapter with `load(key)` and `save(key, state)`.
The controller **must persist these checkpoints outside the builder and serialize
access under an account-owned lease**. The transport itself does not supply a
distributed lock, budget admission or scheduling. It saves a creation marker
before POST, then saves the returned upload URL before sending file data. After
an uncertain PATCH, another invocation reads the same URL's server offset and
continues there. A fully stored object can recover a lost final acknowledgement.
If POST loses its Location response, creation remains uncertain and is not
automatically repeated. Expired TUS URLs and ambiguous creation require explicit
reconciliation; the transport does not silently allocate replacements.

Every object is read back and hashed before its checkpoint becomes verified.
Existing objects are verified before reuse. A previously verified object that
disappears, a conflicting checkpoint, or corrupted stored bytes fails visibly;
the transport never overwrites the evidence. The archive index is uploaded only
after all parts verify, and a complete archive receipt is returned only after its
reconstruction verifies. Partial parts are not a completed artifact bundle.

Source, worker receipt and artifact identity JSON are retained as individual
objects. The orchestration layer still needs to persist their returned storage
receipts together with the archive receipt, then commit build completion only
after that complete set is verified. The storage client is currently internal
and not connected to the IDE dispatcher or a production bucket.

```sh
node --test tests/policy-artifact-storage.test.mjs
node --env-file-if-exists=.env.local tests/runtime/policy-storage-live.mjs --live
```

The live diagnostic uses the previously verified archive, creates one uniquely
named private bucket, verifies all stored files and archive reconstruction with a
fresh client, checks anonymous access is denied, and removes its exact objects
and bucket in `finally`. It records evidence in `.artifacts/policy-storage/`.
It creates no schema migration, VM, Softmax policy version or game.

## Verification

```sh
node --test tests/policy-build.test.mjs tests/policy-build-artifact.test.mjs
python3 tests/policy-build-oci.test.py
```

The explicit live diagnostic uses configured Vercel credentials only in its
controller, creates one remote VM with a ten-minute lease, reads public pinned
source, and cleans up its own VM in `finally`:

```sh
node --env-file-if-exists=.env.local tests/runtime/policy-build-live.mjs --live
```

It records source origins, worker hashes, toolchain versions, build receipt and
artifact evidence under `.artifacts/policy-build/<run>/`. It confirms terminal VM
state before deletion and requests orphan-snapshot cleanup. An observation error
does not authorize a second build. No foreground browser or Electron is used.

The hosted-bootstrap qualification is run
`755590c9-bb0d-487b-bd6f-cd91eff7a81a`. It verified setup, recorded the actual
toolchain, reused the original receipt on a repeated invocation, checked exact
source and Python syntax in the built image with networking disabled, and
independently retained the archive outside the builder. Provider shutdown and
sandbox deletion were confirmed. This diagnostic exercises the worker directly;
it does not qualify the database-backed dispatcher. The report records its exact
worker hashes. A subsequent CLI entrypoint guard was separately tested in an
executable bundled controller; importing the worker helpers does not launch its
CLI. The first creation attempt was rejected because its snapshot retention was
below the provider minimum; the name was confirmed absent and that unused
setting was removed for non-persistent builders.

## Rollout status and remaining enablement work

The configured primary database has the six base container migrations through
`20261012023627_container_policy_practices.sql` plus the scoped foreground-grant
migration `20261012034636_container_policy_reviewed_grants.sql`. Independent checks verified exact
checksums, service-only RPC access and RLS on the nine container tables. The
permanent private `preston-policy-artifacts` bucket is provisioned with a 32 MiB
object limit and JSON/binary MIME types; authenticated transfer and anonymous
denial were checked. Evidence is in `.artifacts/container-policy-rollout/`.
The local monitored pilot now sets `CONTAINER_POLICY_PIPELINE_ENABLED=1` and runs
an explicitly started supervisor with a 24-hour lifetime. The launch record and
log reference are in
[local-pilot.json](../../.artifacts/container-policy-rollout/local-pilot.json).
The desktop-attached Eve runtime is healthy and eligible for environment-watcher
reload; effective tool visibility is not yet directly observed. No launcher
restart occurred. `.env.example` stays off; production rollout is not claimed.

The database-backed live qualification
`de2cfb45-b301-4826-a786-fc7cfe56e50f` passed actual source/build admission, hosted
command execution, independent private retention and terminal VM shutdown. It
restored the exact 73,873,920-byte OCI archive after shutdown, then deleted the
sandbox, 16 retained storage objects and fixture records. Its report is
`.artifacts/container-policy-build-live/de2cfb45-b301-4826-a786-fc7cfe56e50f/report.json`.
This is hosted build and recovery evidence. It did not push to the real registry,
register a policy version, schedule an evaluation or enter a league.

The [compiled successful chat journey](../../.artifacts/container-policy-chat-success/1dfe2350-bea9-4417-ae84-1dcd84716bc0/report.json)
uses real disposable SQL and local platform/storage/registry fixtures to verify
source, build, upload approval, restart recovery and separate league-entry approval.
A declined submission writes nothing. No live league action occurred; the first
real registry transfer/registration remains an explicitly approved qualification.
Chat operation links expose the original revision, build cleanup and verified or
uncertain registration, with bounded refresh and Stop for the original operation.
Non-GoTA replay notes retain human observations and optional phase labels; they do
not establish game execution or coaching quality.

- The container-policy migration and `lib/container-policy/store.ts` now provide
  account/project/revision records, independently computed source identities,
  compare-and-swap revision history and build admission. Admission binds the
  revision and trusted worker file hashes, reserves one credit dollar through the
  shared daily ledger, limits an account to one build awaiting cleanup and six
  starts per rolling 24 hours, and persists a stable provider name and deadline.
  The reserve is an accounting hold, not a provider price or hard billing cap.
  These changes have disposable-database coverage and are deployed to the
  configured primary database.
- The controller must use that admission before creating compute. Only the first
  claim grants `createProvider`; retries observe the same provider name. A queued
  cancellation or expired/held queued claim can release an unspent reservation.
  After creation is admitted, cancellation retains credits and the concurrency
  slot for reconciliation. Toolchain versions are now bound to the hosted command
  receipt. A source hash is not authorization.
- Provider recovery now persists job leases, the physical VM session and terminal
  observations. It never recreates an uncertain request and does not treat a
  missing handle or accepted Stop response as confirmed shutdown. Polling is
  limited to one pass per minute with error backoff, a 75-second job lease and a
  two-hour reconciliation horizon. Explicit cleanup retry extends observation
  only; it never renews the original compute deadline. The provider adapter uses
  one `Sandbox.create` for the initial claim and `Sandbox.get({resume:false})`
  afterward, with a bounded session-history read and exact physical-session stop.
  The bounded dispatcher now uses this recovery path. Fixture/database tests and
  the live qualification above cover the admitted provider/build/retention chain.
- Migration `20261012005530_container_policy_commands.sql` now admits one command
  token for the original source, worker, physical session and deadline. Only its
  original live job can launch it. Replacement jobs observe; late handles and
  monotonic receipts preserve cancellation. A completed command moves to artifact
  retention, not successful build completion. `reconcileHostedBuild` composes
  provider recovery with this command controller. The gateway uses the bound
  physical session without auto-resume, checks authority before writes/launch,
  and reads a bounded receipt. Database, controller and provider fixtures cover
  these paths; this migration is deployed. `reconcileHostedBuild` now
  collects a completed archive during the bounded provider pass, releases that
  job, then independently verifies and transfers the artifact under the storage
  lease. Collection streams at most the declared 250 MB limit from the original
  physical session, verifies its SHA-256, and removes temporary files in `finally`.
  The archive path is fixed by the build ID, not read from the worker receipt.
  PostgreSQL timestamp precision is preserved in the command envelope.
  A replacement observes the same command and resumes original storage objects;
  a stopped or missing builder is never recreated to recover missing bytes.
- Durable account-scoped transfer checkpoints and 75-second leases now connect
  the storage transport to admitted source via `lib/container-policy/transfer.ts`.
  Each upload write renews authority; stale leases and canceled work cannot write
  checkpoints or complete a build. A fixed two-hour transfer deadline survives
  worker replacement. Completion requires verified source, receipt, identity,
  archive index and every ordered part, plus confirmed builder shutdown. These
  paths have database/HTTP coverage and the live build qualification above. The
  production private bucket is provisioned and audited; automated partial-object
  cleanup and retention remain operational work before general enablement.
- Upload through the hosted policy API with a recoverable operation identity;
  reconcile an uncertain upload before retrying. Keep upload, bounded practice
  evaluation, and explicitly requested league entry as separate operations.
- Bind active league variants/configuration and native game evidence before
  allowing experiments or claiming policy improvement.

The worker itself supplies none of these account or hosted workflow guarantees.
The admission/recovery stores, bounded dispatcher and gated chat tools supply the
surrounding workflow. Trusted terminal provider receipts can now confirm
cleanup for the bound physical session. A timeout or missing handle cannot do so.
Only the original live creation job can report that it made no provider call and
release an unspent hold. Provider shutdown with unknown cost keeps its hold;
actual provider cost settlement remains to be integrated. Terminal builds without
a durable artifact completion receipt are failed or canceled, never completed.
Supervised production rollout, automated artifact retention and durable sandbox
metadata/snapshot deletion remain operational work. The live diagnostic explicitly
cleaned up its own fixture; it does not establish general retention automation.
Collection currently relies on the
original VM remaining available until the archive has been downloaded. If both
the VM and an incomplete transfer's missing bytes are lost, the controller cannot
claim success or silently rebuild; an explicit new build is required.

Run its source/admission checks without a primary database or cloud compute:

```sh
node tests/runtime/container-policy-db.mjs
```

The runner applies the full migration chain to a private Unix-socket PostgreSQL
instance, exercises real concurrent connections, shared budgets, transfer leases,
completion/cancellation and the controller with a local HTTP TUS server, then
stops and removes the instance. The controller test transfers a synthetic OCI
fixture and recovers a lost acknowledgement; it does not execute the image or
call a live cloud provider. Set `POSTGRES_BIN` if the PostgreSQL binaries are
not at the runner's default macOS Homebrew location.

The collection integration test uses the production provider-recovery, command,
collection and transfer controllers with actual PostgreSQL and HTTP storage;
provider IO is replaced with a fixture stream. It covers a lost upload response,
replacement observation without another command, independent archive inspection,
release of the provider job before storage IO, Stop during collection, cleanup of
temporary files, and observed shutdown before successful build completion. It is
not a live cloud dispatcher qualification.

## Registry transfer and recovery

`registry.mjs` implements controller-side OCI distribution transfer from the
verified archive. `registry_layout.py` independently inspects the OCI archive and
reports byte ranges without extracting files or running the policy. Sparse tar
members are rejected because their logical bytes are not contiguous upload ranges. The registry
client verifies archive, manifest and configuration identity before requests,
then transfers bounded chunks with a required checkpoint/authorization adapter.
Its protocol follows the [OCI Distribution specification](https://github.com/opencontainers/distribution-spec/blob/main/spec.md).

Only the platform-returned ECR repository/tag is accepted (loopback is supported
for tests). Authentication stays in the controller; redirects and foreign upload
locations are rejected. Blob digests and sizes are checked at the destination;
the final tag is read back and hashed. A replacement uses the saved upload URL
and registry offset after an uncertain chunk. Lost blob or manifest completion
responses are reconciled by content identity. Ambiguous creation, an unknown
empty-upload offset, and a missing manifest after uncertain publication remain
uncertain rather than silently allocating or publishing again. An existing tag
for another image cannot be overwritten.

This transport is wired to durable account/build-scoped SQL checkpoints and
leases. Tests cover both an in-memory adapter and actual PostgreSQL journals with
local HTTP storage/registry fixtures. The registration controller has one-send
intent and uncertain-receipt recovery tests, but real registry transfer and policy
registration remain unqualified. Registry transport alone does not register a
policy version or enter a league. `storage.restoreArchive` reconstructs the exact archive from
private stored parts after the builder is gone, into a private exclusive file.
A combined HTTP test deletes the original archive, restores it from storage, and
pushes the same manifest and blobs through the registry transport.

`lib/container-policy/dispatch.ts` provides bounded account/league dispatch pages
with two concurrent controllers. SQL claims remain authoritative for exclusion,
one-minute cadence, Stop and backoff; the process map only shares concurrent calls.
The explicit build and upload workers enumerate bounded account scopes; archive
transfer can outlive a short web request. The local pilot admission flag is enabled;
worker scheduling remains explicit and is not attached to UI/development startup.

The supervisor is available from the repository root with Node 24 or later and
Python 3:

```sh
node --env-file-if-exists=.env.local scripts/container-policy-service.mjs --duration-minutes=1440
```

Configure the Supabase URL/service key, `POLICY_ARTIFACT_BUCKET`, a 64-hex-character
`SESSION_SECRET` and hosted-provider authentication in the server environment.
Startup validates storage configuration and the Python verifier dependency. The
service defaults to a 24-hour scheduling lifetime, accepts 1–1440 minutes, and runs
one child per worker role with generations of at most 120 minutes. It restarts
only after the old child closes, with at least one minute between generations and
error backoff capped at 15 minutes. SIGINT/SIGTERM stop scheduling and allow two
minutes for receipt draining before killing a stuck local process group. SQL leases
remain authoritative; local process restarts never grant another registration send.
A host process manager must restart the bounded service after exit. Starting it
does not enable the chat admission flag. General rollout remains gated on the
remaining operational and live registration checks above.

## Practice worker

`CONTAINER_POLICY_PRACTICE_WORKER_ENABLED=1` adds one supervised practice worker;
`CONTAINER_POLICY_PRACTICE_ENABLED=1` separately exposes new chat admission. Keep
the worker running when new admission is disabled so original jobs can reconcile.
The local pilot's three-worker supervisor and migration evidence are recorded in
`.artifacts/container-policy-practice-rollout/local-pilot.json`.

The worker reads one bounded page of due journal rows, with at most two controller
passes in flight. SQL owns exclusive leases, minute cadence, account holds and
fixed deadlines. Requests use immutable exact bytes/key; retries never select a
new version or game. Stopped unknown-ID jobs cannot POST. Known jobs can cancel
and retain terminal receipts until the cleanup deadline. Unknown measured cost
is not zero; platform cancellation is not independent pod-shutdown evidence.

Run the disposable SQL/HTTP qualification with
`node tests/runtime/container-policy-practice.mjs`; compiled chat approval and
restart qualification is `node tests/runtime/container-policy-practice-chat.mjs`.
Both use local fixtures and create no live game.


## Reviewed foreground execution while background work is held

Each reviewed build, upload or practice admission records a private grant for
that one operation. It binds the account, trusted foreground session, immutable
operation scope, current execution-control timestamp and original deadline.
Admission locks account → execution control → operation; an existing hold is
never cleared. Another Hold changes the generation and revokes previous grants.
An idempotent retry cannot extend a grant or attach approval to old unreviewed
work. Build approval does not authorize upload, registration, practice or league
entry. Shared credit reservations and per-operation Stop remain authoritative.

Provider creation/recovery, build commands, artifact transfers, registry work,
registration and practice requests check their own operation's authority before
effects. Late receipts remain durable after Stop, and known practice requests can
still reconcile or cancel within their cleanup deadline. An unknown stopped
practice cannot replay its POST. Ordinary unreviewed admission stays blocked when
the account is held.

`20261012034636_container_policy_reviewed_grants.sql` was selectively applied to
the configured primary database. Its [apply receipt](../../.artifacts/strategist-request/migration-apply.jsonl)
and [independent ACL audit](../../.artifacts/companion-readiness/reviewed-container-primary-verification.json)
record ledger count 79, checksum identity, service-only public invoker RPCs, and
private grants with RLS and no service-role direct writes. The helper
`scripts/container-policy-reviewed-migrate.mjs` defaults to transactional DDL
validation followed by rollback; only explicit `--apply` commits its single
allowlisted migration after checking every applied checksum.

Run `node tests/runtime/container-policy-reviewed.mjs` with a matching read-only
ledger snapshot to replay the deployed migration subset in disposable PostgreSQL.
The [qualified run](../../.artifacts/container-policy-reviewed/95e93f18-7f9d-4004-89cd-3e46abe3ee1f/report.json)
passed 29 tests covering held operation execution, revocation, retries, account and
league boundaries, credit checks, leases, and uncertainty. The
[compiled held-account chat test](../../.artifacts/container-policy-chat-success/5b0d5e53-fdcd-4bda-8ab1-47bf4fe1e021/report.json)
also passed approval recovery across process restarts using local transport and
platform fixtures. No live registry registration or league entry is established
by these tests.


## Expired registry transfer recovery

The registry client accepts ECR PATCH `201` only with an exact `bytes=0-N`
acknowledgement range and trusted continuation URL. It still requires final
commit and independent content-digest verification. A saved blob
upload URL returning 404 permits a fresh digest HEAD; only another 404 can request
`container_policy_upload_blob_restart`. The active lease, exact old location and
immutable blob identity must match. SQL retains the original checkpoint and
atomically grants one replacement creation per exact acknowledged resource,
capped at three replacements per original blob. A lost RPC or replacement
POST acknowledgement leaves uncertainty and cannot authorize another POST.
No new build, image, policy registration grant or deadline is created.

Migration `20261012041023_container_policy_blob_restart.sql` is selectively applied
([receipt](../../.artifacts/strategist-request/blob-restart-apply.jsonl), ledger 80).
The [57-test disposable SQL/transport run](../../.artifacts/container-policy/database.log)
includes PATCH `201`, two sequential expired URLs under one original image,
and repeated retries after a lost replacement acknowledgement. Migration
`20261012041456_container_policy_blob_restart_bound.sql` adds the bounded
per-resource rule while preserving all previous checkpoint audit entries
([apply receipt](../../.artifacts/strategist-request/blob-restart-bound-apply.jsonl),
[25 SQL tests](../../.artifacts/container-policy-blob-restart-bound/065a8a70-84d6-4c76-90b1-44817395c1b3/report.json)). The
[compiled chat fixture](../../.artifacts/container-policy-chat-success/39fae0ea-7137-4aac-ae71-fca3093e8d5f/report.json)
also passes this recovery while the account remains held, with one builder and one
registration. It verifies durable minute-spaced waiting through normal shutdown
and automatic progression to upload approval. All external services in that
fixture are local; these results do not establish a live league submission.

The platform's scoped push credentials can deny manifest GET while allowing
publication. Only the owned container controller supplies `verifyPublication`:
it calls Softmax completion for the original image ID, then checks the returned
client hash and actual server-resolved registry digest against the admission.
Registry `403` means unreadable, not missing. First publication records intent
before one PUT; existing intent uses verification only. A lost response, missing
manifest or wrong digest never permits another PUT or policy registration.
Readable GET mismatches still fail, and the lease/Stop checks surround the
callback. The generic registry client without this trusted callback remains
strict. This adapter adds no migration.
