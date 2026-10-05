# Experimental decoder in the AppImage

Snapshot 2026-10-05: the AppImage contains `iris-driver/dri/v4l2_drv_video.so`,
pinned commit `f587b14e6b22955c7250a45ff5f43588bbce2114`, and all four patches
from `experiments/vaapi-iris/patches`: DRM-PRIME-2 import, slice tracing,
PPS-ID correction, and the shared Exp-Golomb bounds check. The build uses
Debian bookworm ARM64 with GCC 12 and GPU-copy support. The earlier Odin build
used Fedora 44: identical sources do not mean identical binaries or already
proven runtime compatibility.

`build/Containerfile.iris` builds the module and runs the static upstream checks
and Meson tests. The AppImage includes a manifest with module/patch checksums
and build package versions, license files and author notices, and
`patched-source.tar.gz` containing the complete modified sources.
The decoder is a separate dynamically loaded library. System libraries libva,
libdrm, EGL, GLESv2, GBM, and libstdc++ are supplied by the operating system;
the package does not replace Mesa/Turnip with Debian libraries.

## Selection

Without additional environment variables, the launcher selects the bundled
module when all conditions are met:

- Linux ARM64, `hardware_decode = true`.
- The device-tree model contains Odin and Portal.
- Wayland environment, without an explicit X11 override.
- Iris decoder in `/sys/class/video4linux` and a DRM render node present.
- No external VA-API driver/path already configured.
- Module checksum matches the embedded manifest.

Nodes are discovered from the available devices. The launcher sets
`LIBVA_DRIVER_NAME=v4l2`, the **internal** `LIBVA_DRIVERS_PATH`, the detected
video node, and `GFN_ARMADA_VAAPI` to the render node. The existing
Wayland/ANGLE-GL switches retain the measured browser path. Decoder selection
does not start Gamescope or disable a sandbox. Selection may advertise
capabilities including HEVC; GFN settings are not changed automatically.

Disable it for comparison with the ordinary browser path:

```sh
GFN_ARMADA_BUNDLED_IRIS=0 ./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run launch
```

`GFN_ARMADA_BUNDLED_IRIS=1` bypasses only the model check for explicit
experiments on other Iris hardware; Wayland and the devices remain required.
`auto` is the default. External `LIBVA_DRIVERS_PATH`, `LIBVA_DRIVER_NAME`, or
`GFN_ARMADA_VAAPI` take precedence and must be fully configured.
Existing Steam shortcuts launch the same file and therefore use the same
decoder version without individual driver paths.

## Diagnostics and evidence limits

`diagnostics` reports the source commit, module hash, patch list, selection
status, and reason under `bundledDecoder`. `selected: true` means **requested**,
not confirmed hardware decoding. The client records selection in its runtime
snapshot; actual decoder/frame evidence is separate.

The AppImage smoke check extracts the real package and checks four patches,
GPU-copy support, SHA256, resolvable ELF dependencies, and `dlopen` as UID 1000.
It cannot test a VPU without a device. At this historical stage, hardware
evidence applied to the separately installed H.264 driver, not this newly
built module. HEVC and AV1 were unconfirmed; the measured H.264 path used a
GPU copy. Later device results: [current project summary](project-summary-2026-10-05.md).
