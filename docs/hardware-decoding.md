# Hardware decoding: evidence, gaps, and test plan

**Concluded research snapshot:** [codec handover](codec-findings-2026-10-05.md)
consolidates source ownership, four patches, tests and remaining limitations.
HEVC now also has [Gamescope live output evidence](../experiments/packaging/validation-gamescope-hevc-live-odin-20261005.json),
with temporary focus routing and pre-stream focus problems. No further codec
experiments planned in this snapshot; regular Steam integration remains work.

**Subsequent AV1 update 2026-10-05:** original GFN AV1 now has a first live
VPU-path validation with the adapter's explicit experimental-profile option:
[measurement](../experiments/packaging/validation-av1-live-odin-20261005.json).
~278 seconds, GPU-copy output, no actual sync timeouts observed. Upstream's
hidden-frame limitation still applies; this does not qualify all AV1 streams.

**Update 2026-10-05:** the original GFN WebRTC stream now has a first HEVC
hardware-path validation through Chromium VA-API and the patched Iris adapter:
[measurement](../experiments/packaging/validation-hevc-live-odin-20261005.json),
[experiment and limits](hevc-follow-up-2026-10-05.md). This is the VA-API adapter
path, not Chromium's direct stateful V4L2 decoder. GPU-copy output; Gamescope,
zero-copy and AV1 remain unverified. Earlier dated analysis below is retained.

The version-specific Electron/Chromium investigation is in
[electron-decoder-investigation.md](electron-decoder-investigation.md).
It identifies the V4L2 build path disabled by default and the explicit HEVC
rejection in the stateful decoder of Chromium 152 and current main.

Snapshot: 2026-10-04. Portal demonstrated HEVC VPU decoding through Wayland
DMA-BUF handoff for a synthetic GStreamer clip. In contrast, the GFN H.264 game
stream at this stage was clearly identified as **FFmpeg software decoding**.
GFN HEVC, AV1, Gamescope, and Electron DMA-BUF import remained unconfirmed.
Diagnostics classify explicitly reported FFmpeg software decoding as `no`;
platform names/efficiency flags do not imply Qualcomm hardware success.
Historical snapshots may still contain `unknown`; check timestamps and
`nativeWebRTC` evidence. GPU rendering or low CPU load alone does not prove
hardware decoding. Later results: [current project summary](project-summary-2026-10-05.md).

## Armada stack from source

Inspected Armada commit: `43c0cca880cefbb963d5fdc1554816ffd0a5691f`.
These are precise source references, not measurements of the installed OS:

- [Kernel BASE.env](https://github.com/armada-os/armada/blob/43c0cca880cefbb963d5fdc1554816ffd0a5691f/packages/kernel/BASE.env) pins `7.2.6`.
- [Mesa BASE.env](https://github.com/armada-os/armada/blob/43c0cca880cefbb963d5fdc1554816ffd0a5691f/packages/mesa/BASE.env) pins Mesa `26.2.3` with Fedora packaging.
- [Portal DTS](https://github.com/armada-os/armada/blob/43c0cca880cefbb963d5fdc1554816ffd0a5691f/packages/kernel/dts/qcs8550-ayn-odin2portal.dts) lists `qcom,qcs8550` and `qcom,sm8550` and includes the shared AYN DTSI.
- [AYN DTSI](https://github.com/armada-os/armada/blob/43c0cca880cefbb963d5fdc1554816ffd0a5691f/packages/kernel/dts/qcs8550-ayn-common.dtsi) sets `&iris { status = "okay"; }`.
- [Config overrides](https://github.com/armada-os/armada/blob/43c0cca880cefbb963d5fdc1554816ffd0a5691f/packages/kernel/config/armada-kernel.config.overrides) set SM8550 video clocks. They are merged into ARM64 defconfig; a missing Iris override implies neither enabled nor disabled in the final kernel.
- [Base packages](https://github.com/armada-os/armada/blob/43c0cca880cefbb963d5fdc1554816ffd0a5691f/build_files/10-base-packages.sh) include FFmpeg and GStreamer plugins.

Sources alone cannot establish shipped versions, final `.config`, firmware,
driver binding, or device permissions. Measured device state is documented in
[odin-device-validation.md](odin-device-validation.md). Pinning does not prove
that the named kernel tarball includes every inspected mainline change or is
currently downloadable. A requested upstream v7.2 source file was unavailable;
current Iris sources were separately inspected on `master`.

## Qualcomm: stateful V4L2 first

Current [Iris Kconfig](https://github.com/torvalds/linux/blob/master/drivers/media/platform/qcom/iris/Kconfig)
selects V4L2 mem2mem and DMA-contiguous videobuf2.
The [VPU3x platform table](https://github.com/torvalds/linux/blob/master/drivers/media/platform/qcom/iris/iris_platform_vpu3x.c)
contains H.264, HEVC, VP9, AV1, and SM8550 platform data. This is a source-level
view; available codecs must be enumerated on the actual device. Shared tables
do not guarantee every profile, bit depth, resolution, frame rate, and firmware
combination on every board.

For Iris the first integration candidate is **stateful V4L2 mem2mem**:
compressed streams on OUTPUT, decoded pictures on CAPTURE. The Media Request
API with slice controls is a different stateless path. A `/dev/media*` node or
Chromium H265 stateless delegate does not make Iris a Request API decoder.
Venus on older SoCs and Android downstream `msm_vidc` must not be equated with
the Iris path inferred from this device tree.

Prefer 8-bit Main/SDR for the initial HEVC test. Linear NV12 is a reasonable
integration candidate **if the actual driver outputs it**. Test UBWC, modifiers,
plane layouts, P010, and cache/fence synchronization separately. Adreno 740
renders; Qualcomm's VPU decodes. Turnip alone supplies neither a VA-API decoder
nor evidence of Vulkan Video decoding.

## Chromium / Electron: missing connection

[Chromium media/gpu/args.gni](https://chromium.googlesource.com/chromium/src/+/main/media/gpu/args.gni)
defaults to `use_v4l2_codec=false`. VA-API is a different backend path, even
though ARM64 is permitted for Linux VA-API builds. A VA-API flag therefore does
not automatically connect Electron to Iris.

Current Chromium already has:

- [V4L2StatefulVideoDecoder](https://chromium.googlesource.com/chromium/src/+/main/media/gpu/v4l2/v4l2_stateful_video_decoder.cc): stateful codec/queue management and DMA-BUF/MMAP paths; explicitly rejects HEVC in the inspected revision.
- [VideoDecoderPipeline](https://chromium.googlesource.com/chromium/src/+/main/media/gpu/chromeos/video_decoder_pipeline.cc): V4L2 backend selection with Linux-specific frame allocation. The `chromeos` directory name does not prove ChromeOS-only execution.
- [PlatformVideoFrameUtils](https://chromium.googlesource.com/chromium/src/+/main/media/gpu/chromeos/platform_video_frame_utils.cc): Linux/V4L2 render-node access for GBM.
- [PlatformVideoFramePool](https://chromium.googlesource.com/chromium/src/+/main/media/gpu/chromeos/platform_video_frame_pool.cc): DMA-BUF frame resources.
- [GpuVideoDecodeAcceleratorFactory](https://chromium.googlesource.com/chromium/src/+/main/media/gpu/gpu_video_decode_accelerator_factory.cc): V4L2 guard for Linux/ChromeOS when enabled at build time.

These `main` sources move and do **not** prove that bundled Electron 44 has
this exact revision or enabled flags. [Electron build arguments](https://github.com/electron/electron/blob/v44.5.1/build/args/all.gn)
enable proprietary codecs and Chrome FFmpeg branding. That does not enable
V4L2 decoding. System FFmpeg and Electron's internal FFmpeg are separate builds;
installing an FFmpeg V4L2 decoder does not change WebRTC.

The WebRTC HEVC build decision in
[webrtc.gni](https://webrtc.googlesource.com/src/+/refs/heads/main/webrtc.gni)
is tied to `enable_hevc_parser_and_hw_decoder`. Browser decoder capabilities
must also reach the WebRTC decoder factory and SDP offers. HEVC MP4, WebCodecs,
or `canPlayType()` does not prove WebRTC HEVC. AV1 in `getCapabilities()` may
represent a software decoder.

## HEVC and AV1 separately

| Layer | H.264 | HEVC | AV1 |
|---|---|---|---|
| Product priority | Functional fallback | First VPU proof | After HEVC |
| Current Iris source path | Present | Present | Shared VPU3x table contains AV1 |
| Actual Portal / firmware / final config | unknown | unknown | unknown |
| Bundled Electron / V4L2 backend | Unconfirmed | Unconfirmed | Unconfirmed |
| WebRTC codec offer | Collect at runtime | Collect at runtime | Collect at runtime |
| GFN negotiation in this app | unknown | unknown | unknown |
| Hardware decoder actually active | unknown | unknown | unknown |

[Current NVIDIA codec documentation](https://nvidia.custhelp.com/app/answers/detail/a_id/5824)
describes automatic selection and codec options depending on OS/browser/GPU;
browser HEVC requires 8-bit color quality there. This contradicts a blanket
claim that GFN browsers can never offer HEVC. It does **not** confirm HEVC or
AV1 for Linux ARM64 Electron on Portal. Consequently, no hard-forced HEVC/AV1
SDP patch or fabricated decoder capability report.

## Video path and zero-/low-copy

```text
GFN server (actually selected codec)
  → WebRTC depacketize / jitter buffer
  → Chromium WebRTC decoder factory / media decoder
  → stateful V4L2 OUTPUT (compressed data)
  → Iris / firmware / Qualcomm VPU
  → CAPTURE (NV12 or another supported layout)
  → DMA-BUF export/import / NativePixmap / SharedImage
  → EGL or suitable GPU backend, YUV→RGB
  → Ozone Wayland / Gamescope
  → DRM/KMS display
```

This is the **target architecture**, not the Electron bundle's actual path at
this snapshot. Low-copy requires compatible DMA-BUF plane offsets, strides,
modifiers, GBM/EGL imports, and synchronization. GPU color conversion or
compositor composition does not automatically mean CPU copies. Direct scanout
is another separate criterion; Gamescope may still composite. A Chromium flag
alone does not establish zero copies.

## Device test plan

1. Save `gfn-armada diagnostics`; add kernel/image versions. Inspect `/dev/video*`
   and `/dev/media*`, read final kernel config (`/proc/config.gz` or
   `/boot/config-$(uname -r)`). Check Iris binding and firmware errors in kernel
   logs. Missing permissions mean `unknown`, not hardware failure.
2. For every video node collect `v4l2-ctl -d /dev/videoN --all` and separate
   OUTPUT/CAPTURE formats for single-/multiplanar queues. Record M2M,
   H264/HEVC/AV1, resolution, and bit depth. Inspect topology with `media-ctl -p`
   if available. Diagnostics also record unavailable tools as evidence.
3. Explicitly test a known local 8-bit HEVC stream with
   `ffmpeg -c:v hevc_v4l2m2m -i sample.hevc -f null -` **if the build contains
   that decoder**. Correlate decoder logs and Iris queue activity; likewise for
   H264. `-hwaccels` alone is insufficient; V4L2m2m also appears as a decoder.
   Null output does not prove a DMA-BUF rendering chain.
4. Optionally inspect GStreamer `gst-inspect-1.0 video4linux2` / `v4l2codecs` and
   suitable decoders. GStreamer can provide independent decode/import tests;
   it does not implement a replacement for Electron WebRTC.
5. First test the Chromium build against the same local HEVC stream. Check GPU
   process/sandbox access to video/DRM nodes. Then test WebRTC HEVC with a
   controlled peer, and only afterwards start GFN.
6. Evaluate `GFN_ARMADA_LOG=debug gfn-armada launch`, `chrome://gpu`, and WebRTC
   snapshots: codec, decoder, frames, drops, mean decode time.
   `totalDecodeTime/framesDecoded` averages since stream start, not end-to-end
   latency. Missing statistics remain unknown.
7. Correlate V4L2 queues and Iris activity through trace/strace or suitable
   kernel tracepoints **in time with this exact stream**. Exclude software
   decoders. Only codec + selected hardware path + active Iris VPU establish
   proof. `powerEfficientDecoder` is merely a browser indication.
8. Record DMA-BUF imports and CPU mappings separately. Compare GPU/compositor
   traces, formats/modifiers, CPU load, and dropped frames before/after changes.
   Save HEVC proof, then repeat for AV1.

## Smallest next build/patch step

No patch without reproducing a failure. First save the actual Electron Chromium
commit and `args.gn`. Check whether `use_v4l2_codec=true`, suitable Ozone
Wayland/GBM, and `enable_hevc_parser_and_hw_decoder` can be built, and whether
`IsV4L2DecoderStateful()` chooses correctly. Check `use_vaapi`/AV1 flag dependencies
in the actual GN graph; do not use unverified recipe flags.

If local HEVC VPU decoding works but Chromium fails, isolate backend selection/
SupportedConfigs, Iris queue formats, HEVC bitstream conversion, sandbox device
access, frame pool, or GPU import. Patch only the demonstrated missing
connection. Relevant components are listed above. Neither an Android/MediaCodec
bridge nor a full permanently maintained Chromium fork is the initial step.

## Implemented telemetry limits

Preload observes new `RTCPeerConnection`s in the main window and calls
`getStats()`. Workers, other frames, existing connections, or proprietary
transport can remain invisible. Main-world hooking is best effort; GFN changes
can bypass it. The remote page can influence reports. IPC is bounded by
sender/origin/size; these reports remain **page-reported** and never set hardware
status to `yes`. `runtime.json` is a historical timestamped snapshot, not a live
hardware attestation. `active` is only the last saved session observation and
may be stale after a crash. Diagnostics do not claim freshness when reading it.

## Addendum: device test 2026-10-04

The Iris HEVC path succeeded on Portal with a synthetic clip and GStreamer,
including DMA-BUF output. The tested Electron bundle did not offer H.265 in
WebRTC. Details/limits: [odin-device-validation.md](odin-device-validation.md).
The original GFN stream at this stage was identified as FFmpeg H.264 software
decoding, without GFN hardware decoding.

The local `experiments/dmabuf` bridge was subsequently validated on Wayland:
Iris → linear NV12 DMA-BUF → Electron SharedTexture → VideoFrame → GPU canvas.
60 transfers/renderer draws, visible pattern, 60 released samples, no remaining
leases. GPU renderer: `ANGLE (freedreno, FD740, OpenGL ES 3.2)`. The adapter maps
no raw pixels. This does not prove internal Chromium/compositor copy counts,
120 Hz performance, or NVIDIA HEVC. XWayland import failed in comparison tests.
No Chromium patch has yet been required for this local Wayland path; it does
not extend GFN codec negotiation.
