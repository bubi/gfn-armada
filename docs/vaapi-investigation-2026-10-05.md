# VA-API continuation, 2026-10-05

The handover's pre-surface blocker is reproduced and bypassed without rebuilding
Electron or disabling the GPU sandbox. **Before the PPS-ID fix, real GFN decode remained unvalidated:**
the browser reports a hardware decoder and increasing frame counts, while the
Iris driver reports rejected compressed buffers. Those were conflicting signals,
not a successful decode result. The PPS-ID-fix results are recorded below.

## Reproduction and bypass

`tests/probe-vaapi-local.cjs` runs a synthetic 1280×720 H.264 WebRTC loopback in
an isolated temporary profile. No NVIDIA authentication, media payload export,
or host image changes are involved. Chromium logging flags are on native argv.
The existing launcher continues rejecting arbitrary flags.

Measured on the Odin using the existing patched libva module:

| Run | Frame-pool path | Result |
| --- | --- | --- |
| X11, default GL backend | `Initializing ImageProcessor; max buffers: 5` | FFmpeg fallback, no VA surfaces |
| Wayland, `--use-gl=angle --use-angle=gl` | `No ImageProcessor needed` | NV12 VA surfaces; Iris submitted 445, completed 444, errors 0, drops 1, timeouts 0 at shutdown |

The comparison changes both Ozone and GL selection; it does not separately
prove which one suffices. Zero-copy is not established. The stock kernel's
publish policy may use a GPU copy. The local page's `getStats()` hides the
implementation name (`unknown`); the native Chromium logs and driver trace
provide the decoder evidence. The probe now also collects the existing
`chrome://webrtc-internals` observation mechanism.

## Source explanation

Sources are the exact Electron Chromium tag `152.0.7977.130`:

* [GetPreferredRenderableFourccs](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/mojo/services/gpu_mojo_media_client_linux.cc):
  GL includes NV12/P010 only when its zero-copy feature **and** the corresponding
  `supports_*_gl_native_pixmap` GPU capability are available. Otherwise AR24/BGR4
  remain. The feature is enabled by default in this tag.
* [PickDecoderOutputFormat](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/gpu/chromeos/video_decoder_pipeline.cc):
  chooses an ImageProcessor when the decoder format is not directly renderable.
* [ImageProcessorFactory](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/gpu/chromeos/image_processor_factory.cc):
  VA-API attempts VA processing, which this decoder driver does not supply.
* [VaapiVideoDecoder](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/gpu/vaapi/vaapi_video_decoder.cc):
  on Linux allocates VA surfaces itself and exports them as native pixmaps.
  Thus the earlier DRM_PRIME_2 **import** patch is not the missing pre-surface
  operation on this path.

The image-processor log is observed evidence. The unavailable direct-rendering
capability is the source-based explanation, not a separately measured dump of
that internal GPU flag.

## Real GFN comparison

A separate bundle `~/.local/share/gfn-armada-tests/vaapi-local-20261005` uses
`tests/probe-vaapi-production.cjs` to run the production application after
Chromium consumes diagnostic argv. The original installed bundle and driver
are unchanged. Persistent NVIDIA profile retained; native shadow bridge off;
GPU sandbox on; Wayland/ANGLE GL selected explicitly.

At 1920×1088 coded size Chromium created NV12 surfaces and reported:
`ExternalDecoder (VaapiVideoDecoder)`, `powerEfficientDecoder=true`, 1453 frames,
0 browser drops. However the driver ended that session with **1475 submitted,
0 completed, 1475 errors**. `output error token=...` means Iris returned
`V4L2_BUF_FLAG_ERROR` on compressed OUTPUT, as verified in `Session::handle_output_returns`.
Another resolution then repeated the problem. Browser counters alone would
have falsely declared success.

The next diagnostic adds only the first four slices' numeric syntax metadata
per translator instance (NAL type, PPS ID, VA references and flags). No slice
bytes or rendered pixels are logged. This distinguishes a lost parameter-set
identifier from other unsupported reconstruction details. The driver's H.264
builder hardcodes SPS/PPS IDs to zero and omits scaling matrices; those remain
hypotheses until the metadata is read.

Evidence: `.artifacts/vaapi-investigation-20261005/evidence.jsonl` contains only
filtered decoder records, not full authenticated browser logs. Device full logs
stay private in the test directory. HEVC/GFN and AV1 remain unvalidated. This
work makes no change to the original bridge validation.

## Diagnostic driver build

`patches/0002-trace-h264-slice-metadata.patch` only emits numeric metadata for
four slices per translator instance, using the driver's existing central
Options reader. It does not change reconstruction. Compiler build succeeded;
Meson suite **14/14 passed**. Module SHA256:
`a6f77d9d5adb8ec4108c6027e3e5c98285e6d61c21e3ca95c16646c2f4d13a30`.
The first draft violated upstream's central-environment-reader check; that was
corrected before deployment. The normal Fedora mirror selection stalled;
using the official `dl.fedoraproject.org` base repository with bounded network
timeouts completed the container build, keeping RPM signature verification on.

## H.264 reconstruction defect confirmed

The diagnostic real GFN run produced four bounded metadata records:

```text
nal=5 first_mb=0 slice_type=2 pps_id=15 va_type=2 refs=4 frame_num=0 poc_type=2
nal=1 first_mb=0 slice_type=0 pps_id=15 va_type=0 refs=4 frame_num=1 poc_type=2
nal=1 first_mb=0 slice_type=0 pps_id=15 va_type=0 refs=4 frame_num=2 poc_type=2
nal=1 first_mb=0 slice_type=0 pps_id=15 va_type=0 refs=4 frame_num=3 poc_type=2
```

The pinned and current upstream `h264_pps` hardcode `pic_parameter_set_id=0`.
The retained original GFN slices therefore reference an absent PPS 15. This
explains a concrete malformed reconstructed bitstream independently of the
Wayland rendering problem. Fix `0003-retain-h264-slice-pps-id.patch` derives the
PPS identifier from the slice header, writes that ID into the generated PPS,
and keeps every original slice byte unchanged. It rejects truncated Exp-Golomb
codes, IDs above 255 and differing first-slice IDs across supplied buffers.
Generated PPS still references synthetic SPS 0; the slice names the PPS, so
no original SPS ID is required. The patch does not correct other H.264
reconstruction limitations or make a HEVC claim.

The hardware-independent regression exercises IDs 0, 15 and 255, original-slice
identity, malformed/truncated input, ID 256 and conflicting PPS identifiers.
Live validation remains necessary; a regression pass proves reconstruction of
the identifier, not firmware decoding or correct displayed pixels.

## Corrected real GFN run: hardware decode established for a bounded window

Evidence: [`validation-pps-fix-odin.json`](../experiments/vaapi-iris/validation-pps-fix-odin.json).

* Iris: **14,484 successful CAPTURE returns**, no observed OUTPUT/CAPTURE
  errors; `publish=copy-gpu` throughout.
* Chromium native WebRTC samples: **234.232 seconds**, decoder
  `ExternalDecoder (VaapiVideoDecoder)` throughout; last sample
  **14,279 decoded frames**, **0 dropped**.
* No FFmpeg fallback, no parallel shadow decoder, GPU sandbox enabled.
* GFN used PPS **16** in this run (15 in the earlier failed run), confirming
  that hardcoding even the previously observed value would be wrong.
* Live driver SHA256:
  `4f14eb72b8fdada6b3a879377b29da186618acbc841a8f3bd50c5ce916275ed0`; ARM64 upstream suite **15/15 passed**, client unit
  suite **39/39 passed** on Mac.

This establishes native Chromium H.264 hardware decoding on the Qualcomm Iris
for this observation window. It does **not** establish visually correct pixels,
end-to-end latency, CPU savings, HEVC, AV1, production reliability, or zero-copy.
The publish trace explicitly identifies a GPU copy. The session is still live,
so these counts are an observation snapshot, not final drain accounting.

Rebuild with `GFN_VAAPI_ROOT=<new-absolute-directory>
experiments/vaapi-iris/build-patched-driver.sh` on Linux ARM64. The full three
patches apply cleanly to pinned pristine upstream; resulting codec and test
files match the live build. Fedora packages remain rolling: source and patches
are pinned, RPM package versions are recorded; byte-identical builds across
future package updates are not promised.

The production application now selects ANGLE GL in its opt-in VA-API branch
when Wayland is selected. It preserves explicit X11 preferences. Launch with
`GFN_ARMADA_OZONE=wayland`, `GFN_ARMADA_VAAPI=/dev/dri/renderD128`,
`LIBVA_DRIVER_NAME=v4l2`, `LIBVA_DRIVERS_PATH=<patched-driver>/dri`, and
`LIBVA_V4L2_VIDEO_PATH=/dev/video0`. Do not enable the native shadow bridge for
this path. Keep GPU sandbox enabled. The active test instance uses the equivalent
native argv via the dedicated diagnostic entry point; main installation remains
untouched.
