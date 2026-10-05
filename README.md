# gfn-armada — AI-generated, unmaintained PoC

Experimental GeForce NOW launcher for **AYN Odin 2 Portal / ArmadaOS / Linux ARM64**. Keeps NVIDIA’s original web application in Electron; explores Qualcomm Iris hardware decoding, direct game launch and Steam integration.

**Proof of concept, not a maintained product.** Project-specific implementation, local patches and documentation were generated **100% by AI**, guided by a human who supplied requirements, operated the device and reported observations. Third-party software belongs to its upstream authors and is credited separately. No commitment to updates, support, issue handling or compatibility. Independent experiment; no NVIDIA, AYN or ArmadaOS endorsement.

## Upstream projects and thanks

**Special thanks to [phxinyang/qualcomm-iris-vaapi](https://github.com/phxinyang/qualcomm-iris-vaapi): its Iris adapter is the foundation of our measured H.264 hardware-decoding path. We patched this existing driver; we did not write it from scratch.** Pinned source: [`f587b14`](https://github.com/phxinyang/qualcomm-iris-vaapi/tree/f587b14e6b22955c7250a45ff5f43588bbce2114).

Thank you to all the authors and contributors below for making their work and research available. Our AI-generated glue depends on their human-authored upstream work. Reference-only projects are identified explicitly; acknowledgement does not imply collaboration or endorsement.

| Repository / project | How it contributed |
|---|---|
| [phxinyang/qualcomm-iris-vaapi](https://github.com/phxinyang/qualcomm-iris-vaapi) | Driver incorporated and modified; four local patches listed below. |
| [mxsrc/libva-v4l2](https://github.com/mxsrc/libva-v4l2) and Bootlin’s libva-v4l2-request work | Inherited driver lineage, credited by Iris upstream. Thanks especially to Florent Revest, Maxime Ripard, Paul Kocialkowski and Max Schettler; upstream AUTHORS/CREDITS are preserved. |
| [strongtz/libva-v4l2](https://github.com/strongtz/libva-v4l2) | Additional Iris-upstream lineage: bundled upstream kernel patch files and HEVC rewrite approach. Those kernel patches were not applied to the Odin for our H.264 validation. |
| [aanze/geforcenow-arm64](https://github.com/aanze/geforcenow-arm64) | Initial ARM64 Electron-wrapper/build research reference. |
| [hmlendea/gfn-electron](https://github.com/hmlendea/gfn-electron) | Electron-client and CMS launch-route reference; client code/artwork not copied. |
| [armada-os/armada](https://github.com/armada-os/armada) | Target OS, device support, kernel/userland and Steam/FEX research. |
| [electron/electron](https://github.com/electron/electron), [Chromium](https://chromium.googlesource.com/chromium/src), [WebRTC](https://webrtc.googlesource.com/src) | Official Electron runtime and browser/media implementation; source inspection identified decoder and rendering blockers. |
| [torvalds/linux](https://github.com/torvalds/linux) | Qualcomm Iris/V4L2 kernel interface research; kernel decoder provided by the target OS. |
| [libva](https://github.com/intel/libva), [libdrm](https://gitlab.freedesktop.org/mesa/drm), [Mesa](https://gitlab.freedesktop.org/mesa/mesa) | VA-API and GPU/buffer infrastructure. GPU acceleration alone does not supply a Qualcomm VPU decoder. |
| [GStreamer](https://gitlab.freedesktop.org/gstreamer/gstreamer), [FFmpeg](https://git.ffmpeg.org/ffmpeg.git) | Native/synthetic decoder experiments, media tooling and browser decoder research. |
| [OpenCloudGaming/OpenNOW](https://github.com/OpenCloudGaming/OpenNOW), [clarkarch/nextclient](https://github.com/clarkarch/nextclient) | Alternative streamer/API research only; their clients and auth/streamer implementations are not used. |
| [NVIDIAGameWorks/GeForceNOW-SDK](https://github.com/NVIDIAGameWorks/GeForceNOW-SDK) | Official integration/deep-link research reference; not a bundled streaming SDK. |
| [ValvePython/vdf](https://github.com/ValvePython/vdf) | Steam binary-VDF format reference; our parser is independently generated. |
| [AppImage/appimagetool](https://github.com/AppImage/appimagetool), [AppImage/type2-runtime](https://github.com/AppImage/type2-runtime) | ARM64 AppImage tooling and embedded runtime. |
| [electron/packager](https://github.com/electron/packager), [iarna/iarna-toml](https://github.com/iarna/iarna-toml) | Packaging dependency and runtime TOML parser. |

This table lists the principal incorporated, inherited and researched projects; transitive runtime/npm dependencies retain their own notices. Exact pins, licenses and incorporation scope: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), `package-lock.json` and the source manifests.

## What is demonstrated?

Snapshot **2026-10-05**. [Evidence and remaining work](docs/poc-status.md).

| Area | Result and limits |
|---|---|
| Original GFN client | Earlier Odin sessions streamed games; Xbox controller recognition observed. Persistent Chromium profile implemented. |
| H.264 hardware decode | Original GFN stream: Chromium `VaapiVideoDecoder` and **14,484 Iris CAPTURE frames** over about 234 seconds; no observed driver errors/browser drops. **GPU copy**, not validated zero-copy. Visual correctness and long-term reliability remain unverified. |
| HEVC / AV1 | **No validated GFN hardware stream.** Synthetic local HEVC decoding is a separate experiment. |
| ARM64 AppImage | Built with pinned Electron and patched Iris driver, notices and modified driver source. Container smoke tests passed. **Now tested on Odin KDE/Wayland:** user reports game and gamepad working; successful Iris hardware-path returns recorded. Gamescope remains untested. |
| Catalog → Steam | Steam/Epic/GOG/Xbox import and guarded shortcut sync implemented. Public schema checked; account import and Steam writes tested with fixtures. **Real authenticated import and Gaming Mode flow remain untested.** |

```text
Original GFN web app → Chromium WebRTC → VA-API adapter
→ Qualcomm Iris / V4L2 → DMA-BUF → GPU copy → Wayland
```

Stock Electron lacks the required Linux V4L2 decoder in this build. The experimental VA-API adapter is a patched third-party driver, distinct from Mesa’s GPU driver. No complete Chromium fork is shipped. A separate native shadow bridge remains an experiment, not the default streaming path.

## Why H.264 hardware decoding initially failed

There were several independent blockers. Installing a VA-API library or setting “hardware decode” flags was insufficient.

1. **Missing browser-to-VPU adapter.** This Electron ARM64 binary has VA-API compiled in, but not the required Linux V4L2 decoder. Mesa accelerates the GPU; it does not automatically connect Chromium to Qualcomm’s Iris VPU. The upstream Iris VA-API driver supplies that translation layer.
2. **Render-node discovery skipped the SoC GPU.** Chromium’s inspected automatic scan considered PCI DRM devices and missed this platform GPU. Our integration explicitly supplies the detected render node through `--hardware-video-device-path`, without disabling the GPU sandbox.
3. **Rendering failed before decoding could proceed.** X11/default GL selected an ImageProcessor path; the adapter does not implement the required VA video processing. The tested combination **Wayland + `--use-gl=angle --use-angle=gl`** allowed NV12 surfaces with `No ImageProcessor needed`. Both settings changed together: we did not prove either alone is sufficient.
4. **GFN exposed a driver bitstream-reconstruction defect.** The driver synthesizes H.264 parameter sets from VA metadata while retaining original slice bytes. It generated PPS **0**, but actual GFN slices referenced PPS **15**, later **16**. Those slices therefore referred to an absent parameter set. Iris rejected the compressed buffers: one failed run had **1,475 submissions, zero completions and 1,475 errors**, despite Chromium reporting a hardware decoder and increasing frame counts.

The decisive codec fix reads the PPS ID from the original slice and writes the same ID into the generated PPS. It does not rewrite the slice or hardcode the previously observed value. Malformed/truncated input, IDs above 255 and conflicting supplied PPS IDs are rejected.

### What we patched

| Local driver patch | Purpose and role |
|---|---|
| [0001: DRM_PRIME_2 import](experiments/vaapi-iris/patches/0001-va-accept-drm-prime-2-surface-import.patch) | Add restricted external DMA-BUF surface import with descriptor/layout checks. **Not the decisive fix:** the successful Chromium path allocates driver surfaces and exports them; this patch alone did not solve initialization or establish zero-copy. |
| [0002: H.264 slice trace](experiments/vaapi-iris/patches/0002-trace-h264-slice-metadata.patch) | Log bounded numeric slice metadata to expose the PPS mismatch, without dumping video payload. Diagnostic instrumentation, not a decoder fix. |
| [0003: retain actual PPS ID](experiments/vaapi-iris/patches/0003-retain-h264-slice-pps-id.patch) | Correct generated PPS/slice association. **The H.264 fix that enabled successful Iris CAPTURE frames in the original GFN stream.** Regression coverage includes IDs 0/15/255, unchanged slice bytes and invalid/conflicting inputs. |
| [0004: shared Exp-Golomb bound](experiments/vaapi-iris/patches/0004-bound-shared-exp-golomb-reader.patch) | Reject the 32nd leading zero before a 32-bit shift; retain valid 31-zero codes. Follow-up robustness fix also covering the shared HEVC reader, not evidence of HEVC support. |

Wayland/ANGLE selection and explicit render-node discovery are changes in our launcher, not modifications to Chromium. No patched Chromium binary or kernel replacement was needed for the measured H.264 run. All four driver patches are bundled with source/license material; the [upstream bug report](experiments/vaapi-iris/upstream-bitreader-report.md) is still a draft.

### What we verified — and what we did not

After the PPS fix, two independent observations agreed during a bounded original GFN H.264 session:

- **Qualcomm Iris:** 14,484 successful CAPTURE returns, no observed OUTPUT/CAPTURE errors; output consistently `publish=copy-gpu`.
- **Chromium WebRTC:** `ExternalDecoder (VaapiVideoDecoder)` throughout approximately 234.232 seconds; last sample 14,279 decoded frames and zero drops. Browser and driver counters have different scopes.
- **Isolation:** no FFmpeg fallback observed, parallel native shadow decoder disabled, GPU sandbox enabled. [Recorded device evidence](experiments/vaapi-iris/validation-pps-fix-odin.json).
- **Regression/build checks:** shared-reader boundary tests passed under UBSan on macOS and Linux ARM64; the four-patch driver suite passed 16/16. The later AppImage snapshot recorded 59 client tests passing on both platforms and ARM64 container smoke tests. [Bitreader evidence](experiments/vaapi-iris/validation-bitreader-boundaries.json), [AppImage evidence](experiments/packaging/validation-appimage-catalog-20261005.json).

This establishes **H.264 VPU decoding for that observed device session**. It does not establish correct displayed pixels, CPU savings, end-to-end latency, prolonged stability, HEVC, AV1 or zero-copy. The trace explicitly shows a GPU copy. The successful live run used an earlier Fedora-built driver; the new four-patch Debian-built AppImage was subsequently tested on Odin KDE/Wayland as described below. A passing container test or a decoder name alone must not be presented as device hardware validation.

**Subsequent AppImage device test:** the exact rebuilt artifact also produced **7,602 Iris returns published via GPU copy**, eight driver `drop` returns and no observed Iris error markers over a trace span of approximately 127 seconds. The page reported H.264, 7,558 decoded frames and **51 browser drops** in its recorded snapshot; these counters have different scopes. The user reports that the game runs and the gamepad works. `/dev/video0` was identified as `qcom-iris-decoder`, open by a client process, with the shadow bridge off and GPU sandbox on. Native Chromium decoder statistics were not enabled in this later run: it supports Iris hardware-path activity and basic playability, but does not independently establish exclusive browser decoder use or pixel accuracy. H.265 was advertised as a browser capability but absent from the GFN settings according to the user; the reason is unconfirmed. **This was KDE/Wayland, not Gamescope.** [AppImage device evidence](experiments/packaging/validation-appimage-live-odin-20261005.json).

Full failure analysis and source-level explanation: [VA-API investigation](docs/vaapi-investigation-2026-10-05.md).

## Build and try

Node 22+ for development. Apple Silicon builds use a running Docker/Podman Linux ARM64 environment; byte-identical reproducibility is unproven.

```sh
./scripts/bootstrap
npm test
./scripts/build
./scripts/build-appimage
```

On the target, keep the AppImage at a stable absolute path:

```sh
chmod +x ./gfn-armada-0.1.0-aarch64.AppImage
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run login
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run library
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run sync
# Review the plan, then close Steam completely before applying:
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run sync --apply
```

Only bookmarked editions with GFN-reported ownership are eligible; manually confirmed ownership is identified separately. Sync backs up `shortcuts.vdf` and preserves unrelated shortcuts. Artwork download and automatic controller layouts are not implemented. Direct launch requires a verified mapping, e.g. `launch steam:1091500`; unknown IDs fail. Login/store dialogs may still appear. The observed NVIDIA route is not a guaranteed stable API.

The app inherits Gaming Mode’s display/input environment without nested Gamescope. Login lives outside the bundle under `~/.local/share/gfn-armada/chromium`; config: `~/.config/gfn-armada/config.toml`. Codec/FPS/bitrate preferences are not forwarded as invented NVIDIA options. `diagnostics` reports `unknown` when hardware use cannot be established. `GFN_ARMADA_LOG=debug` adds observations; inspect logs before sharing.

## Sources and publication

[Provenance and patches](THIRD_PARTY_NOTICES.md) · [Evidence/open work](docs/poc-status.md) · [Publication checklist](docs/publication.md)

The license for original project-specific code is **not yet selected**. Third-party licenses remain applicable; the repository is not uniformly MIT or GPL. Resolve this before public distribution.

Details: [build](docs/build.md), [bundled decoder](docs/appimage-decoder.md), [catalog](docs/catalog-import.md), [Steam](docs/steam-integration.md), [hardware investigation](docs/vaapi-investigation-2026-10-05.md). Older research notes describe historical states; use the dated PoC status as the current summary.
