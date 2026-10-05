# Direct Chromium V4L2 experiment

Snapshot 2026-10-04: build recipe prepared; **no source build or V4L2 Electron
hardware test completed**. The regular client and its NVIDIA session were
unchanged. Ordinary `scripts/build` still packages official Electron.
Later adapter results: [current summary](project-summary-2026-10-05.md).

## Goal and outstanding work

The separate GStreamer bridge demonstrated Iris → DMA-BUF → Electron for
local clips, but does not yet replace the original GFN software decoder.
This experiment instead connects Chromium's existing stateful V4L2 decoder
directly to WebRTC; the original GFN web UI remains.

Order:

1. Validate source build and GN arguments.
2. Test local WebRTC H.264 with V4L2 actually selected.
3. Attribute Iris queue activity and DMA-BUF output to that same stream.
4. Test real GFN H.264, including controller, exit, and restart.
5. Test a separate HEVC passthrough build: local clip, flush, reset, resolution
   changes, errors, and controlled WebRTC reception.
6. Only then investigate GFN HEVC negotiation. AV1 is initially disabled.

The bridge's known color-space rejection remains open but does not block this
independent Chromium experiment. The earlier GFN SIGSEGV lacks a useful stack;
its cause remains unknown. Bridge process isolation was checked with an
intentional helper SIGSEGV on Portal.

## Provenance and inputs

Both patches are unchanged from user-supplied `gfn-electron-v4l2.zip`.
Archive/patch checksums: [sources.json](../build/electron-v4l2/sources.json).
Both passed `git apply --check` against the corresponding Chromium 152 files.
This is neither successful compilation nor a device test.

Electron `44.5.1`, commit `19c601167d4ae75989938416c18ed81eb21c6020`, uses
Chromium `152.0.7977.130`. depot_tools is pinned to
`8a5434051036b32412a2ecb10c213a72e3f3ccb9`, with automatic updates disabled.
The container uses the known Node 24.18.0 image index by digest, this time with
Linux x86_64 as build host; the target is ARM64. APT packages are **not** pinned
by snapshot; installed versions are recorded in `builder-packages.txt`.
Full reproducibility remains open.

The recipe follows official [Electron source build instructions](https://www.electronjs.org/docs/latest/development/build-instructions-gn).
Host dependencies, GN generation, PGO downloads, and Siso/Autoninja still need
validation in the first actual build. Unknown GN arguments fail rather than
being silently ignored.

## Variants

`h264`: V4L2 on, VA-API off, HEVC/AV1 hardware advertisement off; sandbox broker
patch only. `hevc`: additional HEVC passthrough patch and HEVC build flags.
Each variant needs its own checkout. The script rejects variant switches in
the same checkout and does not force conflicting patches.

The HEVC patch removes the rejection. Complete access units, parameter sets,
and decoder states remain unvalidated; an H.264 reassembler comment does not
prove HEVC correctness. The sandbox patch allows `/dev/video0..255` and
`/dev/media0..255`; a distributable binary must narrow necessary decoder access.
Sandbox disabling and `ignore-gpu-blocklist` are not recipe defaults.

## Build invocation

Requires Python 3 and a running Docker/Podman engine. A Linux x86_64 host is
preferred. Apple Silicon can emulate the x86_64 container; build duration and
toolchain compatibility are untested. Conservatively allow 250 GiB free for the
first checkout; 32 GiB RAM recommended, checking VM RAM separately. Preflight
reads only architecture, engine availability, and storage; it downloads nothing.

```sh
./scripts/build-electron-v4l2 preflight --checkout /large-disk/gfn-electron-h264
./scripts/build-electron-v4l2 sync --checkout /large-disk/gfn-electron-h264
./scripts/build-electron-v4l2 configure --checkout /large-disk/gfn-electron-h264
GFN_BUILD_JOBS=4 ./scripts/build-electron-v4l2 build --checkout /large-disk/gfn-electron-h264
```

On macOS the container engine must share the selected path. Prefer a suitable
Linux filesystem for source checkouts with many small files. The script mounts
only the build recipe read-only and the explicit checkout, not GFN profiles or
video/GPU devices. Container files are created as root; adjust ownership as
needed on Linux. No automatic checkout or Docker-cache deletion.

The first storage check reported about 7 GiB free; final preflight reported
**15.7 GiB free** and stopped before image build or source checkout. Docker runs
on aarch64, so compilation has not started here. `configure`/`build` require
separate remaining-space reserves of 20/80 GiB; these are conservative estimates.

Successful compilation would produce
`<checkout>/src/out/Gfn-v4l2-h264/dist.zip`, SHA256, resolved GN arguments,
dependency revision list, source manifest, and local Chromium diff. No automatic
replacement of the regular runtime.

## Isolated device test after building

Extract into a new test directory. Run the existing local test with the new
binary, retaining sandboxing and a temporary profile:

```sh
/path/to/test-runtime/electron \
  --ozone-platform=wayland --enable-features=AcceleratedVideoDecoder \
  /path/to/gfn-armada/tests/smoke-webrtc-internals.cjs
```

This smoke also passes with software decoding: the printed **decoder name**
matters, not the exit code alone. Collect GPU profiles, V4L2 logs, and temporally
matching Iris queue activity. `powerEfficient`, `getCapabilities()`, and
`mediaCapabilities` alone are insufficient. Check DMA-BUF imports, color space,
and compositor/GPU copies separately. Identify missing sandbox/GBM/EGL access
instead of disabling sandboxing wholesale. GFN/login tests follow afterwards.
