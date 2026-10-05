# Validation status on 2026-10-04

This document records historical stages. See
[the project summary](project-summary-2026-10-05.md) for later codec/Steam results.

| Check | Result | Evidence limit |
|---|---|---|
| `npm test` | 14/14 passed | Launcher, mapping, backup, config, manifest and runtime arguments; no device functionality |
| Main/preload JS syntax | Passed | No substitute for streaming tests |
| Real Electron launch on Apple Silicon | Passed | macOS ARM64, not Armada |
| Official GFN home page | Loaded in smoke test | No login/game stream |
| Renderer security | sandbox=true, contextIsolation=true, nodeIntegration=false checked | No comprehensive security audit |
| Preload → main world → IPC | Codec/controller report received | No active peer/hardware decoder proof |
| Linux ARM64 packaging on macOS | Passed | Linux binary cannot run on Mac |
| `file` on packaged runtime binary | ELF 64-bit ARM aarch64 | No Linux runtime test |
| Linux ARM64 container build/export | Passed on 2026-10-04; 14/14 container tests | No Armada GUI/decoder test |
| NVIDIA login/profile reuse | Device test passed | Apple password login by user; profile reused after backend restart |
| Controller | Game detects Xbox controller; standard gamepad reported | GFN overlay shortcut still to test |
| Steam Gaming Mode | Open | Game test in KDE/XWayland |
| GFN game stream under XWayland | Device test passed | H.264, 19,334 frames, 0 drops; decoder unknown |
| HEVC on Qualcomm VPU | Synthetic 720p test passed | GStreamer Iris/DMA-BUF, not a GFN stream |
| AV1 on Qualcomm VPU | unknown | Element present, no decode test |
| Electron on ArmadaOS | Starts/loads GFN | H.265 absent from WebRTC capabilities; login/stream open at initial stage |
| DMA-BUF / low-copy | unknown | Import/queue/compositor proof missing |

On 2026-10-04 the already installed OrbStack was started. Docker 28.5.2 reports
`aarch64`. `./scripts/build` used the pinned Linux ARM64 base and exported the
bundle as the normal macOS user. Initial export problem fixed: packager output
must be readable by the unprivileged user before export (`chmod -R a+rX dist`).
Exported runtime verified as ELF ARM aarch64; client sources match repository.
Docker Desktop was not additionally installed. This still does not replace
ArmadaOS testing.

Real macOS test on 2026-10-03: Electron 44.5.1 / Chromium 152.0.7977.130 /
Node 24.21.0. Renderer reported H264, H265 and AV1 receive capabilities, among
others. **macOS browser capabilities only**, not NVIDIA negotiation or Linux
ARM64 package capability. A nonfatal macOS sandbox-resource warning appeared;
page/telemetry still loaded. Sandbox remained enabled.

Smoke profile: `.artifacts/smoke`, separate from production GFN data. `.artifacts`
and build output are not committed. No Steam profile changed; no login, password
or auth token stored.

Optional smoke test with native Electron installed:

```sh
XDG_CONFIG_HOME="$PWD/.artifacts/smoke/config" \
XDG_DATA_HOME="$PWD/.artifacts/smoke/data" \
XDG_STATE_HOME="$PWD/.artifacts/smoke/state" \
./node_modules/.bin/electron tests/smoke-runtime.cjs
```

Script exits after page load/telemetry, failing after at most 45 seconds.
GUI/network access excludes it from unit tests. First startup downloads Electron's
native runtime.

Device test/reproduction: [odin-device-validation.md](odin-device-validation.md).
After Wayland/Apple login fixes, 17/17 local tests pass; earlier container ran
14. Installed test bundle contains the fixes, original release archive does not.

Following decoder investigation adds process/device FD probes and optional native
CDP media metadata. 20/20 local tests pass. New Mac Electron media-diagnostics
smoke confirms page/telemetry initially but fails clean shutdown; after fixing
GPU-update feedback, another attempt exceeds startup timeout. New GUI diagnostics
therefore not fully validated. After SSH recovery changes reached Portal; original
GFN supplies running H.264/controller telemetry. 60-second device probe sees
GPU but no Iris access; native decoder metadata missing. This earlier test alone
did not identify GFN's decoder; later native reader identifies FFmpeg software.
[electron-decoder-investigation.md](electron-decoder-investigation.md).

## Native WebRTC diagnostics and decoder-adapter experiment

21/21 local tests pass. `GFN_ARMADA_MEDIA_DIAGNOSTICS=1` adds a filtered
`chrome://webrtc-internals` reader. Separate synthetic H.264 smoke passes on Mac
(VideoToolbox) and Portal (FFmpeg), not yet a GFN integration test. Fedora Chromium
.57 also uses FFmpeg in the local comparison. After intermittent SSH failure,
reader integrated into Portal GFN bundle with backup and confirmed in real game:
FFmpeg, efficiency false, 3,260 frames, 0 drops in recorded snapshot.

Optional local GUI tests without login/external stream servers:

```sh
./node_modules/.bin/electron tests/smoke-webrtc-internals.cjs
./node_modules/.bin/electron tests/smoke-encoded-transform.cjs
```

Encoded Transform passes on Mac/Portal: 30 forwarded H.264 frames each with
Annex-B start codes. Frame access only; no native decoder, DMA-BUF import or HEVC.
Limits/next architecture: [streamer-options.md](streamer-options.md).

Linux ARM64 container rebuild passed: 21/21 tests, Electron 44.5.1 packaging,
bundle export. Archiving started prematurely in parallel with export and failed
with a file timeout; after export, archive recreated successfully.
Intermediate `dist/gfn-armada-0.1.0-linux-arm64.tar.gz` (since replaced):

```text
d022d019c042c7c0370c280a58b7fabeb0313fed1c0c6a31857d966728489f2b
```

That build included the reader. After conservative software classification,
22/22 Mac/Linux ARM64 tests passed and bundle rebuilt. Export now transfers tar
through the container stream instead of copying via macOS VM bind mount. Running
Portal reports FFmpeg in `nativeWebRTC`; `hardwareDecoderActive: no` summary
applies after restart only. Packaging claims no HEVC/hardware capability.

Archive with 22-test build/conservative software classification:

```text
ad67b21a08d90b3bb027b6cf371fad9fb6fc50c413a82bf7411dfd2c1ccb8d9f
```

Updated files staged with backups on Portal for next launch; running game not restarted.

## Isolated native DMA-BUF bridge (2026-10-04)

`scripts/build-dmabuf` builds experimental Node-API-8 module in pinned Fedora 44
ARM64 image. GCC 16.2.1, GStreamer 1.28.7, Node headers 24.18.0;
`-Wall -Wextra -Werror` passes. DNF versions exported, repositories not frozen.
ELF aarch64, SHA256:

```text
fcd369709004866916387defc52e21e4187ca5fb550d95d727042937916f2ecb
```

Portal/Wayland: Iris HEVC → NV12 DMA-BUF → Electron SharedTexture → sandboxed
VideoFrame/canvas passed. 60 transfers/draw calls/releases, zero leases.
Pattern checked by pixel readback/screenshot; ANGLE/Freedreno FD740, GPU compositing/
OpenGL enabled. Ownership errors checked by assertions during real test.
XWayland comparisons failed; no support claimed.
[Device test](odin-device-validation.md),
[structured report](../experiments/dmabuf/validation-odin.json).

Existing 22 Mac launcher/diagnostic tests pass; new JS/packaging script syntax
checked. Experiment excluded from production bundle; production archive above
unchanged. No new GFN bundle or native GFN stream connection claimed.

## H264 encoded-frame bridge (subsequent step)

Opt-in connection implemented: production sandboxed preload → compressed H264
IPC → dedicated Node worker → bounded GStreamer appsrc/V4L2 → SharedTexture
window. Browser decoding remains. Annex-B/SPS/PPS gate, codec metadata, receiver
generation, sequence and RTP rollover checked. At this stage: four IPC packets
up to 2 MiB each; native eight frames / 4 MiB. Errors stop shadow path.

New module checksum (H264 stream API, **not yet Iris-tested**):

```text
570f398438fbdcd7e2917ad0942cd408279b9241b62a9bf67eabe4db836efa9f
```

Mac real local WebRTC with production preload:

| Test | Result |
|---|---|
| H264 encoded tap, final ArrayBuffer type check | 99 IPC packets, 32 original browser frames |
| Delayed packet rejection | 1 packet, 64 continuing browser frames; no measured queue overflow |
| CSP blocks worker | 0 packets, 64 originals; preflight prevents worker binding |

Initial CSP attempt without preflight interrupted local output; validated version
binds only a loaded worker. Post-binding worker crash still not covered.

Fedora ARM64: real Node-API module loaded; worker readiness, missing
`v4l2h264dec` element error and clean worker shutdown checked (`hardwareTested:false`).
`-Wall -Wextra -Werror`; 24 unit tests pass on Mac/Linux ARM64. ARM64 package built;
all eleven client files match final sources by SHA256. Older running build stopped
to prevent overwriting final build; no project build processes remain.

H264 appsrc/GFN hardware probe pending due to unreliable SSH. No new Portal
client installed or active game stopped for this experiment. Global GFN hardware
classification unchanged; shadow status `unknown`.
[native-bridge.md](native-bridge.md).

Final ARM64 bundle including preload type check:
`gfn-armada-0.1.0-linux-arm64.tar.gz`, SHA256
`835e7dcbc6d8469dc97343ef5eac51556c71cb0d41c69a494cda7edfa37b57c9`.
After a stalled build, rebuild used existing checksum-verified Electron 44.5.1
ARM64 download cache. All exported client files match source.

## H264 WebRTC bridge on Portal after SSH recovery

Full local RTCRtpScriptTransform → production preload → Node worker →
appsrc/h264parse/v4l2h264dec → DMA-BUF → Electron SharedTexture passed at
1280×720 over 30.228 seconds: 882 packets, 881 transfers/draw calls/releases,
zero open samples. Pixel check found six color bars. `/dev/video0` opened as Iris;
sysfs confirms `qcom-iris` and `qcom,sm8550-iris`. Wayland/renderer sandbox used.

First probe reduced to 320×180 by WebRTC. Synthetic 720p sender uses
`maintain-resolution` and local bitrate cap, not GFN options. Another 720p run
revealed an in-flight transfer at shutdown. Client now lets its lease finish
before window closure, forcing close after at most one second as fallback.
Final probe has no outstanding renderer-reference warning.

Evidence/source hashes:
[validation-h264-odin.json](../experiments/dmabuf/validation-h264-odin.json).
24 tests pass. Establishes local H264 hardware path, not real GFN, CPU saving,
measured latency or compositor zero-copy. Existing GFN not stopped; no base package
installed. HEVC negotiation open.

## New GFN client launch and reattachment after probe receiver

At explicit user request updated client launched under Wayland with existing
profile. GFN home created a short video probe receiver without frames; its end initially
stopped bridge. Hook now prepares a fresh worker after such an end; main retains
native connection. Changes after actual accepted frames still stop it.

Regression: create/close receiver without ICE/frames, then start real local WebRTC.
Mac: 33 encoded packets/32 browser frames. Portal: 35 DMA-BUF transfers/draws/
releases, 1280×720, zero samples, six bars. Late binding at
`connectionState=connected` failed on Mac/Portal (no encoded frames despite
browser video), so rejected. No real GFN hardware claim.

## First real GFN stream with bridge

GFN negotiated H264. Hook received real frames/opened `/dev/video0`, but stopped
after four packets without DMA-BUF transfer. `encoded-tap-ended-or-overloaded`
then did not distinguish failure types. Startup overflow is a hypothesis,
not confirmed. Browser continued: native Chromium stats FFmpeg, 1,884 frames,
zero drops. GFN hardware decoding explicitly not confirmed.

Next test uses eight slots totaling 4 MiB in worker/preload/main. Sequence-based
credits; terminal errors use distinct allowlisted reasons. Local regression before
GFN restart: Mac 99 packets/34 browser frames; Portal 128 transfers/draws/releases,
1280×720, zero samples, six bars. Caught IPC call after handler removal at test
end, not a decoder/lease error. User allowed restart of current connection.
Delayed Mac rejection left 61 browser frames running after one copy
(`overflow:false`); 24 tests pass. Active GFN ignored SIGTERM; after authorized
restart only its executable-path-verified main was SIGKILLed. Existing profile reused.

## Crash during second real GFN stream

After restart GFN negotiated H264. Bridge opened `/dev/video0`, accepted six
packets. `pullFrame` rejected a sample with
`First prototype requires negotiated limited-range BT.709`. No SharedTexture
import/draw; zero leases. Native worker closed; Chromium continued FFmpeg
(201 browser frames, zero drops in last page snapshot).

Seconds later PID 115444 ended with SIGSEGV; systemd confirms truncated core.
No stack in available summary; gdb/eu-stack not installed. No demonstrated
causal link between color error, GStreamer teardown and previously problematic
Wayland mode. Neither hardware output nor crash fix claimed.

Previous client restarted XWayland without native bridge, existing profile,
and stayed alive at follow-up. No base packages or further live hardware test.
Before another live test: capture exact color metadata, isolate error path,
implement native process isolation. Node workers share process; SIGSEGV can kill
GFN UI. Numeric DMA-BUF FDs cannot cross processes as ordinary IPC numbers;
FD transfer or helper-side import/output required.

## Separate Electron helper and fault isolation

`client/main.cjs` selects normal client/helper. Only helper loads module, owns
worker and imports DMA-BUFs into its renderer. GFN sends binary-framed compressed
AUs, receives ACK/status; no FD numbers cross boundary. Temporary profile without
login, network blocked, Wayland regardless of frontend. Eight packets / 4 MiB,
two-second ACK, 15-second startup, bounded stop/SIGKILL fallback. No auto-restart.

Mac: helper SIGSEGV while browser continues (30 → 67 frames). Separately simulated
color error: helper only exits 0, browser continues. Explicit mock test modules,
`nativeTested:false`, no Mac hardware claim.

Portal actual Node-API/Iris, browser XWayland/helper Wayland:

| Probe | Result |
|---|---|
| Healthy 720p, 30.204 s | 896 transfers/draws/releases; zero samples; six bars; helper exit 0 |
| SIGSEGV after hardware output | 35 native frames; browser 36 → 66; helper only exits |
| Reopen Iris after SIGSEGV | 36 transfers/draws/releases; zero samples; helper exit 0 |

Production PID 116674 remained open. No GFN session ended, base package installed
or new live GFN hardware test. 29 Mac/Linux ARM64 tests pass. Compiler still
`-Wall -Wextra -Werror`; rebuilt addon SHA256:
`2e663ef54f5915140d21d415e8994b036a56c23fba1a832285338c60f4a3426d`.
Color rejection now logs negotiated enums without relaxing strict checks.

Evidence/source hashes:
[validation-isolated-helper-odin.json](../experiments/dmabuf/validation-isolated-helper-odin.json).
Isolation fixes neither original unexplained error nor HEVC negotiation. No proof
of GFN hardware output, CPU saving, compositor zero-copy, end-to-end latency or
actually presented frames.

Final ARM64 bundle: packaged/exported client files match sources. Due to a stalled
macOS file read, portable archive made by unchanged `scripts/archive.py` in Fedora
ARM64 container. Archive SHA256:
`9c02de50dd6ecd31c76e736ee046e98829c7d91098c52f3c63467a880574e6eb`.
Native addon remains a separately supplied artifact.
