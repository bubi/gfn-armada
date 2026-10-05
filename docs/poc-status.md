# PoC results and open work — 2026-10-05

## Latest: original GFN AV1 hardware path verified (2026-10-05)

The subsequent AV1 opt-in test records native `video/AV1` / VA-API and 16,639
Iris GPU-copy returns over ~278 seconds. Overlay agrees, GPU process holds
`qcom-iris-decoder`, AV01 session opens observed. No actual sync timeout events,
reported driver timeout counters zero. [Evidence](../experiments/packaging/validation-av1-live-odin-20261005.json).
The upstream experimental-profile flag was explicitly enabled; normal AV1
advertisement remains disabled due to the upstream hidden-frame limitation.
Keep AV1 experimental. Resolution changed; ~2.76 ms mean decode is not a fair
codec comparison. Prolonged stability, pixel accuracy, Gamescope and zero-copy
remain unverified. Earlier statements below reflect earlier measurements.

## Latest: original GFN HEVC hardware path verified (2026-10-05)

The opt-in HEVC experiment yielded native `video/H265` / `ExternalDecoder
(VaapiVideoDecoder)` and 7,850 Iris GPU-copy returns over ~131 seconds. GPU
process holds `qcom-iris-decoder`; HEVC session opens recorded, sandbox enabled,
six inspected decoder/ioctl error indicators zero. [Evidence](../experiments/packaging/validation-hevc-live-odin-20261005.json).
Resolution changed (1080p → 1680×1050/60); mean decode ~3.73 ms is not a fixed-
resolution or end-to-end latency benchmark. Visual correctness, prolonged
stability, zero-copy, Gamescope and AV1 remain unverified for this HEVC test.
The WebRTC preference hook ran; no CloudMatch request rewrite was observed.
Windows identity was active, but its necessity is untested. Earlier entries
below describe prior H.264 tests and the pre-experiment HEVC state.

**AI-generated, human-guided, unmaintained research snapshot.** Results apply to tested combinations, not every ArmadaOS image or future NVIDIA client.

## Device evidence

Odin 2 Portal, SM8550 / Snapdragon 8 Gen 2, Adreno 740; ArmadaOS `20261002.43c0cca`, kernel `7.2.6`. Observed renderer: `ANGLE (freedreno, FD740)`, not proof of Turnip Vulkan presentation. Qualcomm Iris V4L2 format enumeration alone does not establish usable GFN codecs.

- Earlier original GFN sessions started games; user observed Xbox controller recognition. Not a complete controller/overlay test suite.
- Native original GFN H.264: **14,484 Iris CAPTURE frames**, approximately **234 seconds**, `ExternalDecoder (VaapiVideoDecoder)`; last browser sample 14,279 decoded frames, zero drops, no observed driver errors/fallback. GPU sandbox on; native shadow bridge off. Counters have different scopes, not final session accounting. [Evidence](../experiments/vaapi-iris/validation-pps-fix-odin.json).
- Output `copy-gpu`: **GPU copy, no validated zero-copy**. Physical image correctness, end-to-end latency and prolonged stability unverified.
- Separate synthetic HEVC → `v4l2h265dec` → DMA-BUF → Electron tests exercised the local VPU/import path. **Not evidence of a GFN HEVC stream or Chromium HEVC negotiation.** [Experiment](../experiments/dmabuf/README.md).
- The separate encoded-frame shadow bridge reached multi-minute H.264 runs but suffered development failures. Diagnostic experiment, not the default decoder or a completed streamer replacement.

## Build/integration evidence

[Latest AppImage validation](../experiments/packaging/validation-appimage-catalog-20261005.json):

- 59 tests passed on macOS ARM64 and Linux ARM64 at the recorded build snapshot.
- Patched driver: 16/16 build tests; shared bitreader boundary/UBSan checks passed.
- ARM64 AppImage executed in a container as UID 1000: CLI, diagnostics, driver hash/loading, unknown mapping rejection, synthetic catalog import, temporary Steam VDF review/apply/idempotence/restore passed.
- Public NVIDIA schema/pagination checked live: two pages, four guest apps, zero eligible imports. **Not an authenticated library test.**

The ~111 MiB AppImage has SHA256 `e736cacdba65a4e8b4802fa84a666168343a310984b0dedbfbf7a20e99261b70`.
Bundled driver rebuilt in Debian ARM64 from pinned source plus four patches; successful native GFN measurement used an earlier Fedora-built binary. Same source does not validate the new binary. **Subsequently deployed and tested on Odin KDE/Wayland.**

[Subsequent AppImage device evidence](../experiments/packaging/validation-appimage-live-odin-20261005.json): 7,602 Iris `copy-gpu` publications, eight driver drops, no observed Iris error markers, approximately 127-second trace span. Page reports H.264 and 51 browser drops; counters have different scopes. The user confirms game and gamepad operation, not pixel-accurate or exhaustive controller validation. The client held `/dev/video0` (`qcom-iris-decoder`), GPU sandbox enabled, shadow bridge disabled. Native Chromium decoder stats were not enabled in this run; exclusive browser decoder use remains unconfirmed. H.265 browser capability was advertised but the GFN settings did not offer it. Cause unconfirmed. Gamescope was not active.

Catalog import retains original GFN login, reads all pages before updating mappings and separates store-sync/manual ownership. Only bookmarked and owned store editions enter Steam sync. Writes require Steam closed, preserve foreign shortcuts and create checksummed backups/restore. These paths were tested with temporary data, not actual Steam userdata.

## Remaining work

1. Complete AppImage acceptance testing: persistent-login lifecycle, image artifacts/pixel correctness, detailed controller behavior, Steam/FEX process tracking, overlay and Gamescope. Basic game/gamepad operation is now user-confirmed on KDE/Wayland.
2. Real account catalog import/direct launch for Steam/Epic/GOG/Xbox. Routes/schema may change; store/login dialogs may require input.
3. Repeat native H.264 evidence with bundled driver; measure longer stability, CPU load and latency. Flags alone do not prove hardware use.
4. **HEVC:** first original GFN VPU stream now validated; test visual correctness, longer stability, fixed resolution and whether Windows identity is necessary. Keep preference opt-in until those checks.
5. **AV1:** first actual VPU stream validated with experimental profiles and preference hook. Test hidden-frame coverage and prolonged stability; earlier Linux/SteamOS restrictions were snapshot-specific.
6. Zero-copy, artwork downloads, automatic Steam Input/overlay bindings and stale shortcut removal.
7. Original-code license/publication hygiene; review pending native bridge changes before declaring a reproducible source/release snapshot.

Some container inputs/download hashes are pinned, but package repositories remain mutable. Repeatable build workflow exists; bit-identical/offline reproducibility not demonstrated.
Older notes retain historical failures/intermediate states; they do not establish that all experiments ship or negate the later bounded H.264 measurement.

## Native Chromium statistics follow-up

Normal launch/login/map now collect sanitized `chrome://webrtc-internals` statistics by default; library import is excluded. Optional `GFN_ARMADA_MEDIA_DIAGNOSTICS=0` disables observation; `=1` also enables CDP Media inspection. `runtime.json` and structured `native-webrtc-decoder` logs carry native decoder identity, codec, dimensions/FPS, frame counters, cumulative/interval mean decode time and cumulative mean jitter-buffer residence. These are distinct from end-to-end latency and VPU-only processing time. Counter resets, non-increasing timestamps and format changes invalidate interval comparisons. Hardware activity remains `unknown` based on platform decoder names alone.

Implementation checks: 61 unit tests passed on macOS, including existing pending bridge tests; real Electron synthetic H.264 smoke passed with `ExternalDecoder (VideoToolboxVideoDecoder)`. This validates the observer on macOS, not the Iris path. New Linux build/device evidence will be recorded separately.

Clean source build `7e9ead6` passed **60/60** tests on both macOS ARM64 and Linux ARM64; the local working tree’s 61st test belongs to pending bridge work and was excluded from the artifact. ARM64 AppImage runtime smoke also passed as UID 1000. The [new native-statistics build evidence](../experiments/packaging/validation-appimage-native-stats-20261005.json) records its separate checksum; it is uploaded to Odin, pending restart of the active session.

Native statistics are now confirmed in an original Odin GFN stream: `video/H264`, `ExternalDecoder (VaapiVideoDecoder)`, GPU sandbox enabled, plus successful Iris returns. See [live evidence](../experiments/packaging/validation-native-stats-live-odin-20261005.json). The separate [HEVC eligibility follow-up](hevc-follow-up-2026-10-05.md) records the UI’s Unsupported state despite 8-bit color and a positive isolated browser capability probe; no GFN HEVC stream is claimed.
