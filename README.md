# gfn-armada

Experimental GeForce NOW Electron launcher for Linux ARM64 / ArmadaOS.
Experimental native Chromium H.264 decoding on Qualcomm Iris has been measured
with a patched VA-API driver. The AppImage now includes a rebuild of that pinned
source with all four fixes, licenses and patched source archive. It selects the
experimental driver on a detected Odin Portal under Wayland; HEVC, visual
verification and zero-copy remain open. This rebuilt artifact needs a device test.

```sh
./scripts/bootstrap
npm test
node launcher/cli.cjs diagnostics
node launcher/cli.cjs login
node launcher/cli.cjs launch
```

`npm start` loads the official GFN web application. Login uses a persistent
Chromium partition in `$XDG_DATA_HOME/gfn-armada/chromium` (default
`~/.local/share/gfn-armada/chromium`). No credentials are embedded.
Create `~/.config/gfn-armada/config.toml` from `config.example.toml` if needed.
Node 22+ is required for development; the portable Linux bundle includes Electron.

Build on Apple Silicon with a running Docker/Podman Linux VM:

```sh
./scripts/build
./scripts/build-appimage
# Alternative: package the Linux ARM64 binaries on macOS, without executing them
./scripts/package
./dist/gfn-armada-linux-arm64/gfn-armada diagnostics
```

The bundle requires Armada's glibc, GTK/NSS, graphics and audio libraries. Run as
the desktop user. Sandbox stays enabled; do not add `--no-sandbox` to hide setup
failures. The system image is not modified. See [build guide](docs/build.md).

For Steam, add the bundle's **absolute** `gfn-armada` path as a Non-Steam game,
set launch options `launch steam:1091500`, and select a gamepad Steam Input layout.
Use `gfn-armada map steam:1091500 --name "Cyberpunk 2077"`, open the matching
Steam-store stream and press Ctrl+Shift+P to save its actual route. First supply a verified mapping in `~/.config/gfn-armada/games.json`; the example
file is intentionally empty. See [direct launch](docs/direct-launch.md).
An unmapped ID fails explicitly, rather than starting another game.

The ARM64 AppImage supports Steam, Epic, GOG and Xbox mapping keys. Packaged
`gfn-armada sync` reviews real Steam shortcut changes; `--apply` writes them only
with Steam stopped, preserving unrelated shortcuts and creating a restorable
backup. Only mappings with `bookmarked=true` **and** `owned=true` are eligible.
Automatic GFN account-library discovery and artwork import remain open.
See [Steam integration](docs/steam-integration.md) for AppImage commands and restore.

`GFN_ARMADA_LOG=debug gfn-armada launch` records codec/decoder observations,
controller mapping/counts, frame drops and mean decode time where available.
`gfn-armada diagnostics` probes Linux devices/tools and includes the timestamped
last client snapshot. Ctrl+Shift+D opens `chrome://gpu`, Ctrl+Shift+I opens DevTools; F11 toggles fullscreen.
Logs can contain Chromium diagnostics; keep them private and inspect before sharing.

[Architecture](docs/architecture.md) · [Hardware decoding](docs/hardware-decoding.md) · [Validation](docs/validation.md)

Earlier device tests confirmed streaming and Xbox controller recognition; the
new AppImage/Steam sync still needs a Gamescope device test. Hardware evidence
and remaining limits are recorded in [VA-API investigation](docs/vaapi-investigation-2026-10-05.md).
Browser capability advertisement does not prove codec negotiation or VPU use.
