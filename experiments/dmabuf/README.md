# Isolated HEVC → DMA-BUF → Electron test

This prototype loads only a local synthetic HEVC clip. The production GFN
application loads the module only when the
[H264 shadow experiment](../../docs/native-bridge.md) is explicitly enabled.
The HEVC test application described here uses no NVIDIA cookies or network
stream, and no `decodebin`, software decoder or `videoconvert` in its pipeline.

```text
filesrc → h265parse → v4l2h265dec → appsink
                                    ↓ GstSample lease / NV12 DMA-BUF
Electron main → sharedTexture.importSharedTexture → sandboxed preload
                                                      ↓ VideoFrame
                                                   2D canvas
```

## Build on Apple Silicon

```sh
./scripts/build-dmabuf
```

Output: `.artifacts/dmabuf/bridge.node` and `build-packages.txt`.
The Fedora 44 ARM64 base image is pinned by digest; DNF repositories are not
frozen. The package manifest records versions used. This is a repeatable container
build, not a demonstrated bit-identical offline build. No packages are installed
on ArmadaOS. Node-API 8 avoids coupling to Electron's V8 ABI. GStreamer >=1.24
and compatible ARM64 system libraries remain required.

## Run on the Portal

Copy `main.cjs`, `preload.cjs`, `index.html`, `package.json` and the ARM64 addon
`bridge.node` into a separate test directory. Packaged Electron needs its own
`resources/app` mapping: its executable finds the application relative to itself
and ignores another application directory passed as an argument. Libraries can
be linked from the installed bundle; production resources are not overwritten.

```sh
GFN_ARMADA_TEST_CLIP="$HOME/.local/share/gfn-armada-tests/hevc-720p.h265" \
GFN_ARMADA_OZONE=wayland ./runtime/gfn-armada-electron
```

An active desktop with correct `XDG_RUNTIME_DIR`, `DISPLAY` and `XAUTHORITY` is
needed for the X11 comparison. `GFN_ARMADA_OZONE=x11` is a separate comparison;
this import had not worked on the Portal. No `--no-sandbox` or disabled web
security. The temporary profile contains no GFN login.

The test ends after 60 fixture frames, EOS or at most 30 seconds. It requires
at least 30 transfers/renderer draw calls, color content in the canvas and all
leases released. `test-pattern.png` and the one-time pixel check are validation
only: these CPU readbacks are not part of decoder playback. Draw counters do not
measure frames actually presented by the compositor. `passed` does not establish
a GFN HEVC stream, measured end-to-end latency or zero-copy within Chromium/Gamescope.

## Limits and ownership

* Decoder is explicitly `v4l2h265dec`. Caps enforce linear NV12 with
  `memory:DMABuf`; other modifiers and missing/inconsistent `GstVideoMeta` fail.
  Raw pixels are never mapped.
* An allocation query advertises `GstVideoMeta` support so the decoder can
  provide padded CAPTURE buffers without CPU repacking.
* Color space must be negotiated BT.709 with limited or full range, passed
  explicitly to Electron. Other color spaces are rejected.
* Stride, plane size, memory offset and padded height come from GStreamer
  metadata. Each plane must occupy exactly one DMA-BUF memory. Crop metadata
  and top/left padding are rejected in this first prototype.
* The addon holds `GstSample` until `allReferencesReleased`; only then may the
  decoder reuse the CAPTURE buffer. Renderer closes VideoFrame and SharedTexture;
  main releases its own SharedTexture reference.
* At most eight native leases, four concurrent transfers, two buffered appsink
  frames. `close()` refuses while frames remain leased.
* Bounded polling in main is for this test only. GFN integration needs an
  asynchronous worker, session generations, resolution changes, audio sync
  and error/keyframe recovery. A separate Node worker and bounded H264 appsrc
  have since been implemented and tested with local H264 WebRTC on Iris at
  720p for 30 seconds. A real GFN stream requires separate validation.
  Following a live crash, a separate Electron helper now owns the decoder
  thread, all DMA-BUFs and diagnostic window. The local 720p path, deliberate
  helper SIGSEGV with browser video continuing, and subsequent Iris reopening
  are tested; see
  [validation-isolated-helper-odin.json](validation-isolated-helper-odin.json).
* This test uses Electron 44.5.1's experimental SharedTexture API. Import/GPU
  errors must not count as working output.

Sources: [Electron SharedTexture](https://github.com/electron/electron/blob/v44.5.1/docs/api/shared-texture.md),
[sandboxed renderer API](https://github.com/electron/electron/blob/v44.5.1/lib/sandboxed_renderer/api/module-list.ts),
[GStreamer DMA-DRM](https://gstreamer.freedesktop.org/documentation/video/video-info-dma-drm.html),
[GstVideoMeta](https://gstreamer.freedesktop.org/documentation/video/gstvideometa.html).
