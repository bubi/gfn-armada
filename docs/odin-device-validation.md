# Odin 2 Portal: device test on 2026-10-04

SSH access as a regular user; no base-system packages installed or Steam files
changed. The client was unpacked as a portable bundle under
`~/.local/opt/gfn-armada-0.1.0/gfn-armada-linux-arm64`.
The transferred archive was verified by SHA256. Main and launcher were then
updated with the repository's Wayland launch correction.

This document records successive historical tests. For the final result, see
[the project summary](project-summary-2026-10-05.md).

## System

- Device: AYN Odin 2 Portal, aarch64
- ArmadaOS: `20261001.72f2a63`, Fedora 44
- Kernel: `7.2.6`
- Graphics: Turnip Adreno 740, Mesa `26.2.3`
- Session: KDE/KWin Wayland; no Gamescope process during the test
- `/dev/video0`: `qcom-iris-decoder`, driver `qcom-iris`
- `/dev/video1`: `qcom-iris-encoder`
- No `/dev/media*` during the test; `v4l2-ctl` not installed
- FFmpeg offers `hevc_v4l2m2m` and `h264_v4l2m2m`; these were not tested.
- GStreamer `1.28.7`: `v4l2h264dec`, `v4l2h265dec`, `v4l2av1dec`

## HEVC: successful VPU test

A locally generated HEVC Main / 8-bit / 720p30 test clip with 60 frames was
successfully decoded to EOS by `v4l2h265dec`. The debug log confirms
`Opened device 'Iris Decoder' (/dev/video0) successfully` and decoder output
`video/x-raw(memory:DMABuf)`, `DMA_DRM`, `NV12`.
The pipeline contains no software decoder. This demonstrates Qualcomm VPU
operation for this clip, not a GFN hardware stream. `fakesink` does not check
DMA-BUF import into Wayland/GPU, image correctness or the number of frame copies
to display. No 1080p/120 Hz performance test yet.

Reproduction on the Portal:

```sh
mkdir -p ~/.local/share/gfn-armada-tests
ffmpeg -nostdin -hide_banner -loglevel warning \
  -f lavfi -i testsrc2=size=1280x720:rate=30 -frames:v 60 \
  -c:v libx265 -preset ultrafast \
  -x265-params pools=2:frame-threads=2:log-level=error \
  -y ~/.local/share/gfn-armada-tests/hevc-720p.h265
GST_DEBUG=v4l2*:4 timeout 20 gst-launch-1.0 -v \
  filesrc location="$HOME/.local/share/gfn-armada-tests/hevc-720p.h265" \
  ! h265parse ! v4l2h265dec ! fakesink sync=false
```

The `device` property of this generated GStreamer decoder is not writable.
An initial test with `device=/dev/video0` generated a warning; the confirming
test above was repeated without that property. AV1 and H.264 had not yet been decoded.

## Electron: GFN loads, HEVC absent from the WebRTC offer

Electron `44.5.1` / Chromium `152.0.7977.130` runs with explicit
`--ozone-platform=wayland`. Setting this only in main JavaScript was too late
for this bundle: the first launch failed on X11 access. The launcher now sets
the switch at process startup; first- and second-instance arguments are parsed
appropriately. Together with the Apple login correction, 17 tests pass on Mac.

The loaded GFN page reports `ANGLE (freedreno, FD740, OpenGL ES 3.2)` through
telemetry, with H.264, VP8, VP9 and AV1 WebRTC receive codecs.
**H.265 is absent from these runtime capabilities.** The successful GStreamer
test therefore does not yet make HEVC usable in Electron. The startup log also
contains `vaInitialize failed`; VA-API was not a confirmed Iris VPU path at this
stage. Early GPU feature snapshots before initialization reported software/disabled
and must not be interpreted alone as the final state.

The NVIDIA login page loaded. The original navigation policy blocked external
Apple sign-in pages. `appleid.apple.com` was explicitly allowed according to
Apple's [official authorization documentation](https://developer.apple.com/documentation/signinwithapplerestapi/request-an-authorization-to-the-sign-in-with-apple-server.),
and the test instance restarted. No blanket allowance for all Apple domains.
Blocked navigation logs contain only origins, not OAuth query parameters.
Successful login still needed user verification. The user confirmed that the
Apple page became accessible. “Sign in with iPhone” did not display a QR code;
no further blocked redirect/popup was logged, so another allowlist error was
not established. Electron does not automatically provide Chrome's UI for
WebAuthn hybrid transport. The
[Electron 44.5.1 WebAuthn delegate](https://github.com/electron/electron/blob/v44.5.1/shell/browser/webauthn/electron_authenticator_request_client_delegate.cc)
does not connect Bluetooth action callbacks to a QR/transport UI. This limitation
matches the observation; the Apple page's specific WebAuthn request had not been
instrumented. The initial alternative remains Apple account/password sign-in
within the same session. A full Chromium browser could support hybrid passkeys
but would require its own persistent profile. External browser login does not
automatically transfer a session to Electron; do not copy cookies/auth tokens
or invent a callback. The controller list was empty, with no confirmed gamepad
test. No active stream during this first login test; subsequent game launch is
recorded below. Hardware decoder and DMA-BUF in the GFN client remained `unknown`.

## First game stream and crash

The user signed in and started a game. At 09:10 CEST on 2026-10-04, WebRTC reported
`video/H264`, 136 decoded frames, 0 reported drops and approximately 5.45 ms mean
decode time (a short cumulative snapshot). Decoder name and `powerEfficientDecoder`
were not supplied. Seconds later the Electron main process crashed with SIGSEGV.
The system core is truncated and has no useful stack so far. Neither a VPU failure
nor a specific Wayland bug is established.

For a controlled comparison, the same profile session was restarted with
`GFN_ARMADA_OZONE=x11`, `DISPLAY=:0` and the session's existing `XAUTHORITY`.
The renderer reports Freedreno FD740 / OpenGL 4.6; GFN loads. The user confirmed
successful game launch and the built-in controller detected as an Xbox controller.
The final snapshot reported 19,334 H.264 frames, 0 drops and approximately 5.32 ms
mean decode time. Gamepad: standard mapping, 17 buttons, 4 axes. The process
remained alive after this test. This demonstrates this successful XWayland test,
not long-term stability or the precise Wayland crash cause. Native Wayland remains
the default. `GFN_ARMADA_OZONE` accepts only `x11` or `wayland` and changes neither
NVIDIA stream parameters nor the sandbox. The launcher now logs GUI exit code/signal.
18/18 local tests pass. No debugger packages installed in the base system.

## GFN overlay with a controller

NVIDIA documents holding START/menu as the default shortcut. It can be changed
under Settings → Shortcuts → Gamepad in the overlay. Since GFN 2.0.83, this
shortcut is also available on Linux and most browser platforms. Source:
[NVIDIA Support](https://nvidia.custhelp.com/app/answers/detail/a_id/5827).
Not yet confirmed on this device; no second binding was injected that could
trigger the existing shortcut twice.

Local unversioned VPU log: `.artifacts/odin/hevc-v4l2.log`.
Device test data: `~/.local/share/gfn-armada-tests/`.
Chromium debug logs may contain page messages and must be checked for personal
data before sharing; do not commit authentication logs.

## Ongoing decoder diagnostics on 2026-10-04

SSH is reachable again. Extended diagnostics run in the original GFN web client
under XWayland, Electron 44.5.1 / Chromium 152.0.7977.130. At 09:39 UTC, the stream
reports H.264, 12,157 decoded frames, 0 drops and approximately 5.10 ms cumulative
mean decode time. Controller: standard mapping, 17 buttons, 4 axes.

A 60-second probe from 09:35:31 to 09:36:31 UTC reads accessible client process
file descriptors every 250 ms. It observes `/dev/dri/renderD128`, but no
`/dev/video*` or `/dev/media*`. This shows GPU access, without observed Iris access.
The probe may miss short-lived access or other processes and does not alone prove
software decoding. Neither WebRTC nor optional CDP media diagnostics supplied a
specific decoder name. `hardwareDecoderActive` and GFN DMA-BUF remain `unknown`.
Chromium's `video_decode: enabled` feature status is also not hardware proof.

The user chose the original GFN web client. OpenNOW was downloaded and extracted
for investigation but not launched as a client. The separate successful HEVC Iris
test demonstrates the device decoder, not HEVC in a GFN stream.

## GFN decoder identified / HEVC through to Wayland

After reconnecting, the native WebRTC-internals reader was transferred into the
original client with a backup and restarted after the game stream ended.
At 10:13:50 UTC on 2026-10-04, it reports for the GFN origin: H.264, decoder
**FFmpeg**, `powerEfficientDecoder: false`, 3,260 decoded frames, 0 drops and
10.384172 s cumulative decode time. The same stream's page statistics retain
`unknown` for decoder, now reporting 3,338 frames and approximately 3.17 ms mean
decode time. Separate statistics intervals explain the time offset. Software
decoding is established for this real GFN test, closing the earlier evidence gap.

The Encoded Transform smoke test now passes on Linux ARM64: 30 forwarded synthetic
H.264 frames, 32,766 bytes, two keyframes, 30 Annex-B start codes, 43 displayed
frames. No actual GFN frames captured in this test; no native decoder bridge yet.

The existing synthetic HEVC clip was also sent through this pipeline, with
successful EOS and exit 0:

```sh
gst-launch-1.0 -v filesrc location=hevc-720p.h265 \
  ! h265parse ! v4l2h265dec ! waylandsink sync=true
```

Debug: `GST_DEBUG=v4l2*:4,waylandsink:6,wl*:6`. The log confirms Iris
`/dev/video0`, `video/x-raw(memory:DMABuf)` / `DMA_DRM` / `NV12`, 1280×720@30,
explicit `created linux_dmabuf wl_buffer`, two planes, subsequent direct writes
of existing `wl_buffer` and `wl_buffer::release`. This demonstrates VPU output
through the Wayland DMA-BUF handoff for this clip. No software decoder or
`videoconvert` in the pipeline. It does not fully establish all compositor/GPU
internal copies, Gamescope operation or visual correctness of every frame.

Device log: `~/.local/share/gfn-armada-tests/hevc-wayland.log`; local copy:
`.artifacts/odin/hevc-wayland.log` (unversioned). HEVC in GFN and DMA-BUF import
into Electron remain separate open steps at this point.

## HEVC → Iris → DMA-BUF → Electron confirmed (2026-10-04, 10:50 UTC)

The isolated `experiments/dmabuf` application was built as a Node-API-8 module
in the Fedora 44 ARM64 container and tested in a separate Electron runtime on
the Portal. No base-system packages installed, production resources or NVIDIA
sessions changed.

Explicit pipeline `filesrc ! h265parse ! v4l2h265dec ! appsink` produces Iris
NV12 DMA-BUFs. The adapter holds each `GstSample` until Electron reports
`allReferencesReleased`; no CPU mapping of raw pixels in the addon. Allocation
queries support `GstVideoMeta`. Actual buffer geometry:

| Property | Measured |
|---|---|
| Decoder / device | `v4l2h265dec`, `/dev/video0`, `qcom-iris-decoder` |
| Coded / visible | 1280×736 / 1280×720 |
| Y plane | Stride 1280, offset 0, size 942,080 bytes |
| UV plane | Stride 1280, offset 942,080, size 471,040 bytes |
| Format / color space | Linear NV12 DMA-BUF, limited-range BT.709 |
| Display | Native Wayland, sandboxed Electron 44.5.1 |
| GPU renderer | `ANGLE (freedreno, FD740, OpenGL ES 3.2)` |
| Transfers / renderer draw calls | 60 / 60 |
| Releases / remaining leases | 60 / 0 |
| Maximum concurrent leases | 4 |

Electron SharedTexture → VideoFrame → 2D canvas works in this configuration
without a Chromium patch. Pixel check: ten distinct quantized colors, canvas
1280×720. A screenshot of the synthetic test pattern was visually inspected.
GPU compositing and OpenGL are enabled; the test disables neither the sandbox
nor GPU blocklist. Invalid calls, duplicate releases and `close()` with live
leases are rejected. No isolated test-runtime processes remain after completion.

Limits: draw calls do not count frames actually presented by the compositor.
Screenshot/pixel checks are one-time CPU readbacks for validation. Internal
Chromium/compositor copies, Gamescope, 1080p/120 Hz, audio sync and GFN HEVC are
not established. The original GFN stream remains on the measured FFmpeg H.264
software path; the local bridge is not yet connected.

XWayland comparisons failed on NV12 SharedImage backing; the last also reported
software GPU features. The exact cause is open, not general proof against XWayland
DMA-BUF. An initial Wayland run reached 60 draw calls but waited for EOS until
the deadline while its final CAPTURE buffer remained visible. The test therefore
ends after the 60 known fixture frames and destroys the renderer before decoder
close. The final Wayland version passes with complete release.

Structured evidence: [validation-odin.json](../experiments/dmabuf/validation-odin.json).
Local logs/screenshot: `.artifacts/dmabuf/` (unversioned). After the successful
test, SSH became unreachable during final reconciliation. An optional additional
screenshot synchronization was abandoned; the retained version matches the
successful device test.
