# gfn-armada — AI-generated, unmaintained PoC

Experimental GeForce NOW launcher for **AYN Odin 2 Portal / ArmadaOS / Linux ARM64**. Keeps NVIDIA’s original web application in Electron; explores Qualcomm Iris hardware decoding, direct game launch and Steam integration.

**Proof of concept, not a maintained product.** Project-specific implementation, local patches and documentation were generated **100% by AI**, guided by a human who supplied requirements, operated the device and reported observations. Third-party software belongs to its upstream authors and is credited separately. No commitment to updates, support, issue handling or compatibility. Independent experiment; no NVIDIA, AYN or ArmadaOS endorsement.

## What is demonstrated?

Snapshot **2026-10-05**. [Evidence and remaining work](docs/poc-status.md).

| Area | Result and limits |
|---|---|
| Original GFN client | Earlier Odin sessions streamed games; Xbox controller recognition observed. Persistent Chromium profile implemented. |
| H.264 hardware decode | Original GFN stream: Chromium `VaapiVideoDecoder` and **14,484 Iris CAPTURE frames** over about 234 seconds; no observed driver errors/browser drops. **GPU copy**, not validated zero-copy. Visual correctness and long-term reliability remain unverified. |
| HEVC / AV1 | **No validated GFN hardware stream.** Synthetic local HEVC decoding is a separate experiment. |
| ARM64 AppImage | Built with pinned Electron and patched Iris driver, notices and modified driver source. Container smoke tests passed. **This rebuilt AppImage has not been tested on the Odin.** |
| Catalog → Steam | Steam/Epic/GOG/Xbox import and guarded shortcut sync implemented. Public schema checked; account import and Steam writes tested with fixtures. **Real authenticated import and Gaming Mode flow remain untested.** |

```text
Original GFN web app → Chromium WebRTC → VA-API adapter
→ Qualcomm Iris / V4L2 → DMA-BUF → GPU copy → Wayland
```

Stock Electron lacks the required Linux V4L2 decoder in this build. The experimental VA-API adapter is a patched third-party driver, distinct from Mesa’s GPU driver. No complete Chromium fork is shipped. A separate native shadow bridge remains an experiment, not the default streaming path.

## Build and try

Node 22+ for development. Apple Silicon builds use a running Docker/Podman Linux ARM64 environment; byte-identical reproducibility is unproven.

```sh
./scripts/bootstrap
npm test
./scripts/build
./scripts/build-appimage
```

On the target, keep the AppImage at a stable absolute path:

```sh
chmod +x ./gfn-armada-0.1.0-aarch64.AppImage
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run login
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run library
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run sync
# Review the plan, then close Steam completely before applying:
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run sync --apply
```

Only bookmarked editions with GFN-reported ownership are eligible; manually confirmed ownership is identified separately. Sync backs up `shortcuts.vdf` and preserves unrelated shortcuts. Artwork download and automatic controller layouts are not implemented. Direct launch requires a verified mapping, e.g. `launch steam:1091500`; unknown IDs fail. Login/store dialogs may still appear. The observed NVIDIA route is not a guaranteed stable API.

The app inherits Gaming Mode’s display/input environment without nested Gamescope. Login lives outside the bundle under `~/.local/share/gfn-armada/chromium`; config: `~/.config/gfn-armada/config.toml`. Codec/FPS/bitrate preferences are not forwarded as invented NVIDIA options. `diagnostics` reports `unknown` when hardware use cannot be established. `GFN_ARMADA_LOG=debug` adds observations; inspect logs before sharing.

## Sources and publication

[Provenance and patches](THIRD_PARTY_NOTICES.md) · [Evidence/open work](docs/poc-status.md) · [Publication checklist](docs/publication.md)

The license for original project-specific code is **not yet selected**. Third-party licenses remain applicable; the repository is not uniformly MIT or GPL. Resolve this before public distribution.

Details: [build](docs/build.md), [bundled decoder](docs/appimage-decoder.md), [catalog](docs/catalog-import.md), [Steam](docs/steam-integration.md), [hardware investigation](docs/vaapi-investigation-2026-10-05.md). Older research notes describe historical states; use the dated PoC status as the current summary.
