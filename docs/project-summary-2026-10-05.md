# GFN Armada – summary, 2026-10-05

**Unmaintained Proof of Concept.** Project-specific code, local patches and documentation
were created entirely by AI, under human guidance and with device tests. Third-party
code belongs to the credited authors and retains their licenses. No commitment to
maintenance, support or future compatibility; this is not an official NVIDIA, AYN
or ArmadaOS client.

## Result

The ARM64 AppImage starts as the **“GFN Armada” Non-Steam game** from Steam Gaming
Mode on the AYN Odin 2 Portal running ArmadaOS. It uses the original GeForce NOW
web application with persistent login. The user confirms controller operation and
correct display without a distracting window frame or distortion.

The final run reports **H.265, 1920×1080, 60 FPS and
`ExternalDecoder (VaapiVideoDecoder)`**. The recorded snapshot contains 9,979 decoded
frames, six browser drops and a mean Chromium decode time of 3.53 ms; the GPU process
holds `/dev/video0`. This is not end-to-end latency or a controlled performance
comparison. No additional driver completion trace was captured in this final run.
Earlier HEVC traces separately establish successful Iris VPU output.

[Final AppImage/Steam evidence](../experiments/packaging/validation-steam-client-borderless-odin-20261005.json)
· [Previous Steam HEVC run](../experiments/vaapi-iris/validation-steam-shortcut-hevc-odin-20261005.json)

## Architecture and decisions

- Electron/Chromium ARM64 loads NVIDIA's original web application. No OpenNOW
  backend, custom NVIDIA login or full Chromium fork.
- Login profile: `~/.local/share/gfn-armada/chromium`; configuration:
  `~/.config/gfn-armada/config.toml`; diagnostics: `runtime.json` in the state directory.
- The patched Iris VA-API adapter connects Chromium's VA-API decoder to Qualcomm's
  **stateful Iris/V4L2** decoder. Mesa GPU acceleration alone would not establish
  this VPU path.
- Video: GFN → WebRTC → VaapiVideoDecoder → libva/Iris adapter → Qualcomm VPU
  → DMA-BUF/GPU copy → ANGLE GL/Wayland. **Zero-copy output is not validated.**
- The tested Steam launch runs nested Gamescope inside Steam's process tracking.
  Steam recognizes its SDL/X11 output window; Chromium uses Wayland inside it.
  The latency and power consumption of this additional compositor stage have
  not been qualified.
- The experimental decoder, patches, sources and license material are included
  in the AppImage; no system-wide driver or kernel installation is required.

## Sources, thanks and local driver patches

Special thanks to **[phxinyang/qualcomm-iris-vaapi](https://github.com/phxinyang/qualcomm-iris-vaapi)**:
its existing driver is the foundation, not an original GFN Armada implementation.
Pin: `f587b14e6b22955c7250a45ff5f43588bbce2114`.

The four local patches add DRM_PRIME_2 import, bounded H.264 slice diagnostics,
preservation of the actual H.264 PPS ID, and a shared Exp-Golomb bounds check
against an undefined 32-bit shift. All patches and their limitations are explained
in the [README](../README.md#what-we-patched).

Why it initially failed:

1. Electron did not include the required direct Linux V4L2 path; an external
   VA-API adapter was needed.
2. Chromium's automatic render-node discovery missed the SoC device. The launcher
   explicitly passes the existing render node.
3. X11/default GL required an unimplemented VA-ImageProcessor. The tested
   combination of Wayland and ANGLE GL enabled the path.
4. The adapter generated PPS 0 while real GFN slices referenced PPS 15 or 16.
   The fix takes the PPS ID from the slice. Before: 1,475 submissions, zero
   completions; afterwards: successful Iris CAPTURE output.

Thanks also to aanze/geforcenow-arm64, ArmadaOS, the libva-v4l2/Bootlin lineage,
strongtz, Electron, Chromium/WebRTC, Linux, Mesa, libva/libdrm, FFmpeg,
GStreamer, Gamescope and the other build/reference projects. OpenNOW and nextclient
were investigated as references; their client implementations are not used.
Full attribution and license notes:
[README acknowledgements](../README.md#upstream-projects-and-thanks),
[THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md).

## What was tested

| Area | Evidence and limitation |
|---|---|
| H.264 | Original GFN stream: 14,484 successful Iris CAPTURE frames over approximately 234 s, correlated with Chromium VA-API; GPU copy. |
| HEVC | Original GFN stream: 7,850 Iris GPU-copy returns over approximately 131 s; followed by Gamescope and regular Steam tests. |
| AV1 | Original GFN stream: 16,639 Iris returns over approximately 278 s with experimental profiles explicitly enabled. The user observed flicker; visual acceptance failed. |
| Steam/AppImage | Final AppImage launch under Steam's reaper, correct Gamescope AppID/focus, Wayland, 1920×1080 content area; display confirmed by the user. |
| Controller | Xbox controller detection and basic game/UI operation observed; no complete Steam Input/overlay test matrix. |
| Builds/tests | Final clean code commit: 72/72 Linux ARM64 tests; AppImage smoke test as UID 1000, including driver hash/dlopen, synthetic catalog and Steam backup/restore. Local working tree: 73 tests, one from separate unpublished bridge changes. |
| Catalog/sync | Schema/pagination and temporary Steam files tested; no complete real account library automatically imported and accepted. |

Measurements apply to the observed device sessions and versions, not arbitrary
NVIDIA, Electron or ArmadaOS versions.
[Codec findings and individual evidence](codec-findings-2026-10-05.md).

## Starting from Steam and integrating games

The AppImage itself is the Non-Steam target. Run it natively on Linux, **without
Proton**. Launch options for the tested Odin path:

```text
GFN_ARMADA_GAMESCOPE=nested GFN_ARMADA_BROWSER_IDENTITY=windows %command% --appimage-extract-and-run launch
```

`codec = "hevc"` enables the experimental WebRTC HEVC preference; H.264 remains
available as fallback. The Windows browser identity is a compatibility experiment,
not decoder emulation. Its necessity has not been independently established.
Resolution/FPS/bitrate are configured in the original GFN UI; local configuration
values are not presented as invented NVIDIA API parameters. The tested stream
is 1080p/60.

The launcher uses actual server codec offers, without invented SDP codecs or deep
links. `launch steam:<appid>` and corresponding Epic/GOG/Xbox targets require a
verified mapping; unknown IDs fail cleanly.

`library` reads the GFN catalog and bookmarked store editions reported as owned.
`sync` initially displays a plan; `sync --apply` requires Steam to be stopped and
writes with a backup. Manually confirmed ownership is marked separately.
Automatic sync at every client start, artwork downloads and a fully accepted
real library remain open. The single tested client shortcut was created through
Steam's own UI after a backup; no direct writes to the live VDF.

[Steam launch guide and pitfalls](steam-client-launch.md)
· [Catalog](catalog-import.md) · [Steam sync](steam-integration.md)

## Steam test pitfalls

The first direct Wayland launch ran in the background while Steam displayed its
spinner. Manually forcing focus was only a diagnostic and caused intermittent
focus loss. The working path runs Gamescope inside Steam's reaper/AppID tracking.

An inherited Gamescope WSI layer caused a specific Vulkan swapchain error dialog.
It is disabled in nested mode. Steam overlay preloads are removed for that child
process; other preloads remain. The overlay's role in an observed Chromium startup
crash was not fully isolated. The launcher now exits with its child process rather
than leaving Steam with an apparently running game.

Steam became unresponsive during failed attempts. Restarting its webhelper alone
was insufficient; restarting the existing Gaming Mode service restored Steam.
The earlier small decorated client window was scaled and distorted the output.
The final client starts without a frame and with a native 1920×1080 content area;
the user confirmed the correction.

## Artifact and reproduction

Tested implementation commit: `8fb071d`; later commits add documentation.
AppImage SHA256:

```text
ab6d0d9f42f6c30d09a78fbed43a5ab7af18c24490eceda7e55fdf8725fb1713
```

Development on an Apple Silicon Mac; target build in a Linux ARM64 container:

```sh
./scripts/bootstrap
npm test
./scripts/build-appimage
```

Electron 44.5.1 and driver sources/patches are pinned. The workflow is repeatable;
byte-identical or completely offline reproducible builds are not established.
[Build documentation](build.md).

The separate native shadow bridge is not the default video path. Local bridge/queue
changes are not included in this clean AppImage or the implementation commits
published here.

## Open work for other developers

- Long-term stability, focus/suspend/reconnect behavior and login lifecycle.
- Steam overlay and suitable controller/overlay bindings.
- Real authenticated catalog import and direct individual-game launch for
  Steam/Epic/GOG/Xbox; the desired automatic sync with controlled writes.
- Artwork, stale shortcuts and fully tested Steam Input layouts.
- Clean HEVC integration without experimental identity/preference hooks;
  NVIDIA eligibility can change.
- AV1 flicker/hidden-frame handling; AV1 remains experimental.
- Zero/low-copy and controlled latency, CPU and power measurements.
- Upstream bitreader report: drafted but not submitted.
- A license choice for project-specific code and review before distribution.

Codec experiments were stopped for this snapshot at the user's request. The next
focus is a reliable, lightweight GFN client with library integration; these results
are available as a foundation for others.
