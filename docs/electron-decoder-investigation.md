# Electron → Iris: investigation dated 2026-10-04

Historical investigation; subsequent adapter/codec results are in the
[current summary](project-summary-2026-10-05.md).

## Result and evidence limits

The main gap most likely lies in the shipped Chromium decoder backend, not
missing Iris device support. The inspected stateful Chromium backend also lacks
a concrete HEVC implementation. The actual decoder instance of the GFN H.264
stream at this stage is unequivocally **FFmpeg**: the new native statistics
reader was validated in the original client after SSH was restored. The running
stream reported 3,260 decoded frames, zero drops, and
`powerEfficientDecoder: false`. The separate HEVC test demonstrates Iris → NV12
DMA-BUF → Wayland. Details/timestamps and the separate GStreamer/GFN tests:
[odin-device-validation.md](odin-device-validation.md).

## Precisely matching sources

Electron `44.5.1` uses Chromium `152.0.7977.130` according to
[DEPS](https://github.com/electron/electron/blob/v44.5.1/DEPS), matching device logs.

- [Electron all.gn](https://github.com/electron/electron/blob/v44.5.1/build/args/all.gn): `proprietary_codecs=true`, Chrome FFmpeg branding, no V4L2 override.
- [Electron release.gn](https://github.com/electron/electron/blob/v44.5.1/build/args/release.gn): imports these shared settings.
- [Linux ARM64 build workflow](https://github.com/electron/electron/blob/v44.5.1/.github/workflows/pipeline-segment-electron-build.yml): additional ARM64 GN arguments set CPU and linker/installer options, not `use_v4l2_codec=true`.
- [Chromium args.gni](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/gpu/args.gni): `use_v4l2_codec=false`; VA-API defaults on for Linux ARM64 too.
- [V4L2 BUILD.gn](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/gpu/v4l2/BUILD.gn): includes backend sources only with `use_v4l2_codec`.

This combination is strong source evidence for standard Electron built without
V4L2. Fully resolved `args.gn` for the released binary are unavailable; no
Electron source build was started.

The local Linux ARM64 runtime contains VA-API and FFmpeg diagnostic strings,
but string searches found neither `media/gpu/v4l2/` source paths nor the concrete
stateful decoder name. The single `V4L2VideoDecoder` string is **not** backend
proof: it also appears in the general enum-to-name converter
[media/base/decoder.cc](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/base/decoder.cc).
Missing strings alone do not conclusively prove a build flag either.

## HEVC: an additional missing decode path

[V4L2StatefulVideoDecoder::Decode](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/gpu/v4l2/v4l2_stateful_video_decoder.cc)
assembles H.264 frames. HEVC instead reaches `NOTIMPLEMENTED()` and returns
`kUnsupportedCodec`. The current `main` downloaded on 2026-10-04 also contains
this rejection. “HEVC special handling” in earlier architecture notes must not
be read as successful HEVC support. A stateless HEVC delegate in the same source
directory does not satisfy stateful Iris requirements.

A small HEVC patch must at least implement bitstream/access-unit delivery in
the stateful decode path and test against Iris. Merely removing the rejection
is not a validated fix. Profile discovery, resolution changes, flush, and error
handling also need tests. First enable the existing H.264 path, then close this
HEVC gap.

## Selection and WebRTC integration

[ActiveLinuxVideoDecoderType](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/base/decoder.cc)
defaults to VA-API when both VA-API and V4L2 are compiled in;
`PreferV4L2VideoAcceleration` selects V4L2 only if both exist. A feature flag
cannot retrospectively compile a missing decoder.

[gpu_mojo_media_client_linux.cc](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/mojo/services/gpu_mojo_media_client_linux.cc)
connects the selected decoder to Linux's pipeline. GL also requires the
conditions for `AcceleratedVideoDecodeLinuxGL`.
[VideoDecoderPipeline](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/gpu/chromeos/video_decoder_pipeline.cc)
selects `V4L2StatefulVideoDecoder` for stateful devices.

[RTCVideoDecoderFactory](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/third_party/blink/renderer/platform/peerconnection/rtc_video_decoder_factory.cc)
requires, among other things, `RTC_USE_H265`, the receive feature flag, and
appropriate platform decoder profiles for H.265. HEVC parsing alone is not
enough. Missing H.265 in `getCapabilities()` is consistent with this but does
not establish which condition fails first.

## Prepared diagnostics

- `gfn-armada diagnostics` gains `processVideoAccess`: identifies client/Chromium
  processes by `/proc/PID/exe` and reads only FD links to video/media/DRM devices.
  No command lines, cookies, or tokens.
- `scripts/sample-video-access.cjs 30` repeats every 250 ms for 30 seconds;
  output on changes and at completion. Runs on Linux with Node or packaged
  runtime in `ELECTRON_RUN_AS_NODE=1` mode.
- `GFN_ARMADA_MEDIA_DIAGNOSTICS=1` enables native CDP Media diagnostics. Only
  decoder name/platform-decoder property are saved, not player URLs or titles.
  Source: [CDP Media](https://chromedevtools.github.io/devtools-protocol/tot/Media/).
  WebRTC need not emit player events through this domain; missing events mean
  `unknown`. Reports cannot automatically be attributed to a GFN peer or VPU.
- Debug VModules also cover WebRTC decoder adapters. Some `DVLOG` output is
  absent in release builds; no message means no decoder claim.
- GPU feature information is refreshed after initialization with its own
  timestamp; the early startup snapshot is insufficient.

20 local tests passed. The first isolated macOS Electron smoke with Media
diagnostics loaded GFN, confirmed renderer sandboxing, and received preload
telemetry, but did not exit cleanly. A feedback loop between full GPU queries
and `gpu-info-update` was removed: the handler queries only feature status,
without another full GPU query. Only the stuck test processes were terminated.
The repeated smoke then exceeded its 45-second startup limit: **no fully
passing new GUI smoke test**. These runs had no active playback or decoder name.
CDP Media still provided no decoder name in GFN. The separate new native WebRTC
smoke, however, passed on Mac and Portal.

## Native statistics instead of microphone permission

This exact Chromium version filters `decoderImplementation` and
`powerEfficientDecoder` from page `getStats()` unless the context has active
media capture: [rtc_stats_report.cc](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/third_party/blink/renderer/modules/peerconnection/rtc_stats_report.cc),
`ExposeHardwareCapabilityStats` / `ToV8Stat`. Missing fields therefore do not
automatically mean missing native decoder instrumentation.

The native [PeerConnectionTracker](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/third_party/blink/renderer/modules/peerconnection/peer_connection_tracker.cc)
supplies native attributes to `chrome://webrtc-internals` without this page
filter. `client/webrtc-internals.cjs` uses a hidden local WebUI and its
`add-standard-stats` events. Only inbound video reports for the exact GFN origin
are exported: codec, decoder, efficiency flag, frame counters, timings. SDP,
ICE, IPs, track IDs, and URLs stay in the WebUI. No microphone/camera permission
or network debugging port. At this snapshot, enable together with
`GFN_ARMADA_MEDIA_DIAGNOSTICS=1`; results appear in `nativeWebRTC` in the runtime
snapshot. Exports older than 15 seconds are cleared as `stale`.

`tests/smoke-webrtc-internals.cjs` uses synthetic canvas H.264 and local peer
connections in a temporary profile. Results dated 2026-10-04:

| Runtime | Native observation | Limit |
|---|---|---|
| Electron 44.5.1 / Apple Silicon | `ExternalDecoder (VideoToolboxVideoDecoder)`, efficiency true; last test 109 frames | Local stream, not GFN or Qualcomm |
| Electron 44.5.1 / Portal | `FFmpeg`, efficiency false, 80 frames, zero drops | Software decoding demonstrated for this synthetic test; active GFN instance needs separate validation |
| Fedora Chromium 154.0.8037.57-1.fc44 / Portal | `FFmpeg`, efficiency false, 31 frames, zero drops | GL comparison with `AcceleratedVideoDecodeLinuxGL`; empty hardware profiles, video feature `disabled_software` |

After conservative software classification was added, 22/22 unit tests passed.
These local smokes do not replace a full GFN login/game/exit test; the reader
was additionally checked in a real GFN game. The running instance still had the
old `hardwareDecoderActive: unknown` summary while `nativeWebRTC` clearly
reported FFmpeg. The updated summary applies on next launch; do not interrupt
an active game solely for that.

## Prebuilt Fedora binary for comparison

The current [Fedora 44 recipe](https://src.fedoraproject.org/rpms/chromium/blob/f44/f/chromium.spec)
enables aarch64 `use_v4l2_codec` and disables VA-API. The inspected recipe now
lists 154.0.8037.92; it is not an exactly pinned build record for the tested
older .57 binary.

The device repository's .57 RPMs passed `rpm -Kv`: signatures/digests OK,
Fedora fingerprint `36f612dcf27f7d1a48a835e4dbfcf71c6d9f90a6`. They were extracted
with `rpm2cpio`/`cpio` under the user directory without installation/package
hooks. Two missing libraries (`libXNVCtrl`, `google-crc32c`) were supplied the
same way. The browser starts with them. Test path:
`~/.local/share/gfn-armada-tests/fedora-chromium/`.

`scripts/probe-chromium.cjs /absolute/path/to/chromium` drives only a local test
through CDP process pipes and a temporary profile. It reports native stream
values and GPU decode profiles and terminates its own browser.
`GFN_ARMADA_PROBE_LOG` optionally saves synthetic logs.
`GFN_ARMADA_PROBE_IGNORE_BLOCKLIST=1` is an experimental comparison only: that
follow-up lost SSH and has **no retrieved result**. No attribution to browser,
blocklist, or network is possible. No such switches entered the regular client.
Alternative decoder/streamer paths: [streamer-options.md](streamer-options.md).

## Next controlled experiment at this snapshot

1. The original GFN reader is validated: FFmpeg software decoding. Prepare
   the native adapter using this comparison baseline.
2. Correlate future hardware output with native decoder fields, stream
   timestamps, and device FD samples. V4L2 queue activity is stronger than an FD.
3. Investigate Fedora's empty decode profiles. Fedora/Flatpak/ARM64 alone does
   not establish VPU decoding.
4. Investigate the small adapter experiment from `streamer-options.md`. If no
   suitable binary/adapter exists, prepare a bounded V4L2 H.264 comparison build.
   Unvalidated `build/experimental-v4l2.gn` names relevant flags and is explicitly
   excluded from the ordinary bundle build. No huge checkout or full fork.
5. After H.264 Iris integration succeeds, implement stateful HEVC delivery and
   local decode tests, then WebRTC/GFN.

Downloaded sources are unversioned under `.artifacts/decoder-research/`;
source checksums are in `source-sha256.json`.
