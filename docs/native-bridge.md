# Experimental bridge for the original GFN web client

Parallel GFN H264 hardware path demonstrated; sustained output not yet validated
at the initial stage below. This document preserves successive experiments;
see [the project summary](project-summary-2026-10-05.md) for the current default path.

**Live GFN testing resumed:** During the earlier second real stream start an
unsupported color space was rejected; seconds later the client crashed with
SIGSEGV. The cause is not attributed. A Node worker is a thread in the same
process and does not isolate native memory faults. The native path now runs in
a separate Electron helper. Deliberate helper SIGSEGVs on Mac and Portal left
browser video running. Local Iris/DMA-BUF output in the separate helper is
confirmed at 720p for 30 seconds. A real GFN stream with the process boundary
then stopped at eight outstanding packets before its first transfer with
`compressed-queue-overflow`. Helper exit 0; original browser video continued
with FFmpeg. Preparing the native pipeline before readiness passed local
Mac/Portal tests. The next real stream reported full-range BT.709, previously
rejected. The adapter now preserves negotiated limited/full range; both pass
local Iris/DMA-BUF color tests. Real GFN output with that correction produced
610 Iris/DMA-BUF transfers and renderer draws before another full compressed
queue stopped the bridge. All samples were released and the browser continued.
Sustained hardware output had not yet been reached. Frontend remains XWayland,
helper Wayland. Original SIGSEGV cause remains open.

```text
GFN RTCRtpReceiver → RTCRtpScriptTransform (forward unchanged frames)
                         ↓ Copy of compressed H264 access units
Tap worker → bounded MessagePortMain → supervisor in GFN process
  (sandboxed preload forwards the port only during setup)
  → Staging queue (64 packets / 4 MiB, ACK on acceptance, burst buffer)
  → Binary-framed pipe (compressed bytes and status only)
  → Separate Electron helper / temporary profile / own GPU process
      → Node worker → GStreamer appsrc → h264parse → v4l2h264dec → appsink
      → NV12 DMA-BUF → SharedTexture → sandboxed diagnostic canvas
```

Original UI, login, WebRTC transport, audio, controller and browser decoding
remain active. This deliberately parallel diagnostic path uses a separate
window. It saves no CPU yet; audio sync and replacing the original video element
are not implemented. This adapter does not add HEVC negotiation.

## Build and explicitly enable

```sh
./scripts/build-dmabuf
./scripts/build
```

GStreamer/Node-API module: `.artifacts/dmabuf/bridge.node`, using Fedora 44
GStreamer system libraries. Transfer this artifact and the ARM64 client bundle
to the device, without installing base packages. For example, place the module
in your user data directory:

```sh
GFN_ARMADA_OZONE=x11 \
GFN_ARMADA_NATIVE_SHADOW=1 \
GFN_ARMADA_NATIVE_BRIDGE="$HOME/.local/share/gfn-armada/native/bridge.node" \
GFN_ARMADA_LOG=debug gfn-armada launch steam:1091500
```

The absolute module path must exist and provide the new `openStream`/`pushFrame`
API. Without `GFN_ARMADA_NATIVE_SHADOW=1`, no module or transform is loaded.
Normal GFN retains its existing profile. Complete login before experimental
stream testing.

Native Wayland is the confirmed Electron DMA-BUF output path so far. The Linux
helper uses Wayland regardless of frontend. Original GFN can remain XWayland;
earlier native Wayland stability problems remain relevant. The separate hardware
path is confirmed with local H264 WebRTC on Portal. XWayland SharedTexture import
failed in the local comparison. The additional diagnostic window may affect
focus/Steam Input; this is not a finished Gaming Mode presentation mode.

## Codec, timing and fallback

* Worker loads and confirms readiness **before** attachment to a live receiver.
  A CSP-blocked worker is never bound to the decoder path. CSP/web security and
  sandbox stay enabled.
* Proxy captures only new video receivers, allowing GFN's synchronous track
  handler first. Existing transforms are preserved. Existing peers, other
  frames/workers or later GFN transform changes may remain invisible. Actual
  GFN CSP/hook compatibility is open at this stage. Frame-free probe receivers
  before game start do not permanently consume the connection: a new worker is
  prepared after they end. Once real frames are accepted, receiver changes stop
  the bridge. Attaching only at `connectionState=connected` was rejected: local
  testing produced no encoded frames despite continued browser video.
* Determine codec from `getMetadata().mimeType`, or payload type and negotiated
  receiver parameters. Allow only H264; never reinterpret VP9/AV1/HEVC as H264.
* Start only on an Annex-B keyframe with SPS/PPS. Without in-band parameter sets,
  native output remains off. Keyframe requests are best effort; Mac probes
  sometimes reported `keyframe-request-unavailable`.
* Convert 90 kHz RTP timestamps to relative GStreamer PTS, supporting uint32
  rollover. Large jumps, stale/reordered packets and codec/receiver changes
  stop this prototype. No B-frame/clock recovery or automatic session resumption.
* At most eight unacknowledged compressed packets, each up to 2 MiB and totaling
  4 MiB, independently bounded in tap worker, supervisor ingress, helper pipe
  and helper. ACKs contain sequence numbers; unknown ACKs do not free credits.
  Native appsrc: eight frames / 4 MiB; appsink: two frames; worker: four outstanding
  DMA-BUF leases. Supervisor additionally stages up to 64 packets / 4 MiB and
  ACKs the tap on **acceptance**, not after the native round trip, buffering bursts.
  If the tap window still fills, drop until the next keyframe with SPS/PPS and
  resume; count/report every dropped frame and resync. Never silently discard
  dependent delta frames while reporting success. Full staging still indicates
  sustained overload and stops diagnostics.
* GStreamer calls and close run in the **helper's** Node worker. Only helper main
  imports FDs; GFN main loads no native module. Worker retains each sample lease
  until cross-process `allReferencesReleased`. Compressed bytes are copied;
  raw pixels are not mapped in the addon.
* Helper uses a separate temporary profile without NVIDIA session, blocks network
  requests/permissions and permits only the local diagnostic window. Process
  separation isolates native crashes but adds no OS permission boundary: same
  user. Parent/helper exchange no numeric FDs, so no SCM_RIGHTS adapter is needed.
  Only compressed access units are copied.
* Supervisor/helper pipe: eight open packets / 4 MiB, staging ahead of it; ACK
  deadline two seconds, readiness at most 15 seconds. Errors reject open requests
  with `false`. Stop waits a bounded interval and SIGKILLs after three seconds
  if needed. No automatic retry after helper crash. Exit code/signal/PID are
  logged; original browser path remains active.
* Packet rejection or native decoder/import errors disable the copy while the
  encoded worker forwards originals. A worker crash **after** successful binding
  is a distinct untested case: remove transform/report error; a new game start
  may be needed. Do not confuse it with tested CSP preflight.
* Full navigation, receiver generation changes, diagnostic-window closure and
  errors stop the bridge. Restart the client for another experiment; no restart loop.

Color space/import is limited to linear NV12 and negotiated limited/full-range
BT.709; unknown/HDR color spaces remain rejected. Resolution changes are not
claimed as a supported production path. Iris → Electron output is validated
with the earlier HEVC clip and now local H264 WebRTC through appsrc. A real GFN
stream still needs its own test at this stage.

## Diagnostics and tests

`runtime.json.nativeShadow` and structured `native-shadow` logs contain status,
codec, frame/draw/release counts, timestamps and last transfer time. No SDP, ICE
addresses, tokens or video bytes. This does not set global GFN hardware status
to `yes`. Opening a V4L2 element alone is insufficient runtime evidence.

Mac, real local WebRTC session with production preload:

```sh
./node_modules/.bin/electron tests/smoke-native-bridge.cjs
GFN_ARMADA_TEST_HELPER_CRASH=1 ./node_modules/.bin/electron tests/smoke-native-bridge.cjs
GFN_ARMADA_TEST_HELPER_REJECT=1 ./node_modules/.bin/electron tests/smoke-native-bridge.cjs
GFN_ARMADA_TEST_BACKPRESSURE=1 ./node_modules/.bin/electron tests/smoke-native-bridge.cjs
GFN_ARMADA_TEST_BLOCK_WORKER=1 ./node_modules/.bin/electron tests/smoke-native-bridge.cjs
```

The HTTPS test document is served locally in a separate temporary profile; no
NVIDIA app, login data or external network session. Without a module path scope
is explicitly `encoded-tap-only`, `nativeTested:false`. Final Mac probe:
99 compressed packets, 32 browser frames. Packet rejection fallback: one packet,
64 continuing browser frames. CSP preflight fallback: zero packets, 64 browser
frames. Delayed rejection does not establish queue overflow (`overflow:false`).

Linux ARM64/Portal: run the same test with absolute `GFN_ARMADA_NATIVE_BRIDGE`.
It additionally checks at least 30 DMA-BUF transfers/draw calls, color content
through one-time pixel readback, and full lease release. The packaged test runtime
needs its own `resources/app` mapping, as in
[the local HEVC probe](../experiments/dmabuf/README.md).

For `--gfn-armada-native-helper`, the packaged entry point must load
`client/native-helper.cjs` first; production `client/main.cjs` automatically
selects this. Local hardware tests can use `GFN_ARMADA_TEST_FRONTEND_OZONE=x11`
while the helper stays Wayland. Final Portal probe: 896 transfers/draws/releases
in 30.204 seconds at 1280×720, clean helper exit. Subsequent SIGSEGV test:
35 native frames first; browser continued from 36 to 66 frames. A fresh helper
then passed with 36 transfers and full completion.
Evidence: [validation-isolated-helper-odin.json](../experiments/dmabuf/validation-isolated-helper-odin.json).
29 unit tests pass. Color diagnostics include only range/matrix/transfer/primaries
enum values, no video bytes.

### Diagnostics and helper shutdown, 2026-10-04

Resuming bridge work, exact native error text was retained as `lastNativeError`
in supervisor snapshots, surviving general stop status/helper exit. Regression
checks decoder rejection after full helper shutdown. Duplicate synchronous
profile deletion in helper `quit` was removed: supervisor owns the temporary
profile and removes it after child exit. Initial Mac shutdown needed SIGKILL;
after the change, error testing passed with exit 0 and continuing browser video
(1 → 38 frames). This demonstrates the retest, not a conclusive cause for the
previous shutdown hang or earlier GFN crash.

Separate Portal instance `bridge-color-20261004`: 29/29 ARM64 tests and local
1280×720 H.264 Iris test passed, 148 transfers/draws/releases in 5.040 seconds,
zero open leases, six colors, helper exit 0. Strict color checks remain; no
speculative overrides. Unchanged native module SHA256:
`2e663ef54f5915140d21d415e8994b036a56c23fba1a832285338c60f4a3426d`.
Production GFN installation not replaced. With user permission, the separate
instance was launched for real GFN testing; results below.
[validation-helper-diagnostics-odin.json](../experiments/dmabuf/validation-helper-diagnostics-odin.json).

### First isolated GFN stream and pipeline preparation

After user approval, the prepared instance was launched. At 16:42:34 UTC on
2026-10-04, eight compressed H.264 packets reached the supervisor. Tap reported
`compressed-queue-overflow` before `native-opened`. No DMA-BUF transferred;
helper exit 0. Later snapshot in the same client: 2,301 FFmpeg frames, 0 drops.
This proves clean fallback for that attempt, not hardware output or color
correction. Exact burst/ACK latency had not yet been measured.

One-time pipeline creation now runs in decoder worker before `ready`.
`pullFrame` starts only after the first accepted packet. SPS/PPS driver setup
still occurs at stream start. Opening alone does not prove active VPU. Limits
remain eight packets / 4 MiB; no uncontrolled enlargement or silent frame drops.
A slow decoder tests readiness after preparation and eight successive packets;
a missing backend fails before readiness.

31/31 unit tests pass on Mac/ARM64. Prepared local Portal bridge: 149 transfers/
draws/releases in 5.046 seconds at 1280×720, six colors, exit 0. Mac rejection
test retains native error while browser advances 1 → 33 frames. Separate
`bridge-prewarm-20261004` launched; `native-opened` demonstrably precedes readiness.
Corrected real game stream still to test.
[validation-prewarm-odin.json](../experiments/dmabuf/validation-prewarm-odin.json).

### Actual GFN color space and targeted range correction

Next real stream reached sample validation: `range=1 matrix=3 transfer=5 primaries=1`,
meaning full-range 0–255 BT.709 according to
[GStreamer enums](https://gstreamer.freedesktop.org/documentation/video/video-color.html).
This explains rejection for this stream. Helper exit 0; browser continued with
FFmpeg and no reported drops. It does not explain earlier SIGSEGV or establish
identical earlier color spaces.

Module now accepts only supported BT.709 primaries/matrix/transfer with explicit
limited/full range and forwards it to
[Electron ColorSpace](https://www.electronjs.org/docs/latest/api/structures/color-space).
No raw-pixel conversion/CPU copy or guessed defaults. Helper reports
`negotiatedColorSpace` without FDs/images. ARM64 native tests check the actual
GFN enum tuple and reject unknown range, BT.601 and unsupported transfers.

Built with `-Wall -Wextra -Werror`, SHA256:
`425dc49231bbdd88ec5c61b5730fcbe6798a41d3e8fec46a1a64c5bb9f89c378`.
31 tests pass on Mac/ARM64. Portal H.264 limited-range regression: 150 transfers/
draws/releases, zero leases, exit 0. Two equivalent synthetic full/limited-range
HEVC patterns generated in a temporary Linux container without target package
installation. Iris → NV12 DMA-BUF → Electron: 60 frames each with correct color
space, full release, exit 0. 21 RGB points differ by at most two channel levels;
readbacks are color validation only. Temporary encoder containers/image removed.

Separate `bridge-fullrange-20261004` runs this correction. Its **real GFN H.264
stream** sent 621 compressed packets and produced 610 DMA-BUF transfers, renderer
draws and sample releases in full BT.709. Explicit `v4l2h264dec`, `/dev/video0`,
`qcom-iris-decoder`, `/sys/bus/platform/drivers/qcom-iris`; no software fallback
in this pipeline. This proves hardware decoding/Electron handoff in the parallel
diagnostic path, not replacement of browser decoding.

After about ten seconds the tap queue filled again. Helper exit 0, zero leases;
FFmpeg browser continued without reported drops. Bridge is now off; automatic
runtime fields remain conservative. Next: measure ACK round trips/high-water
marks at every stage and correct bounded buffering specifically. No uncontrolled
queue expansion or silent dependent delta-frame drops. Sustained playback,
actual compositor presentation, internal GPU copies, decode/end-to-end latency,
GFN HEVC, CPU savings and audio sync are not established. No kernel queue trace.
[validation-fullrange-odin.json](../experiments/dmabuf/validation-fullrange-odin.json).

The new H264 API compiles with `-Wall -Wextra -Werror`; 24 unit tests pass.
After SSH recovery, local H264 Iris bridge also passed at 1280×720 for 30 seconds.
WebRTC reduced the first probe to 320×180; the second retains resolution through
synthetic sender settings, not NVIDIA parameters.
[validation-h264-odin.json](../experiments/dmabuf/validation-h264-odin.json).
Global hardware status for real GFN remains **unknown** at this stage. After
successful parallel GFN testing: audio sync, frame timing, keyframe recovery,
then experimental browser-output replacement.

Sources: [W3C Encoded Transform](https://www.w3.org/TR/webrtc-encoded-transform/),
[GStreamer appsrc](https://gstreamer.freedesktop.org/documentation/app/appsrc.html),
[Electron SharedTexture](https://github.com/electron/electron/blob/v44.5.1/docs/api/shared-texture.md).

### Queue/ACK measurements (2026-10-04)

`queueMetrics` records current packet/byte occupancy, packet high-water mark,
ACK count, maximum ACK round trip and oldest pending age per stage. Validated
tap/preload counters remain untrusted renderer observations. Helper pipe/worker
use local monotonic clocks. `nativePushMaxMs` measures compressed packet acceptance,
**not decode latency**. ACK means acceptance, not completed decode/presentation.
Measurement ranges overlap; do not add maxima.

Tap/preload report at most once per second; helper stats accompany existing
control snapshots. Progress logs are saved at most once per second, replacing
repeated snapshots whenever frame counts divide by 30. Abort retains the last
queue snapshot before cleanup. Sampled tap/preload/worker values may be older;
pipe/supervisor occupancy is captured directly at stop. Limits remain eight
packets / 4 MiB. No silent delta drops; originals forwarded. No image data,
FDs or session information exported.

32 tests pass on Mac/Portal, including delayed ACK, high-water mark/full drain.
Isolated `bridge-queues-20261004`: synthetic Iris H264 test, 150 transfers/draws/
releases, zero leases, exit 0. Tap high-water 3 packets, ACK max ~11.9 ms;
pipe max ~7.95 ms, native acceptance ~0.37 ms. Synthetic 1280×720 test does not
explain GFN termination. Module/pipeline unchanged; real instrumented GFN test pending.

### Direct tap/preload port (2026-10-04)

Next GFN run stopped after eight packets: tap 8 / 44,985 bytes, no ACKs, oldest
121.4 ms. Pipe had ACKed four (max 7.61 ms) with four pending, oldest 3.56 ms.
This points to renderer forwarding/return delay; renderer task versus IPC-response
delivery split is not yet measured. Helper exit 0; FFmpeg browser continued
with zero drops. Stale zero-valued worker samples do not prove no native work.

A prepared MessageChannel now directly connects tap/preload for packets/status/
ACKs. Page forwards the port only at setup, removing per-frame window.postMessage.
Bootstrap remains opt-in, data validation unchanged, no privileged page access.
Preload IPC still runs in renderer and may be delayed by a blocked renderer;
a port alone guarantees no constant latency.

Port prepared before track event. Asynchronous setup during track installed the
transform too late and produced no local tap frames; not launched for GFN.
Corrected synchronous setup: 32 Mac/ARM64 tests, 147 local Iris transfers/draws/
releases and probe-receiver test with 149 frames. Six colors at 1280×720, zero
leases, helper exit 0. Artificial backpressure stops after eight packets while
original video continues; worker-src CSP also preserves it. Eight packets / 4 MiB
unchanged. Synthetic latency maxima vary, so no performance gain claimed.
Sustained GFN test pending.
[validation-messageport-odin.json](../experiments/dmabuf/validation-messageport-odin.json).

### Tap burst handling (2026-10-04)

Direct-port GFN test produced 375 H264 transfers/draws in full-range BT.709
before eight pending tap packets. Oldest just 3.1 ms; pipe had ACKed 382/387,
five pending, oldest 2.62 ms. Earlier maxima: worker ACK 5.33 ms, native acceptance
0.187 ms, pipe ACK 18.83 ms, preload ACK 27.2 ms, tap ACK 99.4 ms. Maxima need
not describe the same packet. No native error, helper exit 0, zero leases;
stop released two untransferred samples (377 releases / 375 transfers).
FFmpeg browser continued with zero drops. Still a parallel H264 hardware path,
not sustained replacement or HEVC.

Rapid filling fits a burst of already available frames crowding out ACK tasks.
After forwarding each original, the transform now yields the event loop with
`setTimeout(0)` when at least four packets are pending. It neither waits for
an ACK condition nor expands queues; eight unacknowledged still stops it.
Already forwarded originals remain unchanged; later acceptance may be delayed.
`yieldCount`/`yieldMaxMs` measure scheduling cost. Timers are not guaranteed;
evaluate in sustained GFN testing. Yield guarantees no ACK.

Serialized-worker regression: burst of 40 frames with task-based ACKs accepts
all copies, high-water at most four. Without ACKs accepts exactly eight copies;
all 40 originals identical/in order. Tests worker scheduling, not Chromium/GFN timing.

34 Mac/ARM64 tests pass. Local 30-second 1280×720 Iris test: 880 transfers/draws,
881 releases including an untransferred stop frame, zero leases, exit 0.
Tap high-water 1, ACK max 23.3 ms; quiet 30-fps stream never yielded, so does not
validate real GFN bursts. Electron backpressure again confirms eight copies
with continuing original video.
[validation-yield-odin.json](../experiments/dmabuf/validation-yield-odin.json).

### Distinguishing access-unit errors (2026-10-04)

Next GFN run stopped after three packets with `unsupported-access-unit`, no
yield or DMA-BUF transfer. That old label combined empty, non-Annex-B and >2 MiB
frames; actual cause unknown. Helper exit 0, no leases; H264/FFmpeg browser
continued with zero drops. This run cannot assess burst correction.

Errors now distinguish `empty-access-unit`, `non-annexb-access-unit` and
`oversized-access-unit`. Snapshots add `accessUnitBytes`/`annexB` (0/1), aggregate
size/framing metadata only, no payload/image. Rejection/limits unchanged. Tests
provoke all three and check reason/size/forwarding of every original. No new
bitstream format assumed or converted.

Separate `bridge-accessunit-20261004`: 37 Mac/ARM64 tests and local Iris H264
passed, 151 transfers/draws/releases, zero leases, correct pattern, exit 0.
One additional packet was being accepted at stop, not a decoded/presented frame.
Metadata reports expected Annex-B. Precise GFN rejection awaits another run;
its hardware status remains unconfirmed.

### Direct worker/supervisor port (2026-10-04)

Following GFN run used valid Annex-B H264. Eight pending again, oldest 122.1 ms,
no tap ACKs; four pipe ACKs, max 8.55 ms. Five yields completed, max 0.4 ms.
Worker yielding alone does not remove renderer/preload return delay. No native
transfer, helper exit 0; FFmpeg browser continued with zero drops. Earlier
`unsupported-access-unit` not reproduced; exact cause remains open.

Packets/status/ACKs now use `MessageChannelMain` directly between encoded worker
and supervisor. Isolated preload checks GFN origin and forwards port once.
Main binds it to original main frame/receiver generation; navigation, frame
changes, foreign generations, invalid packets and full queues still stop it.
A new probe port is allowed only before first accepted packet. Separate helper
pipeline/sample isolation unchanged. This matches
[Electron's MessagePort model](https://www.electronjs.org/docs/latest/tutorial/message-ports).

In local Electron 44.5.1, control messages arrived but transferred ArrayBuffers
could not be read as valid packets by main. Compressed ArrayBuffers therefore
use structured clone without transfer list, passing local Iris tests. These
are compressed-byte copies, not raw pixels; compressed transport is not zero-copy.

37 Mac/ARM64 tests pass. Local Iris: 145 transfers/draws/releases, zero leases,
exit 0. Probe receiver: 147 transfers/draws, 148 releases including stop sample,
zero leases, exit 0. Backpressure still stops after eight copies; CSP preserves
original video.

`smoke-worker-main-port.cjs` uses production preload/supervisor with an explicit
mock decoder. During a 300 ms page busy loop, 47 more packets were ACKed within
150 ms. Demonstrates local ACK independence from page event loop, **not** mock
hardware decode or real GFN stability. Sustained GFN, HEVC, CPU savings, compositor
presentation and end-to-end latency remain unconfirmed.
[validation-mainport-odin.json](../experiments/dmabuf/validation-mainport-odin.json).

### Burst staging and resync instead of termination (2026-10-04)

Direct worker/supervisor GFN test delivered **about 43 seconds of native transfers**:
2,584 packets, 2,563 DMA-BUF transfers/draws/releases, full BT.709, `v4l2h264dec`
on `/dev/video0`. Longest parallel hardware run so far compared with 375 transfers
in about ten seconds. Port change removed measured renderer delay: tap ACK max
28 ms versus 99.4 ms, high-water 4 versus 8; pipe 21.8 ms, worker 8.6 ms,
native acceptance 0.25 ms.

Then `compressed-queue-overflow` stopped the bridge. **No crash**: helper exit 0,
zero leases, 2,564 releases / 2,563 transfers; FFmpeg browser continued (5,841
frames, zero drops).

Stop state: tap 8 packets / 125,230 bytes, oldest **2.8 ms**, 2,576 ACKs received.
Window filled in under three milliseconds versus 8–28 ms ACK round trips. No
credit can return in 2.8 ms: an arrival burst of at least nine frames exceeds
the window, rather than a latency/throughput limit. Decoding 2,563/2,584 packets
shows the pipeline kept up on average.

Simply expanding the window fails: `experiments/dmabuf/bridge.c` configures
`appsrc max-buffers=8 max-bytes=4194304`; `pushFrame` rejects at eight buffers.
The pinned `bridge.node` drains at decode rate. More upstream capacity alone
would move overflow into native code, terminating helper with
`native-compressed-queue-overflow`. Two targeted changes:

* **Supervisor staging.** Accept bursts into at most 64 packets / 4 MiB, ACK tap
  immediately on acceptance instead of after the native round trip, then feed
  pipe in strict order with at most eight open packets. ACK now measures this
  hop only; native limit/module unchanged.
* **Resync instead of termination.** If tap still fills, drop until a keyframe
  with in-band SPS/PPS, request keyframe best effort, then resume. Count
  `dropped`/`resyncCount`; report `queue-overflow-resync`/`queue-resync-resumed`.
  Decode only from keyframes, never mid-GOP. No appsrc flush; parser/decoder
  may briefly output damaged frames after gaps. Access-unit errors, codec/
  receiver changes and full staging still stop at this stage.

Tap yield stays. This run disproves the earlier assumption it was ineffective:
six yields and flowing ACKs. It could not bridge native round-trip delay; staging
shortens that delay. Yield still guarantees no ACK.

`queueMetrics.supervisor` adds `highWater`. `pendingBytes` counts unsent packets
only; pipe bytes appear under `helper-pipe`. Ranges still overlap; do not sum them.

38 Mac tests pass. Two serialized-worker regressions: an unACKed burst caps at
eight copies, reports one resync/keyframe request and forwards all 40 originals
unchanged/in order; returning credit resumes at frame 20 on a parameter-set
keyframe, counting 12 dropped copies. `smoke-supervisor-burst.cjs` uses production
preload/supervisor with explicit mock and sends a burst in one task without
waiting for credit: 24, 40 and 64 packets accepted, ordered pipe delivery/full
drain, staging high-water 16 or 56. Same test fails against old supervisor with
`ipc-queue-overflow`, establishing regression. All six Mac bridge smoke variants
still pass, including helper SIGSEGV isolation, decoder/packet rejection and CSP.

Mock/transport evidence only, **not** hardware decode or GFN stability. Next
real run must confirm burst handling and report glitches from dropped/resyncs
per minute. ARM64 Iris test with unchanged module also pending. Sustained playback,
compositor presentation, decode/end-to-end latency, GFN HEVC, CPU savings and
audio sync remain unconfirmed.

User fix deployed to Odin (2026-10-04): separate `bridge-staging-20261004` contains
SHA256-verified current sources/unchanged module. 38 ARM64 Electron tests pass.
Local Iris H264: 147 transfers/draws/releases, zero leases, correct 1280×720
pattern, helper exit 0. Mock burst: 24 ACKs, staging high-water 16, full drain,
exit 0. Still no native burst-tolerance proof. Corrected build ready for live
GFN stability/glitch measurement.
[validation-staging-odin.json](../experiments/dmabuf/validation-staging-odin.json).

### Unsupported access units trigger resync (2026-10-04)

GFN staging test produced 2,457 Iris H264 transfers/draws/releases then stopped
with `non-annexb-access-unit`: 467 bytes, no expected start code. No queue overflow;
tap high-water 3, latest ACK max 13.7 ms. Alternative framing remains unknown;
no payloads saved. Helper exit 0, zero leases. Main PID 186999 alive at audit;
later FFmpeg browser stats: 4,046 H264 frames, zero drops. Native shutdown recorded,
not main SIGSEGV.

Tap now treats empty, oversized or incorrectly prefixed AUs as native-path gaps:
forward originals; count/skip offending copy and dependent deltas; request keyframe
best effort; resume only on Annex-B keyframe with SPS/PPS. No guessed prefix or
assumed AVCC conversion. Retain initial resync reason; repeated bad frames do
not cause log storms. `resyncing` (0/1), `resyncCount`, `dropped` expose waiting/
gap size. Limits unchanged. Main treats these three reasons as informational;
codec changes, invalid transport, full staging and native errors still stop it.

38 Mac/ARM64 tests pass. Worker regression provokes all three forms, waits until
frame 20 then resumes on parameter-set keyframe: 17 skipped copies, all 40
originals identical/in order. Real Electron port with mock confirms main remains
active after resync messages: 60 ACKs within first 150 ms of a 300 ms page block.
Local Iris: 151 transfers/draws/releases, zero leases, exit 0. This normal stream
has no gap and proves no actual GFN hardware recovery. Without another suitable
keyframe, native window may remain frozen. GFN keyframe request, wait time,
possible no-flush artifacts and actual resumption need a live test. HEVC and
decoder replacement unconfirmed.
[validation-bitstream-resync-odin.json](../experiments/dmabuf/validation-bitstream-resync-odin.json).

### Successful real GFN resync test (2026-10-04)

Separate `bridge-bitstream-resync-20261004` ran **150.710 seconds between first
and last captured transfer messages** without native error, stop or helper exit
up to this snapshot. Latest: 9,036 H264 Iris/NV12 DMA-BUF transfers/draws/releases,
zero leases, full BT.709. Decoder path/verified module unchanged.

Two AUs, 909 and 1,032 bytes, lacked expected start code. Both resumed on keyframes;
six skipped native copies total. Status intervals to resume: 47/64 ms, **not**
decode/presentation latency. Thousands more frames transferred/drawn/released
after second resume. `resyncing=0`, tap ACK max 19.3 ms, pipe max 11.63 ms;
queue limits respected.

First >2-minute parallel GFN H264 hardware run **with observed recovery from
previously terminal framing events**. Not general/hours-long stability or
artifact-free recovery: compositor, visible image/audio sync not measured.
Skipped packet framing remains unknown. Original FFmpeg decode continues
(latest 8,717 frames, zero drops), so no CPU saving/full replacement. GFN HEVC
unconfirmed. Client left running to preserve snapshot.
[validation-bitstream-resync-odin.json](../experiments/dmabuf/validation-bitstream-resync-odin.json).
