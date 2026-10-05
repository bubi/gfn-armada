# Codec research handover — 2026-10-05

**AI-generated project-specific implementation and documentation, human-guided,
unmaintained PoC.** Existing upstream code retains its authorship and licenses.
Codec experimentation is concluded for this project snapshot at the user's
request. These findings are a starting point for other implementers, not a
production-support promise. Next project work concerns the GFN client and Steam.

## What works, and where the evidence stops

Target: AYN Odin 2 Portal, Snapdragon 8 Gen 2 / SM8550, Adreno 740,
ArmadaOS `20261002.43c0cca`, kernel `7.2.6`, Electron 44.5.1,
Chromium 152.0.7977.130. Actual renderer observed as ANGLE/freedreno/FD740;
Turnip Vulkan presentation is not inferred from the device GPU.

| Test | Hardware-path evidence | User-visible / qualification limits |
| --- | --- | --- |
| H.264 | Chromium VA-API plus 14,484 Iris CAPTURE frames / ~234 s in initial valid run; subsequently rebuilt bundled adapter tested | Game/gamepad operation reported; no long-term or pixel-exact qualification |
| HEVC on KDE/Wayland | Native `video/H265` / VA-API, 7,850 Iris GPU-copy returns / ~131 s, HEVC session opens; GPU process holds Iris | GFN overlay says H.265; changing resolution, no fixed-resolution benchmark |
| AV1 on KDE/Wayland | Native `video/AV1` / VA-API, 16,639 Iris GPU-copy returns / ~278 s, AV01 session opens; explicit upstream experimental profiles | Overlay says AV1; **user reports intermittent flicker, visual acceptance failed**; no actual sync timeout in inspected run |
| HEVC in Steam Gamescope session | Native H.265 / VA-API at 1920×1080/60, 8,631 Iris GPU-copy returns / ~144 s; HEVC session open, sandbox enabled | GFN and MangoHud visible; user says game works after launch; **focus loss/freezing before stream**, temporary focus workaround, not a Steam library launch |

Evidence files (each ties observations to its source/artifact hash):

- [Initial H.264 PPS-fix run](../experiments/vaapi-iris/validation-pps-fix-odin.json)
- [Bundled H.264 AppImage](../experiments/packaging/validation-appimage-live-odin-20261005.json)
- [Native H.264 statistics](../experiments/packaging/validation-native-stats-live-odin-20261005.json)
- [HEVC live run](../experiments/packaging/validation-hevc-live-odin-20261005.json)
- [AV1 live run and flicker](../experiments/packaging/validation-av1-live-odin-20261005.json)
- [Gamescope HEVC live run](../experiments/packaging/validation-gamescope-hevc-live-odin-20261005.json)

Browser frame counts and driver publications have different scopes. Decode means
(~3.7 ms HEVC desktop, ~2.8 ms AV1 desktop, ~2.9 ms HEVC Gamescope snapshots)
are **not** a controlled codec comparison, pure VPU timings or end-to-end latency.
Output is `publish=copy-gpu`: no validated zero-copy, CPU-saving or power claim.
Hardware path activity is established by correlated codec, VA-API and successful
Iris frame output; a decoder name, advertised profile or open node alone is insufficient.

## Exact path and upstream ownership

Original NVIDIA web app → Chromium WebRTC → Chromium VaapiVideoDecoder →
libva → patched `v4l2_drv_video.so` → Qualcomm stateful Iris `/dev/video0` →
NV12/GPU-copy output → Chromium ANGLE GL → Wayland → KWin or Gamescope.

No Chromium fork, native OpenNOW backend, host kernel patches or replacement
NVIDIA auth implementation was introduced for these successful runs. Direct
Chromium V4L2 decode is not the path used here. The encoded-frame shadow bridge
is a separate unfinished experiment and is disabled in these codec runs.

**Special thanks to [phxinyang/qualcomm-iris-vaapi](https://github.com/phxinyang/qualcomm-iris-vaapi)**:
its existing adapter implements the codec translation and VPU plumbing, including
HEVC and experimental AV1. Pinned commit
`f587b14e6b22955c7250a45ff5f43588bbce2114`; module SHA256 in the successful
AppImages `d4708081ceacaafabd78194d3a27c48b86a097ac990140c411802d6b25484251`.
Inherited Bootlin / Max Schettler / mxsrc libva-v4l2 lineage and licenses are
preserved. Additional strongtz reference kernel patches were not applied.
Thanks also to aanze/geforcenow-arm64, ArmadaOS, Electron, Chromium/WebRTC,
Mesa, FFmpeg, GStreamer, Linux and OpenCloudGaming/OpenNOW for the referenced
work. [README credits](../README.md#upstream-projects-and-thanks) and
[third-party notices](../THIRD_PARTY_NOTICES.md) describe incorporation versus research.

## What we patched and why early attempts failed

[Source pin](../experiments/vaapi-iris/sources.json),
[four driver patches](../experiments/vaapi-iris/patches),
[full failure analysis](vaapi-investigation-2026-10-05.md).

1. DRM_PRIME_2 import handling: added support expected by certain Chromium
   surface allocations. This did not solve the initial frame-pool failure
   and is not evidence that our measured output became zero-copy.
2. H.264 slice tracing: bounded numeric diagnostics to expose the original
   bitstream's PPS IDs and slice parameters; no auth/raw video logging.
3. Retain actual H.264 PPS ID: upstream synthesized PPS 0 while GFN slices
   referenced IDs 15/16. Iris rejected mismatching access units. This was the
   decisive H.264 bitstream fix; submitted buffers/counters alone had looked
   successful before it. Failed decode timings must not enter benchmarks.
4. Shared Exp-Golomb leading-zero boundary: reject the 32nd leading zero before
   an undefined 32-bit shift, preserving valid 31-zero cases. Robustness fix
   shared with HEVC, not the patch that enabled codec negotiation.

Chromium's default render-node discovery expected PCI DRM devices; the SoC
path needed `--hardware-video-device-path`. X11 selected an unavailable VA
image processor; native Wayland with ANGLE GL supplied a working NV12 path.
Disabling the GPU sandbox did not solve those failures. Keep it enabled.
The fourth patch has an upstream report draft; no submitted issue is claimed.

## How HEVC/AV1 negotiation changed

The original UI said Unsupported despite available H.265 receive/decoder probes.
Its public SDK has platform/remote flags, power-efficiency and Windows GPU
allowlist gates. Windows UA/navigator emulation alone did not enable the UI.

The [OpenNOW source comparison](opennow-evaluation.md#hevc-verhandlung-vergleich-vom-2026-10-05)
identified a useful pattern in its old Electron version: explicit codec selection
and WebRTC `setCodecPreferences`. Current Qt OpenNOW uses native NVST/RTSP,
which is a different architecture. No OpenNOW code was copied in this experiment.

Our opt-in [preload hook](../client/preload.cjs) runs synchronously before website
scripts and ranks real receiver capabilities before createAnswer **only when
that codec is in the actual remote offer**. The tested game offer included
H.264, HEVC and AV1; answers preferred the chosen codec and retained fallbacks.
No SDP payload was fabricated, level/tier rewritten or GPU capability spoofed.

A narrow CloudMatch POST-body hook also exists (codec field 2=HEVC, 3=AV1,
observed WebRTC/1080p60/8-bitSDR schema only), but **no request rewrite event was
observed in either successful stream**. It is not established as necessary.
Windows identity was active in both runs; its necessity is independently untested.
An answer advertising a codec is not the active-stream proof; native inbound
statistics and Iris output establish the actual selection.

## Reproduce the bounded experiments

Build Linux ARM64 on Apple Silicon using the container workflow:

```sh
./scripts/bootstrap
npm test
./scripts/build-appimage
```

Run the exact resulting artifact on the target with native Wayland available:

```sh
GFN_ARMADA_BROWSER_IDENTITY=windows GFN_ARMADA_HEVC_EXPERIMENT=1 \
GFN_ARMADA_LOG=debug V4L2_VA_TRACE=1 \
./dist/gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run launch
```

For separate AV1 qualification, replace the HEVC flag with:

```sh
GFN_ARMADA_AV1_EXPERIMENT=1 V4L2_VA_EXPERIMENTAL_PROFILES=1
```

These are environment assignments to include in the launch command, not a
standalone command. AV1 is hidden by the adapter by default because upstream
reports VA timeouts for hidden frames; this stream did not reproduce that
failure, but did show intermittent flicker. Begin at 1080p/60, 8-bit YUV 4:2:0.
The bundled adapter selection requires appropriate Iris/render nodes and Wayland;
external libva overrides can change which driver is selected. Check diagnostics.

Native statistics are on by default, in `~/.local/state/gfn-armada/runtime.json`.
The profile persists separately in `~/.local/share/gfn-armada/chromium`.
Export only sanitized measurements; raw browser/debug logs may contain account,
SDP, ICE, URL or credential data. AppImage/container tests do not establish
hardware success on another device. Package downloads are not all immutable;
byte-identical reproducibility is not established. No GitHub binary release
is claimed by this handover.

## Gamescope caveat and implementation entry points

Odin's Gaming Mode exposes `GAMESCOPE_WAYLAND_DISPLAY=gamescope-0` while the
Steam process reports an X11 session. Setting `WAYLAND_DISPLAY=gamescope-0`
and using Ozone Wayland connected our client to the existing compositor;
starting a second/nested Gamescope was unnecessary.

A direct SSH process start left Steam visible. A temporary systemd test scope
and `GAMESCOPECTRL_BASELAYER_APPID` override made the native window visible.
Original focus was backed up and restoration on client exit configured.
No Steam shortcut files were changed. Focus still oscillated before the game
stream; therefore this is an output test, not a finished Gaming Mode integration.
The proper next step is Steam launch/process association with native Wayland
selection and reliable focus, rather than shipping a forced root-property override.

For codec implementers: AV1 flicker needs fixed-resolution reproduction,
reference/surface lifetime inspection and comparison of VPU output with presented
frames. Relevant pinned adapter components: `src/codec/av1.cc`,
`src/codec/av1_obu.cc`, `src/va/picture.cc`, `src/iris/session.cc`,
`src/iris/slots.cc`, `src/iris/publish.cc`, `src/iris/gpu_copy.cc`.
AV1 defers each picture until its successor to reconstruct reference refresh
information; a candidate for investigation, not a demonstrated cause.
Do not remove opt-in gates or declare correctness based only on frame counters.

Project entry points: `client/application.cjs`, `client/preload.cjs`,
`client/webrtc-internals.cjs`, `launcher/cli.cjs`, `launcher/bundled-decoder.cjs`,
`steam-integration/shortcuts.cjs`. See [architecture](architecture.md),
[status](poc-status.md) and the dated detailed investigations for history.
