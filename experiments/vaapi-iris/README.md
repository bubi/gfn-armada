# VA-API driver for Iris: code review and test preparation

Status: 2026-10-05. Sections through “Relationship to the existing bridge” are
source review and a test plan written while the device was powered off.
Measured results begin under [Device measurements](#device-measurements-2026-10-05);
only that section provides runtime evidence.

**Continuation:** [VA-API investigation, 2026-10-05](../../docs/vaapi-investigation-2026-10-05.md).
The failure before surface creation documented below can be bypassed with
Wayland/ANGLE GL. A synthetic stream decodes on Iris; in a real GFN stream,
Chromium then reports VA-API but the driver reports OUTPUT errors. The subsequently
confirmed PPS-ID fix demonstrates **almost four minutes of H.264 hardware decoding
in a real GFN stream** (14,484 Iris frames, no observed driver errors/fallbacks).
At that stage HEVC and visual image correctness remained unconfirmed; the path
uses a GPU copy. See [`validation-pps-fix-odin.json`](validation-pps-fix-odin.json).
For later HEVC/AV1 results, see [the project summary](../../docs/project-summary-2026-10-05.md).

## Why this path is a candidate

Read from the shipped Linux ARM64 Electron binary
(`dist/gfn-armada-linux-arm64/gfn-armada-electron`, 220 MB):

| | Matches | Contents |
|---|---|---|
| V4L2 | 19 | Capture paths only (`v4l2_capture_delegate.cc`, `video_capture_v4l2.cc`) |
| VA-API | 80 | `VaapiVideoDecoder`, `H264VaapiVideoDecoderDelegate::SubmitDecode`, `libva.so.` |

Not a single V4L2 **decode** symbol. Official Electron is built with
`use_vaapi = true` and `use_v4l2_codec = false`; `libva` is the only compiled
hardware-decode entry point. This explains why `WebRtcAllowH265Receive` alone
had no effect — a compile-flag issue, not a runtime-switch issue (see
`docs/electron-v4l2-experiment.md`).

Two ways forward follow: build Chromium, or provide a **VA-API driver for Iris**.
The latter requires no browser build.

Mesa does **not** provide this. Freedreno has no video decode; Iris is a separate
IP block behind a V4L2 kernel driver. There is no automatic V4L2-to-VA-API translation.

## Candidate

[`phxinyang/qualcomm-iris-vaapi`](https://github.com/phxinyang/qualcomm-iris-vaapi),
pinned in [`sources.json`](sources.json) to `f587b14e`, 100 commits,
MIT and LGPL-2.1-or-later. Copyright headers name Bootlin (2019) and
Max Schettler (2023): this follows the existing `libva-v4l2` lineage, not a
new implementation from scratch.

The match is unusually close. Upstream qualified Snapdragon **SM8550**, Fedora
44 ARM64, Chrome 152 and `qcom-iris`. Our device is SM8550 (Adreno 740, measured
as `ANGLE (freedreno, FD740)`); ArmadaOS is Fedora-based, Electron 44.5.1 uses
Chromium 152, and the node reports `qcom-iris-decoder`.

## Code review

Read: all of `src/codec/bitwriter.h`, `src/va/driver.h`, `src/iris/slots.cc`,
`src/meson.build`, Fedora spec, README and TEST-RESULTS.

**Memory safety is designed in.** The bitstream writer uses `std::vector<uint8_t>`
and `push_back`, rather than a fixed buffer that could overflow. `BitReader::bit()`
checks `p >= size_bits()` and returns 0 at the boundary; all reads pass through
`bit()`, so `seek`/`skip` without their own checks do not cause out-of-bounds reads.

**VA object management is sound.** VA IDs map to `std::shared_ptr` through
`std::map`; failed lookups throw `iris::Error` with the VA status. An invalid
`VASurfaceID` from a client thus returns a VA error rather than crashing.
A `std::recursive_mutex` protects the tables with documented scope.

**RAII file descriptors.** `Frame::~Frame()` and `SlotPool::~SlotPool()` close
resources; `scratch_fd_` is set to `-1` after closing to avoid a double close.
Client-imported `import_fd_` is deliberately not closed: the kernel holds its
own dma_buf reference after `queue_buffer_dmabuf`.

**A real latent bug.** In `BitReader::ue()`:

```cpp
unsigned zeros = 0;
while (!bit() && zeros < 32) ++zeros;
return ((1u << zeros) - 1) + bits(zeros);
```

Exactly 32 leading zeros cause undefined behavior in `1u << 32` (shift at least
the type width), reachable through malicious or damaged bitstreams. The result
is an incorrect value, not memory corruption: it is not used for indexing here.
It should still be reported upstream. Related edge cases: `su()` with `count == 64`
and `bits()` with `count > 64` would also cause UB, but callers do not reach them.

**Assessment.** The code reflects familiarity with V4L2 and VA-API. The project
also uses the same evidence standard as this repository: a mapped node or a
running GPU process alone proves nothing.

## Concerns

At review time: zero stars, one author, two weeks old, last updated on the day
of creation. All test results were **self-reported**; the 76 KB `TEST-RESULTS.md`
lists boot IDs, kernel/module hashes and distinguishes Passed from Pending,
but had no independent validation.

The deployment context matters more: a userspace driver loaded into **Chromium's
GPU process**, processing external bitstreams with its own HEVC/AV1 reconstruction.
It runs in a process serving the authenticated NVIDIA session. This project
had already experienced an unexplained SIGSEGV.

Upstream explicitly did **not** advertise AV1; HEVC Main achieved Fluster 111/147,
which the author attributed to firmware capability.

## Procedure

No host-image changes, `rpm-ostree` layering or system-wide installation. Build
the module in a disposable container and load only through `LIBVA_DRIVERS_PATH`;
removal means deleting one directory.

```sh
# 1. Check prerequisites. Changes nothing and starts no client.
experiments/vaapi-iris/preflight.sh

# 2. Build the driver in a container into a user directory.
experiments/vaapi-iris/build-driver.sh

# 3. Measure capabilities against a baseline without the driver.
GFN_VAAPI_ROOT=~/.local/share/gfn-armada-tests/vaapi-iris-YYYYMMDD \
GFN_ARMADA_INSTANCE=~/.local/share/gfn-armada-tests/bridge-nativequeue-20261004 \
experiments/vaapi-iris/run-probe.sh
```

Step 1 determines the rest: **does ArmadaOS have `libva.so.2`?** Chromium loads
it dynamically. Without it this route needs an additional library; alternatives
are a source build or WebKit.

## Stop criteria and interpretation

`run-probe.sh` deliberately runs a baseline **without** the driver first, to
attribute any difference to the driver rather than switches.

* `video/H265` appears and `mediaCapabilities.hevc.supported` becomes `true`
  → the GPU decoder factory advertises HEVC, allowing GFN to negotiate H.265.
* `mediaCapabilities.h264.powerEfficient` becomes `true`
  → a hardware-capability indication for the currently negotiated codec.
* No difference from the baseline → investigate whether the driver loaded.

Advertised capabilities are not proof. A real stream must show
`decoderImplementation` from `getStats()` plus frames/drops over a time window,
as in the earlier FFmpeg software-decode measurement. Actual VPU output needs
correlated driver evidence, not just this capability list.

## Relationship to the existing bridge

If successful, this path makes the bridge unnecessary for production: frames
stay in the browser, eliminating replacement presentation, A/V sync, live fallback
and the helper process. Bridge work still demonstrates Iris decoding real GFN
streams in real time and remains a measurement tool. Disable it only once this
path has measured evidence.

## Device measurements (2026-10-05)

Everything below was measured on the Odin 2 Portal, kernel 7.2.6, ArmadaOS
20261002.43c0cca. Nothing installed system-wide; host image unchanged.

### Prerequisites met

`libva.so.2` is under `/lib64`, alongside libva-drm, libdrm, EGL, GLESv2 and gbm.
Iris decoder: `/dev/video0` (`driver=iris_driver`, `card=Iris Decoder`); encoder:
`/dev/video1`. Installed VA drivers are Mesa Gallium only (d3d12, nouveau, r600,
radeonsi, virtio_gpu) — **none for Qualcomm**, disproving the assumed Mesa
translation layer. `v4l2-ctl` is absent but unnecessary for the driver, which
finds the node with `glob` and `VIDIOC_QUERYCAP`.

Read by ioctl, `/dev/video0` OUTPUT (firmware input): **`H264`, `HEVC`, `VP90`,
`AV01`**, all marked compressed. CAPTURE offers `NV12`, `P010` and UBWC variants
`Q08C`/`Q10C`. Firmware accepts HEVC/AV1 and supports 10-bit formats.

### The driver decodes on this hardware

Built in a disposable container. Upstream unit tests on device: 26 cases,
0 errors; Meson suite: 14/14. libva loads it (`va_openDriver() returns 0`,
“Qualcomm Iris V4L2 stateful”).

Through FFmpeg, a clip **without B-frames** (`-tune zerolatency -bf 0`, 60 fps,
180 AUs) reports:

```text
session finish submitted=180 completed=180 errors=0 drops=0 timeouts=0 drains=1
```

B-frames fail (`syncSurface: target decode failed`, error 23). Trace explanation:
`mode=display-order`. Without the decode-order kernel module, firmware holds
frames for reordering while the client waits for frame 1; the driver times out,
drains and restarts the session. **Not relevant to the tested GFN path**, whose
game streams use no B-frames. Upstream `iris-import-probe` explicitly requires
this module (`decode-order control: NO`); the driver itself does not.

### Chromium: capabilities present, decoding absent at this stage

First finding in `media/gpu/vaapi/vaapi_wrapper.cc`: render-node discovery skips
**all non-PCI devices**. It therefore misses a SoC GPU, VA-API fails to initialize,
and feature flags alone do not fix it. `--hardware-video-device-path` bypasses
this scan.

The unchanged shipped Electron then reports:

| Codec | supported | powerEfficient |
|---|---|---|
| H.264 | true | **true** |
| HEVC | **true** | **true** |
| AV1 | true | false |

`video/H265` appears in receive capabilities and hence the SDP offer to GFN,
without a source build.

Real streaming still reports
`FFmpeg (fallback from: ExternalDecoder (VaapiVideoDecoder))`. The instrumented
driver localizes the failure before its surface handling:

```text
va init ... profiles=7
va create_config id=1 profile=13 rt_format=0x1     # HEVC Main
va create_config id=2 profile=7  rt_format=0x1     # H.264 High
session open node=/dev/video0 mode=display-order codec=H264 1920x1088
va create_context id=3 profile=7 1920x1088 targets=0
va destroy_context id=3 pending=0                  # 13 ms later
```

GPU initialization queries all profiles (6, 7, 13, 17, 18, 19) successfully.
Decoding calls **neither `querySurfaceAttributes` nor `createSurfaces`**: it creates
and discards the context. Failure is in Chromium's frame-pool setup before
calling the driver's surface methods. No Chromium error line;
`videoDecodeAcceleratorSupportedProfile` is empty.

Two hypotheses were tested and **ruled out for this failure**:

* *GPU sandbox blocks `/dev/video0`.* Disabling it changed nothing; the trace
  shows `session open node=/dev/video0` in the sandboxed GPU process.
* *Missing DRM_PRIME_2 import.* Included patch
  [`patches/0001-va-accept-drm-prime-2-surface-import.patch`](patches/0001-va-accept-drm-prime-2-surface-import.patch)
  advertises `MEM_TYPE_DRM_PRIME_2` and accepts client-allocated buffers (one
  object, linear modifier, FourCC/layout/size validation, duplicated FD,
  `persistent_export` surface for the existing copy path). Builds with
  `-Wall -Wextra`, upstream suite passes, but no behavior change because
  Chromium never reaches the surface request.

### Open at this stage

Chromium's reason was unobserved. VERBOSE logs were unavailable through the client:
logging initializes before JS, making `app.commandLine.appendSwitch('vmodule',…)`
ineffective (INFO appears, VERBOSE never). The launcher deliberately rejects
arbitrary runtime flags; `tests/launcher.test.cjs:82` checks this guarantee and
it remains intact. `tests/probe-vaapi-stream.cjs` can supply switches on argv,
but GFN starts no session in that window (0 samples in 110 s) while streaming
reliably in production. The decisive log entry was therefore missing.

### Additional finding at this stage

GFN disables AV1 for Linux **server-side**. Logged client configuration:
`"disableConfigList":["PLT=WINDOWS;VEN=QUALCOMM;COD=AV1","PLT=STEAMOS;COD=AV1","PLT=LINUX;COD=AV1",…]`.
Client capability alone does not bypass that rule. Later identity/preference
experiments are documented separately in the current project summary.
