# Code provenance and local changes

Snapshot: 2026-10-05. Attribution index, not a replacement for upstream license texts. “100% AI-generated” refers to our project-specific glue, documentation and modifications, **not** to upstream software.

## Incorporated software

| Source | Use / attribution |
|---|---|
| [Electron](https://github.com/electron/electron), `44.5.1` | Official unmodified ARM64 runtime, Chromium `152.0.7977.130`, WebRTC/FFmpeg dependencies. Preserve runtime licenses and third-party notices. |
| [phxinyang/qualcomm-iris-vaapi](https://github.com/phxinyang/qualcomm-iris-vaapi/tree/f587b14e6b22955c7250a45ff5f43588bbce2114) | **Modified and bundled** decoder adapter; pinned `f587b14e6b22955c7250a45ff5f43588bbce2114`. MIT and LGPL-2.1-or-later files; copyright lineage includes Bootlin (2019) and Max Schettler (2023). Bundle includes AUTHORS, CREDITS, COPYING files and complete patched-source archive. [Manifest](experiments/vaapi-iris/sources.json). |
| [AppImage/appimagetool](https://github.com/AppImage/appimagetool), [AppImage/type2-runtime](https://github.com/AppImage/type2-runtime) | Packaging tool/embedded runtime. [Pinned download hashes](build/appimage-sources.json); continuous release names are mutable. Preserve applicable notices. |
| `@iarna/toml` `2.2.5`, `@electron/packager` `20.3.0` | Runtime parser and build tooling; exact resolution in `package-lock.json`. Their licenses remain applicable. |
| System libva, libdrm, EGL/GLES, GBM; GStreamer in native experiments | External runtime/build dependencies. System Mesa is not replaced. |

The Iris upstream identifies [mxsrc/libva-v4l2](https://github.com/mxsrc/libva-v4l2) as its parent and Bootlin’s libva-v4l2-request as earlier lineage. It also credits [strongtz/libva-v4l2](https://github.com/strongtz/libva-v4l2) for included kernel patch files and the HEVC explicit-RPS rewrite approach. These are inherited upstream contributions, not our AI-generated patches; the included kernel patches were not applied for our measured H.264 session.

NVIDIA’s proprietary GFN web application loads from the official service at runtime. Its full application is not redistributed as project source. A downloaded web script was used for research; observed schema/routes are not a guaranteed public integration contract.

## Local Iris patches

All in [experiments/vaapi-iris/patches](experiments/vaapi-iris/patches):

| Patch | Purpose and limit |
|---|---|
| `0001-va-accept-drm-prime-2-surface-import.patch` | Checked DRM_PRIME_2 surface imports. Alone did not fix decoding; does not establish zero-copy. |
| `0002-trace-h264-slice-metadata.patch` | H.264 slice instrumentation to identify the mismatch. |
| `0003-retain-h264-slice-pps-id.patch` | Preserve actual PPS ID instead of reconstructing PPS 0; observed GFN PPS 15/16 exposed the failure. Enabled the measured native H.264 stream. |
| `0004-bound-shared-exp-golomb-reader.patch` | Reject overlong unsigned Exp-Golomb prefixes before a 32-bit shift in the shared reader, including HEVC. Boundary/UBSan checks passed. Examined issue produced a wrong value, not established memory corruption. |

[Upstream bitreader report](experiments/vaapi-iris/upstream-bitreader-report.md): **draft, not submitted/accepted**.
Chromium/Electron V4L2/HEVC and sandbox-broker patch drafts in [build/electron-v4l2](build/electron-v4l2) were not built to completion and are **not in the packaged Electron binary**. The [source manifest](build/electron-v4l2/sources.json) also records the supplied ZIP’s checksum.

Our local integration selects Wayland/ANGLE GL, explicitly locates the render node and uses the bundled adapter only under guarded conditions. GPU sandbox remains enabled; decoder selection is not proof of hardware activity.

## Research references, not imported client implementations

- [aanze/geforcenow-arm64](https://github.com/aanze/geforcenow-arm64/tree/ba818e4f14f22c4d8c658661f5f79e54022156d3): ARM64 wrapper/build reference.
- [hmlendea/gfn-electron](https://github.com/hmlendea/gfn-electron/tree/10af7432ff3097a58973496a3f266e294582b483): Electron architecture and CMS route reference. Client code/artwork not copied into our independently generated launcher.
- [armada-os/armada](https://github.com/armada-os/armada/tree/43c0cca880cefbb963d5fdc1554816ffd0a5691f): target OS, kernel/userland and Steam/FEX research.
- [OpenNOW](https://github.com/OpenCloudGaming/OpenNOW/tree/bee18c118dbc89f42319436dcdb172d5b9e15e0c), [NEXTCLIENT](https://github.com/clarkarch/nextclient/tree/5989551cc8ab1042c7bf86723d92b9084192501d): alternative streamer/API research only; their clients and auth/streamer implementations are not used in gfn-armada.
- [ValvePython/vdf](https://github.com/ValvePython/vdf/blob/master/vdf/__init__.py): binary-VDF format reference. Our parser was independently generated; Python implementation not bundled.

The original-code license remains a publication decision. Preserve upstream authorship; do not relicense third-party files under a newly selected project license. Verify the actual binary contents and all embedded-component license obligations before distribution.
