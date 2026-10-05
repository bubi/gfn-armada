# OpenNOW as a native comparison candidate

**User decision on 2026-10-04:** retain the original GFN web client with
Electron/Chromium. This superseded the recommendation below. OpenNOW was only
downloaded, SHA256-verified on the Portal and extracted into a user test directory;
it was not launched or logged into. Do not implement an OpenNOW backend for
gfn-armada. This analysis remains a reference.

Status: 2026-10-04. Investigated:
[OpenCloudGaming/OpenNOW](https://github.com/OpenCloudGaming/OpenNOW),
commit `bee18c118dbc89f42319436dcdb172d5b9e15e0c`.
Stable tag `v1.0.2` points to the same commit as the downloaded `main` snapshot.
No OpenNOW programs or build/install scripts executed.

## Recommendation at that stage

Test OpenNOW first on the Portal as an independent native comparison client,
before a Chromium/Electron source build. Its Qt/Rust architecture bypasses
Chromium's WebRTC decoder factory entirely. However, the stateful HEVC/DMA-BUF
path needed by Iris is also incomplete there. OpenNOW is a plausible smaller
extension base, not an already validated solution for Odin HEVC.

The working gfn-armada Electron client remains the H.264 comparison baseline.
No backend switch or Steam file changes yet.

## What actually differs

The current Qt version replaces the earlier Electron project:
[README](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/README.md).
Qt Quick renders the UI; a Rust core manages account, catalog and sessions.
The native Rust streamer handles GFN NVST transport, decoding, audio and input
through a C ABI. No browser or Chromium/WebRTC fallback in the current Qt client.
Older forks/releases still describe Electron and are unsuitable references here.

Linux ARM64 is published as AppImage and Debian package. AppImage is the first
comparison candidate for Fedora-based ArmadaOS; `.deb` is not an ArmadaOS package.
Bundled libraries and Qt/Vulkan plugins require device testing.

## Separate codec and memory paths

| Path in reviewed source | Implementation | Consequence for Odin/Iris |
|---|---|---|
| Stateful V4L2 H.264 | Direct Rust V4L2 M2M decoder | Plausible first VPU game test, not run |
| V4L2 HEVC | FFmpeg Request API, HEVC_SLICE and SAND128 NV12 | Does not match the observed stateful Iris node |
| VA-API HEVC | Separate FFmpeg/VA-API path | No demonstrated Qualcomm Iris path |
| Vulkan Video | FFmpeg Vulkan backend | Turnip rendering alone does not establish Vulkan Video decode |
| Software decode | FFmpeg fallback | Playback success does not establish hardware use |
| DMA-BUF import | Existing Linux Vulkan frame import | Useful infrastructure, not automatic Iris zero-copy proof |

Source evidence:

- [session.rs](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/native/opennow-streamer/crates/opennow-streamer-platform-linux/src/session.rs):
  `open_decoder` selects the direct decoder for V4L2/H.264, but FFmpeg Request
  for HEVC. AV1 is not implemented in this V4L2 branch.
- [v4l2.rs](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/native/opennow-streamer/crates/opennow-streamer-platform-linux/src/video/v4l2.rs):
  Device probe and OUTPUT FourCC are limited to H.264; SDR NV12/I420. CAPTURE
  uses MMAP; output creates CPU planes with `dmabuf: None`. Hardware decode
  must therefore be distinguished from zero-copy.
- [v4l2_request.rs](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/native/opennow-streamer/crates/opennow-streamer-platform-linux/src/video/v4l2_request.rs):
  Checks `HEVC_SLICE` (`S265`), media requests and SAND NV12 formats.
- [capability.rs](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/native/opennow-streamer/crates/opennow-streamer-platform-linux/src/capability.rs):
  Reports these separate decoder probes. Capability success does not replace
  a live stream test.
- [presentation.rs](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/native/opennow-streamer/crates/opennow-streamer-platform-linux/src/presentation.rs)
  and `frame_producer.rs`: Vulkan import/synchronization of external DMA-BUF
  frames. Layout, modifier, lifetime and synchronization must match Iris buffers.

## Direct game launch and controller

[AppController.cpp](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/opennow-qt/src/app/AppController.cpp)
handles `--launch-app-id`, `--app-id`, `--launch-title` and other title arguments.
App ID means OpenNOW/GFN catalog ID, **not a demonstrated Steam AppID substitute**.
Connect the existing mapping layer only after catalog identities are checked;
do not equate IDs.

`ApplicationStartup.cpp` handles `--console`. Qt supplies controller UI and
stream menus that could reduce our overlay interaction problems. No Portal
runtime test so far.

## Prepared test package

On 2026-10-04, the GitHub API reports `v1.0.2` as stable and also
`v1.0.3-nightly.853.1`. Cached `releases/latest` views sometimes showed `v0.5.5`,
so API and stable Git tag were independently checked.

[Stable release v1.0.2](https://github.com/OpenCloudGaming/OpenNOW/releases/tag/v1.0.2)
contains `OpenNOW-Qt-1.0.2-Linux-arm64.AppImage`, 105,892,360 bytes, SHA256:

```text
55b57e7c2c5b1343266ce1741e15de1f2cf5fee15c92c189677e1b0ea016a59a
```

`python3 scripts/fetch-opennow` downloads exactly this artifact into
`.artifacts/opennow/`, verifies its pinned hash and records provenance. It installs
or launches nothing. A matching checksum alone does not validate the separate
update-manifest signature.

## Device experiment and possible small extension

1. Launch AppImage separately from Electron's profile in a user test directory,
   recording OpenNOW decoder diagnostics. User performs login; do not copy
   existing Electron cookies.
2. Test a GFN H.264 stream with an explicit V4L2 backend. Correlate decoder name,
   Iris access and queue activity; detect software fallback.
3. Add stateful HEVC locally first: generalize codec/FourCC and device probes;
   compare complete access units, resolution changes and flush against the
   working Iris/GStreamer test.
4. Connect CAPTURE DMA-BUF export and lifetime retention, replacing CPU planes,
   to existing Vulkan import. Do not reuse buffers before GPU completion;
   check format/modifier and synchronization.
5. Then test real GFN HEVC and later AV1.

These would change the native decoder backend, not require a complete Chromium
fork. Effort/reliability become assessable after the first device test. OpenNOW
uses an unofficial GFN protocol; upstream/server changes may affect session
setup and codec negotiation.

The project is MIT-licensed; preserve copyright/license when copying code.
Dependencies have separate license notices. No upstream code copied so far.

## HEVC negotiation: comparison on 2026-10-05

Trigger: gfn-armada's Windows identity test reports appropriate UA/platform
values, but the user still sees no selectable H.265 option. Source read only;
OpenNOW not launched or logged into. Current `main` remains
`bee18c118dbc89f42319436dcdb172d5b9e15e0c`. Also reviewed: earlier Electron
`v0.5.5`, commit `44b80f207e84a2e4a6cda58205aa54e67aacb56f`.
Thanks to OpenCloudGaming and OpenNOW contributors for their open source.
No code copied or running session changed in this investigation.

### Earlier Electron version: custom WebRTC session instead of the original web app

This version is particularly relevant to Chromium. It uses Chromium/WebRTC but
implements its own GFN UI, session requests and signaling. It does not simply
load the original web app with another UA.

- [clientHeaders.ts](https://github.com/OpenCloudGaming/OpenNOW/blob/44b80f207e84a2e4a6cda58205aa54e67aacb56f/opennow-stable/src/main/platforms/gfn/clientHeaders.ts):
  Windows Chrome UA on Linux too, with `NVIDIACEFClient`/`GFN-PC`; CloudMatch
  headers `nv-client-type=NATIVE`, `nv-client-streamer=NVIDIA-CLASSIC`,
  `nv-browser-type=CHROME`. Nevertheless the session body explicitly sets
  `GSStreamerType=WebRTC`. Headers alone do not identify video transport.
- [deviceIdentity.ts](https://github.com/OpenCloudGaming/OpenNOW/blob/44b80f207e84a2e4a6cda58205aa54e67aacb56f/opennow-stable/src/main/platforms/gfn/deviceIdentity.ts):
  Normal Linux desktop sends `nv-device-os=LINUX` but `clientPlatformName=windows`.
  Optional Steam Deck profile reports SteamOS, CONSOLE, VALVE and STEAMDECK.
  This extends beyond `navigator.platform`.
- [cloudmatchFeatures.ts](https://github.com/OpenCloudGaming/OpenNOW/blob/44b80f207e84a2e4a6cda58205aa54e67aacb56f/opennow-stable/src/main/platforms/gfn/cloudmatchFeatures.ts):
  Custom session body has `requestedStreamingFeatures.codec`: H.264=1, H.265=2,
  AV1=3. HEVC fallback `[2,1]` is filtered by reported decoder capability.
  A field in reference protocol code, not a documented public NVIDIA CLI option.
- [codecDiagnostics.ts](https://github.com/OpenCloudGaming/OpenNOW/blob/44b80f207e84a2e4a6cda58205aa54e67aacb56f/opennow-stable/src/renderer/src/lib/codecDiagnostics.ts):
  Custom availability from decoder probe and WebRTC receive capabilities.
  AV1 additionally requires hardware; HEVC in `resolveSupportedStreamCodecs`
  does not. This selection does not call the original app's
  `enableH265Support`/GPU-allowlist predicate. Upstream comments about past
  official rules do not verify today's rules.
- [webrtcClient.ts](https://github.com/OpenCloudGaming/OpenNOW/blob/44b80f207e84a2e4a6cda58205aa54e67aacb56f/opennow-stable/src/renderer/src/platforms/gfn/webrtcClient.ts):
  Reads offered codecs, prefers HEVC within existing SDP and through
  `RTCRtpTransceiver.setCodecPreferences`; retains fallbacks, handles HEVC
  profile/level/tier and validates the answer. An H.264-only server offer does
  not gain an invented HEVC payload. Level/tier rewriting does not guarantee
  matching actual bitstream parameters.

This bypasses local selection rules in the original app, not the GFN server's
decision. Source code, availability probes and a negotiated hardware stream
are distinct evidence. No OpenNOW runtime measurement or Odin HEVC proof in
this investigation.

### Current Qt/Rust: different transport and numbering

[streamer.rs](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/native/opennow-core/src/streamer.rs)
selects an available codec by backend and color profile. Normal SDR auto tries
AV1, HEVC, H.264; explicit selection is checked against backend capabilities.

[cloudmatch.rs](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/native/opennow-core/src/cloudmatch.rs)
sends `clientIdentification=GFN-PC`, a Bifrost UA, and Linux or optional SteamOS
as `clientPlatformName`. Unlike Electron, `build_create_body` explicitly has
**no codec field** in `requestedStreamingFeatures`; selection sets color/HDR
limits. An older auto-selection comment in `codec_wire` contradicts this body
construction; the construction itself was checked here.

[nvst_rtsp.rs](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/native/opennow-streamer/crates/opennow-streamer-core/src/nvst_rtsp.rs)
sends selection in RTSP ANNOUNCE via `a=x-nv-vqos[0].bitStreamFormat`:
**H.264=0, HEVC=1, AV1=2**. Do not confuse these with Electron CloudMatch numbers.
Native NVST is not a small Chromium switch; it replaces substantial signaling/
streamer components. Missing stateful Iris HEVC components documented above
remain relevant.

### Consequence for gfn-armada

Retain original GFN. The current UA/platform test changes neither CloudMatch
codec preference, WebRTC preference nor original SDK eligibility. OpenNOW
suggests a justified experiment, not a proven one-line unlock:

1. In a fresh original session setup, capture only permitted diagnostic fields:
   actual platform/codec preference and offered H.265 profiles. Export no full
   bodies, tokens, URLs, SDP or ICE data.
2. Trace the original SDK override path for `enableH265Support` to its caller;
   only then choose a disableable experimental adaptation. Do not indiscriminately
   mark requests as NATIVE or Steam Deck.
3. If needed, test an HEVC preference narrowly scoped to the demonstrated WebRTC
   session request, plus existing codec preferences, retaining H.264 fallback.
   Add no HEVC payloads absent from the server offer.
4. Report success only with active `video/H265`, Chromium platform decoder and
   successful Iris CAPTURE frames for that session.

These were experimental next steps; no such hook implemented during this review.
H.264 was the validated GFN hardware path and HEVC unconfirmed at that stage.
Later codec results are in [the project summary](project-summary-2026-10-05.md).
