# Linux ARM64 build

The separate, not yet compiled V4L2 Electron source build is documented in
[electron-v4l2-experiment.md](electron-v4l2-experiment.md). It does not change
the ordinary bundle build described here. Dated test results below preserve
historical snapshots; see [current summary](project-summary-2026-10-05.md).

## Inputs

- `package-lock.json` with exact npm versions and integrity hashes.
- Electron `44.5.1`, Packager `20.3.0`, TOML `2.2.5`.
- Container base `node:24.18.0-bookworm-slim`, index digest
  `sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d`.
- Linux ARM64 manifest within that index:
  `sha256:af01d58b748ec92b1d6e8e11429aad424fd1e68c848185399dca0596a1ab8f5c`.

The container does not build custom Chromium: it packages official Electron
Linux ARM64 binaries and the JS application. The Electron downloader verifies
downloads using checksums from the exactly pinned Electron npm package. A cache
hit is verified without another potentially hanging SHASUMS network request.
The first build needs network access. Input reproducibility is prepared;
byte-identical output across two cold builds has not been checked.

The scripts create a Linux ARM64 Electron cache,
`gfn-armada-electron-cache:44.5.1`, when needed.
`Containerfile.electron-cache` uses the same lockfile and pinned Electron
checksums. The bundle build copies only its download cache, not user or Chromium
profiles. Launcher changes therefore do not repeat the large runtime download.
Direct `docker build -f build/Containerfile` requires this cache; use the build
scripts on a new machine.

## Apple Silicon

```sh
./scripts/bootstrap
npm test
./scripts/build
./scripts/build-appimage
# Podman, with its Linux ARM64 machine running:
CONTAINER_ENGINE=podman ./scripts/build
```

A running Linux VM/container engine is required; the Docker CLI alone is not
enough. On 2026-10-04, the already installed OrbStack was started with
`open -a OrbStack`. Docker 28.5.2 reported `aarch64`; a complete container build
with 14 tests and package export was verified.
`./scripts/build` also shows the engine's original error when unavailable.
The packager initially creates private output directories as root; before
export, the container makes the distributable bundle readable by the ordinary
macOS user. System profiles and login data are not part of the build.

Host-side cross-packaging remains available:

```sh
./scripts/package
```

Optional `./scripts/archive` uses Python 3 to create a transportable
`dist/gfn-armada-0.1.0-linux-arm64.tar.gz` and SHA256 file. Archive metadata is
normalized; this does not establish byte reproducibility of the entire chain.

Cross-packaging targets the same architecture but does not run the Linux
client on macOS or replace a successful Linux container run. Packager tests run
on Node; Electron GUI tests are separate. Container daemons are not started or
reconfigured without authorization.

## Packaging choice

Initially a portable bundle: no FUSE, profile outside the bundle, no base-system
package, direct Steam launch file. It contains wrapper `gfn-armada`, runtime
process `gfn-armada-electron`, and `resources/app`. CLI diagnostics run through
Electron in Node mode; the target needs no separate Node installation. GUI
launch removes `ELECTRON_RUN_AS_NODE`. Do not run the bundle as root. Chromium's
sandbox remains enabled. Armada must support it; investigate problems instead
of simply disabling it.

`./scripts/build-appimage` additionally produces
`dist/gfn-armada-0.1.0-aarch64.AppImage` and its SHA256 file. The tool and Type-2
runtime are pinned by SHA256 in `build/appimage-sources.json`; mismatching
downloads abort the build. Continuous URLs can change; updates require an
explicitly verified new checksum. The build container installs `file=1:5.44-3`;
Debian dependencies come from a package archive not yet pinned to a historical
snapshot. Byte-identical AppImage output has not been demonstrated.

Launch without FUSE:
`./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run help`.
Steam sync supplies that runtime argument automatically. Profiles and cookies
remain outside the package; the base system is unchanged. The Iris VA-API driver
is now included and selected for detected target hardware under Wayland;
see [decoder packaging](appimage-decoder.md). Selection is not successful
hardware-decoding evidence. At this build snapshot, device validation remained
required. Flatpak supplies runtimes but needs careful video/DRM/controller and
Wayland permissions and a suitable ARM64 SDK. An Armada RPM modifies the bootc
system and is unnecessary for the initial experiment. None of these formats
guarantees hardware decoding.

Target libraries: glibc, GTK, NSS, ATK, GBM/EGL, Wayland/X11, ALSA/audio
integration. ABI/sandbox/driver validation on Armada was outstanding at this
stage. Packaging on Debian does not prove Armada runtime compatibility.

Runtime smoke test of the actual AppImage without real Steam files:

```sh
docker build --platform linux/arm64 -f build/Containerfile.appimage-test -t gfn-armada-appimage-test .
docker run --rm --platform linux/arm64 gfn-armada-appimage-test
```

It runs as an unprivileged user and checks CLI, diagnostics, unknown mappings,
and review/apply/idempotence/restore in a temporary Steam library. GUI,
controllers, NVIDIA login, and Gamescope require Odin.

Successfully run on 2026-10-05: 48 unit tests on macOS and Linux ARM64, followed
by the actual AppImage runtime check as UID 1000. Artifact checksum and exact
limits: [validation-appimage-20261005.json](../experiments/packaging/validation-appimage-20261005.json).
That particular package had not yet been installed on Odin at this snapshot.

## Target test

```sh
/path/to/gfn-armada-linux-arm64/gfn-armada diagnostics
/path/to/gfn-armada-linux-arm64/gfn-armada login
GFN_ARMADA_LOG=debug /path/to/gfn-armada-linux-arm64/gfn-armada launch
```

Persist login, restart, and test controllers in a stream. Launch from Steam
only after explicit mapping, then establish the decoder path following
[hardware-decoding.md](hardware-decoding.md).
