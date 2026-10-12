# Softmax desktop prototype

A small Electron client for the existing hosted workspace, plus an offline recording viewer.
The Next/Eve backend stays separate. The app does not bundle server secrets or run games locally.

## Run

From the repository root, install the separate desktop dependencies:

```sh
npm --prefix desktop ci
npm run desktop:dev
```

`desktop:dev` connects to an existing harness on localhost:3000 or starts the normal Next/Eve
development stack. If it starts that stack, quitting Electron also stops those child processes.
It never stops a server that was already running. On macOS use **Softmax → Quit** to quit;
closing the window leaves the app available in the Dock.

To connect without managing the server:

```sh
npm run desktop
```

To use a different local port or the hosted deployment:

```sh
SOFTMAX_DESKTOP_URL=http://localhost:3001 npm run desktop:dev
SOFTMAX_DESKTOP_URL=https://ide.softmax.com npm run desktop

Packaged builds default to the hosted Vercel server
(`https://student-harness-seven.vercel.app`); development builds default to
`http://localhost:3000`. `SOFTMAX_DESKTOP_URL` overrides either. User data lives in
`~/Library/Application Support/Softmax IDE` (an older "Softmax Prototype" folder is
moved there once on first launch).
```

Sign in through the workspace using your Softmax team token. The app has its own persistent
browser session; it does not import browser cookies. HTTPS is required except on loopback.
Authentication and research authorization continue to be enforced by the backend.

## Included

- A compact native window with Workspace / Recording switching, back, reload, fullscreen,
  zoom, and native menus. Window placement and the last workspace route survive relaunches.
- The current workspace, including its hosted replays, Preston voice, and research tools.
- Native file selection for MP4, WebM, MOV, and M4V recordings. Playback depends on the actual
  codec; H.264 MP4 and VP8/VP9 WebM are the first formats to try.
- Local replay scrubbing, ¼×–8× playback, mute, fullscreen, and timestamped notes. Playback
  pauses when you switch to the workspace or minimize the window.
- Notes saved locally and exportable as JSON; native PNG export of the current content view.
- Optional account pairing, explicit sharing of selected observations, offline delivery,
  revision conflict review, and withdrawal from current evidence. Video stays local.
- An explicit capture chooser for the workspace itself or another window/screen, used by the
  existing screen-sharing and recording flows. Microphone/camera requests have their own
  prompt. Screen capture of other applications also requires the OS screen-recording grant.
- An offline/reconnect screen. Local recordings remain usable without the backend.

Shortcuts: **⌘/Ctrl+O** open recording, **⌘/Ctrl+1** workspace, **⌘/Ctrl+2** recording,
**⌘/Ctrl+Shift+S** save an image. In the recording view, **Space** toggles playback,
**← / →** seek five seconds, and **M** marks a moment. Text fields keep normal editing keys.

## Boundaries of this prototype

Local recordings are video files, not GoTA state replays. They are not automatically associated
with a policy or episode. Shared observations are human evidence, not an assertion that Preston
has watched the video or that a video position maps to a game tick. Hosted state replays continue
to use the existing workspace viewer. No replay decoding performance claim is made beyond the
actual local playback and seeking tests.

In a recording, expand **Share observations with Preston**, connect this device, optionally
select a saved policy version, and choose **Share with Preston** beside a note. Sharing is for
the default GoTA workspace. Only the selected note, file name, SHA-256, file size, timing, and
optional saved-policy association are sent. An enabled evidence-review responsibility may
investigate the new observation; sharing does not request a game or enter a league.

The outbox is saved before transmission and retries pending operations at most once a minute,
with backoff on errors. **Sync queued notes** retries immediately. It survives app restarts and
requires both the original account's active session and a paired device. Credentials use
Electron secure storage; if secure storage is unavailable, local notes still work. The unsigned
macOS build may request Keychain access. Each operation retains its ID across retries. Conflicts
show the shared text and require an explicit choice before replacing it.

**Load shared notes for this recording** reads up to 50 recent shared moments with the same
content fingerprint and adds missing local notes, preserving existing local edits. It is a
bounded manual import, not a complete multi-device library mirror. **Withdraw shared note**
removes the observation from current moment retrieval while preserving its attributed history.
Removing a local note alone does not withdraw it or cancel an already queued share.

**Open shared evidence** opens its permanent private page, including the exact saved policy
source when associated. That page lists studies started from the moment, including closed
studies, so returning to a recording preserves access to its investigation. Withdrawn moments
retain these historical links but cannot start another study. In a study, **Revisit this
prediction** and **Develop a working lesson** prepare an attributed response with its source
entry selected. Separate unfinished notes survive switching forms within that page; they are
not saved across navigation or app restarts until you save the entry.
The web companion also lists shared moments and lets you disconnect
devices under **Between visits → Shared recording moments & devices**. Revocation stops later
sync operations; it does not delete earlier shared evidence. Up to ten active devices may be paired.
Apply `20261011071357_desktop_replay_sync.sql` before using these features.

The native bridge does not offer arbitrary file paths, shell execution, or computer input.
Computer control remains the existing in-workspace controls; OS-wide mouse/keyboard control,
external-game overlays, live game adapters, and replay indexing are subsequent milestones.
Web Speech dictation and actual microphone/camera hardware still need manual platform testing.
System audio capture is not enabled; coaching uses the microphone.

## Architecture

`main.cjs` owns the window, native dialogs, persisted metadata, permissions, and managed views.
The hosted workspace runs in a sandboxed `WebContentsView` with no preload or Node access.
Its origin and cookies remain intact, so the existing same-origin API and Eve authentication
continue to work. Cross-origin links require a browser-open confirmation and never gain the
desktop bridge. Remote content cannot invoke the bundled UI's IPC handlers.

`app/` contains small bundled shell, recording, and capture-picker pages. `preload.cjs` exposes
specific operations; every IPC handler verifies both the sender view and its main frame URL.
Local video is served through a streaming custom protocol using an opaque recording ID and
only the currently selected file. No general filesystem protocol or local HTTP server is added.

State lives under **Application Support/Softmax Prototype** on macOS (the platform's app-data
directory elsewhere). Workspace state and browser sessions are separated by backend origin.
Recording metadata stores the selected path, size, modification time, and notes. Replacing a
file resets its note association. Removing/moving a recording requires opening it again.

## Team downloads

Builds are attached to GitHub releases of `Metta-AI/student-harness` tagged
`desktop-vX.Y.Z` (the `Softmax IDE desktop release` workflow packages Apple
Silicon and Intel zips; `npm run desktop:package` does the same locally). The
app is **not code-signed or notarized** yet, so macOS quarantines the download.
After unzipping, either right-click the app → Open → Open, or run:

```sh
xattr -dr com.apple.quarantine "/Applications/Softmax IDE.app"
```

Signing needs a Developer ID certificate in the build keychain; none is
configured. Native notifications also require a signed app.

## Verify and package

```sh
npm run desktop:test
npm run desktop:package
```

The tests cover URL and note validation plus real Electron navigation, bridge isolation,
workspace-only capture, video playback/seeking, note persistence/export, PNG export, reopening,
and offline recovery. The sync smoke test also verifies session-cookie delivery, pairing,
restart with queued notes, conflicts, import, withdrawal, revocation, and logout. It substitutes
secure storage inside the test process, so it does not validate native Keychain behavior.
They use an isolated temporary profile, a local fixture server, and an
eight-second synthetic test-pattern recording. They do not access your account or capture your
screen. Test browsers close in `finally` and have a two-minute lease.

Packaging produces `desktop/dist/Softmax-<platform>-<arch>/`. On macOS this contains `Softmax.app`.
Only the desktop package is shipped, not the repository, `.env.local`, or backend dependencies.
This is an unsigned local prototype; signing, notarization, updater delivery, and native helper
permissions must be completed before distributing it to other users. It connects to
localhost:3000 by default, so keep the harness running when opening the packaged app directly.

Scoped replay commands are described below. The next integrations include multi-frame visual analysis, native capture/input actions, and a complete moment → discussion → experiment →
revised lesson interaction. Shared context now includes
current recording observations, but interpretation of local footage requires an additional,
explicitly granted media path.

## Preston replay control

Pair through **Share observations with Preston → Connect this device**, then choose **Let Preston
control this replay for 10 min**. The grant shares the recording's name/fingerprint/duration and
client-reported playhead/paused/foreground state. Full recordings remain local; optional frame sharing is described below. Chat and voice expose
`desktop_replay` to list available grants, request a seek, pause, play, speed change or local note,
and inspect the execution receipt. Reconnect an existing voice call to load new tool definitions.

The grant is only in native process memory. It expires after ten minutes and stops on recording
change, pairing change, process/window closure, Escape, or **Stop control**. A stop button is also
visible in the desktop title bar. Commands require the recording to be foreground and unchanged.
The backend queues commands for at most thirty seconds and the desktop checks the grant and target
again before execution. Each grant permits at most 100 commands and five queued commands.

Interactive control checks at most once every two seconds while granted. Failures stop local
control and receipt retries back off. A durable journal records intent before effects, then records
the result before acknowledgement. Restarting never restores the grant or repeats an uncertain
command. An unknown outcome is exposed as unknown; it is not success. A completed receipt is a
client-reported effect, not proof that Preston visually inspected the recording.
The reason control stopped stays visible after a pending receipt finishes. Starting a new
grant clears that reason. Frame-clear success or failure also remains visible through
background control updates; a success never implies images were removed from conversations.

Server stops have a separate durable journal. Before requesting a grant, the desktop saves
its cleanup identity so a lost registration response or process exit cannot lose the stop.
Local stop takes effect immediately. If the server cannot be reached, the viewer shows the
number of stops awaiting confirmation; retries use the original paired account/device with
one-minute to fifteen-minute backoff. Restart never restores control. The journal stores
identifiers and retry metadata, without recording names, paths, notes, credentials or pixels.
An unreadable or full journal prevents new grants rather than discarding pending stops.

Apply `20261011171428_desktop_durable_revocation.sql` with its preceding migrations before
deploying this route/client update. The server records revocation even when registration has
not arrived, and rejects later registration of that grant ID. Repeated stops are idempotent;
paired devices that have been revoked may still finish cleanup. No recent migration is applied
by the desktop itself.

`npm run test:runtime:desktop-control` exercises the production route, native journal and real
disposable PostgreSQL/PostgREST: stop before delayed registration, lost registration response,
offline retry/restart, and late execution receipts. Playback is substituted in that diagnostic.
`node tests/browser/replay-stop.mjs` checks the actual renderer's pending-stop status and rejection
of a late command after local stop, with fixture IPC. These checks do not establish live OS
focus behavior, signed distribution, or hosted deployment.

With `20261011165533_companion_desktop_events.sql`, **Shared activity** also shows replay control
and command records. **Inspect replay activity** compares the original record with current state;
a late device receipt can resolve an earlier unknown outcome. These records omit local note text,
recording names and image bytes. Chat and voice can read the same history with `companion_status`
using `view: "activity"`. An independently running minute dispatcher expires abandoned commands
and grants even when the desktop stops polling. Revoking the paired device fences its queued work;
already delivered actions remain uncertain until acknowledged.

Agent-marked notes carry a Preston attribution and stay local until explicitly shared. Control cannot upload full recordings, open files, run shell commands, or issue OS mouse/keyboard
input. Individual frame sharing requires the separate opt-in described below.
Apply `20261011075028_desktop_replay_control.sql`; restart Electron after updating the client.
The Electron fixture exercises all five actual playback actions and local stop. Separate native
and PostgreSQL tests cover expiry, late delivery after stop, concurrent claims, immutable receipts,
corrupt journals and crash/acknowledgement recovery. The fixture still substitutes native secure
storage and the hosted backend; live voice/model command selection remains to be evaluated.

## Share replay frames with Preston

Before granting replay control, optionally select **Allow up to 10 replay frames to be shared**.
Preston can then request `capture`. The viewer pauses and draws the current video frame into a
bounded JPEG; it does not capture other windows or the rest of the desktop. The server validates
and decodes the image, strips metadata, and commits the frame and command receipt together.
Preston uses `desktop_replay` with action `frame` and the returned `frameId` to receive actual image
content in chat or voice. The same private frame is available through the receipt's evidence link.
For comparison, `sequence` accepts two to four existing frame IDs from the same recording and
returns their images in media-time order, each labeled with its frame ID and position. Mixed
recordings, duplicate positions, and unavailable/expired members return no sequence. Reading a
sequence never captures another frame. This supports comparing visible samples; events between
them and causal explanations still require other evidence. Reconnect an existing voice call to
load the updated tool schema.

Frame sharing defaults off and cannot be enabled by a tool. The grant retains its ten-minute expiry,
foreground checks, Escape/Stop controls and device scope. Frames are limited to ten captures per
grant, 50 retained frames per account, 1280 pixels per dimension and 512 KiB each. No video, audio or
local path is uploaded. The recording is served through an opaque, current-recording-only route on
the bundled application's origin so its video pixels can be read without granting arbitrary files.

Image bytes never enter the native offline command journal. Uploads are attempted only while the
grant remains active; an interrupted upload is reconciled by reading its receipt, without retrying
pixels after restart or stop. **Clear this device’s shared frames** stops its grants and deletes
its frame artifacts. Retrieval expires after 24 hours; the existing minute dispatcher removes expired
bytes in batches of 200. A stopped dispatcher can delay physical cleanup, but expired images are not
returned by the app. Images already sent to a model can remain in conversation/provider history;
clearing the artifact does not erase those copies. This is disclosed next to the local grant.

Frames retain their recording fingerprint, image digest and client-reported media position. One frame
does not establish movement, causality, a BASIC branch execution, or a game-tick mapping. Image text
is evidence, never an instruction to Preston. New migrations are
`20261011080646_desktop_replay_frames.sql` and `20261011082000_desktop_frame_cleanup_bound.sql`.

`npm run test:runtime` now verifies actual frame bytes pass through the compiled production tool to
the model boundary. `RUN_LIVE_VISION_EVAL=1 npm run test:vision:live` runs two small synthetic-image
checks against the configured AI Gateway credentials; it is an explicit paid diagnostic and uses no
user recording. Its result is saved to `/tmp/preston-vision-result.json`. This does not measure GoTA
coaching quality or establish general resistance to instructions embedded in images.

`npm run test:runtime:replay-vision:live` builds an isolated Eve runtime using the production
desktop tool, with a synthetic frame database and a real Gateway model. It checks single-frame
interpretation, image-embedded instructions, a chronological two-frame comparison with unknown
cause/game tick, and an unavailable frame. It permits at most 12 provider attempts, disables
other default tools, and cleans up its runtime and fixture server within five minutes. Reports
remain under `.artifacts/replay-vision/`. This is a paid model diagnostic; it does not use user
recordings, provision computers, or run games. It validates the tool/model path, not GoTA coaching
quality, microphone hardware, or general injection resistance.


## Companion updates

**Updates** opens the signed-in account’s `/updates` inbox in the workspace. **Notify** enables
quiet native notifications for that account and device; it is off by default and uses the same
secure pairing as replay notes. Only a count is shown in the OS notification. Findings and evidence
remain in authenticated finding documents. A notification for one finding opens its
permanent `/updates/FINDING_ID` document; batches open the inbox. Clicks recheck the account, and cookie changes invalidate old
notifications. If the account changes or pairing is revoked, enable again after signing in.

Replay play/pause is observed locally even when Preston’s replay-control permission is off. This
only suppresses notifications: it grants no control and sends no video position to the server.
Server quiet hours and activity leases also suppress announcements. Findings remain unread until
you mark them read or dismiss them. Desktop notification claims are account-wide (one batch per
15 minutes, 12 per rolling day, at most 50 findings per batch), so two devices do not announce the
same findings. Unknown display attempts are not repeated after a crash. A notification can be
skipped if attention changes after claim; the inbox retains the finding.

The desktop checks once per minute while enabled, backing off to 15 minutes on errors. It must
remain running to deliver notifications; this prototype installs no OS service. On macOS, closing
the window leaves the app running until Quit. Hosted research continues independently.

Current Electron macOS notifications require a signed app. This prototype remains unsigned, and
real OS authorization/display is not yet validated. A display failure turns Notify off; hover its
status for the reason and use Updates. Automated Electron checks replace the OS display boundary
and use fixture credentials; they do not send user notifications or modify the Keychain.
