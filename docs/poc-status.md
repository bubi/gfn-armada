# PoC results and open work — 2026-10-05

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
4. **HEVC:** verify NVIDIA negotiation and Chromium WebRTC support separately from Iris capability. No original GFN HEVC stream validated.
5. **AV1:** Linux/SteamOS GFN configuration disabled it in the inspected snapshot; actual stream/decoder path unproven. Investigate after HEVC.
6. Zero-copy, artwork downloads, automatic Steam Input/overlay bindings and stale shortcut removal.
7. Original-code license/publication hygiene; review pending native bridge changes before declaring a reproducible source/release snapshot.

Some container inputs/download hashes are pinned, but package repositories remain mutable. Repeatable build workflow exists; bit-identical/offline reproducibility not demonstrated.
Older notes retain historical failures/intermediate states; they do not establish that all experiments ship or negate the later bounded H.264 measurement.

## Native Chromium statistics follow-up

Normal launch/login/map now collect sanitized `chrome://webrtc-internals` statistics by default; library import is excluded. Optional `GFN_ARMADA_MEDIA_DIAGNOSTICS=0` disables observation; `=1` also enables CDP Media inspection. `runtime.json` and structured `native-webrtc-decoder` logs carry native decoder identity, codec, dimensions/FPS, frame counters, cumulative/interval mean decode time and cumulative mean jitter-buffer residence. These are distinct from end-to-end latency and VPU-only processing time. Counter resets, non-increasing timestamps and format changes invalidate interval comparisons. Hardware activity remains `unknown` based on platform decoder names alone.

Implementation checks: 61 unit tests passed on macOS, including existing pending bridge tests; real Electron synthetic H.264 smoke passed with `ExternalDecoder (VideoToolboxVideoDecoder)`. This validates the observer on macOS, not the Iris path. New Linux build/device evidence will be recorded separately.

Clean source build `7e9ead6` passed **60/60** tests on both macOS ARM64 and Linux ARM64; the local working tree’s 61st test belongs to pending bridge work and was excluded from the artifact. ARM64 AppImage runtime smoke also passed as UID 1000. The [new native-statistics build evidence](../experiments/packaging/validation-appimage-native-stats-20261005.json) records its separate checksum; it is uploaded to Odin, pending restart of the active session.
