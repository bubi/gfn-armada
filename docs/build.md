# Linux ARM64 build

## Eingaben

- `package-lock.json` mit exakten npm-Versionen und Integrity-Hashes.
- Electron `44.5.1`, Packager `20.3.0`, TOML `2.2.5`.
- Containerbasis `node:24.18.0-bookworm-slim` mit Index-Digest
  `sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d`.
- Linux ARM64-Manifest des Index:
  `sha256:af01d58b748ec92b1d6e8e11429aad424fd1e68c848185399dca0596a1ab8f5c`.

Der Container baut keine eigene Chromium-Version: er paketiert offizielle
Electron-Linux-ARM64-Binaries und die JS-Anwendung. Downloadverifikation erfolgt
über den Electron-Downloader mit den Prüfsummen aus dem exakt gepinnten
Electron-npm-Paket. Ein Cachetreffer wird damit ohne erneuten, potenziell
hängenden SHASUMS-Netzwerkabruf geprüft. Netzwerk wird beim ersten
Build benötigt. Input-Reproduzierbarkeit ist vorbereitet; Byte-identische
Output-Reproduzierbarkeit über zwei kalte Builds ist noch nicht geprüft.

## Apple Silicon

```sh
./scripts/bootstrap
npm test
./scripts/build
# Podman, bei laufender Linux ARM64 machine:
CONTAINER_ENGINE=podman ./scripts/build
```

Eine laufende Linux-VM/Containerengine ist erforderlich. Das installierte Docker
CLI allein genügt nicht. Im untersuchten Host war der ausgewählte OrbStack-
Daemon nicht erreichbar. `./scripts/build` muss dies früh und verständlich
melden. Deshalb zunächst hostseitige Cross-Paketierung:

```sh
./scripts/package
```

Optional `./scripts/archive` erzeugt mit Python 3.11+ ein transportierbares
`dist/gfn-armada-0.1.0-linux-arm64.tar.gz` plus SHA256-Datei. Die Archivmetadaten
sind normalisiert; vollständige Byte-Reproduzierbarkeit der gesamten Buildkette
ist damit noch nicht nachgewiesen.

Diese Cross-Paketierung baut dasselbe Architekturziel, führt den Linux-Client auf macOS aber nicht
aus und ersetzt keinen erfolgreichen Linux-Containerlauf. Die Packager-Tests
laufen auf Node; Electron-GUI-Tests sind separat. Kein Containerdaemon wird
unaufgefordert gestartet oder umkonfiguriert.

## Packaging-Wahl

Zuerst portables Bundle: kein FUSE nötig, Profil außerhalb des Bundles,
kein Basissystempaket, direkte Steam-Launch-Datei. Das Bundle enthält den Wrapper
`gfn-armada`, den Runtimeprozess `gfn-armada-electron` und `resources/app`.
CLI-Diagnostik läuft über Electron im Node-Modus; Node muss am Ziel nicht
separat installiert werden. GUI startet mit entfernter `ELECTRON_RUN_AS_NODE`-
Variable. Das Bundle nicht als root starten. Chromium-Sandbox bleibt eingeschaltet.
Armada muss die Sandbox unterstützen; Probleme prüfen, nicht einfach abschalten.

AppImage wäre zusätzlich bequem, benötigt aber FUSE oder Extract-and-Run und
löst den V4L2-Pfad nicht. Flatpak bietet Runtimeverteilung, braucht aber sorgfältige
Video-/DRM-/Controller- und Wayland-Berechtigungen und ein passendes ARM64-SDK.
Ein Armada-RPM verändert das bootc-System und ist für das erste Experiment
unnötig. Keine dieser Varianten garantiert Hardware-Decoding.

Zielbibliotheken: glibc, GTK, NSS, ATK, GBM/EGL, Wayland/X11 und ALSA bzw.
Audiointegration. ABI-/Sandbox-/Treiberprüfung auf Armada steht aus.
Das Paketieren auf Debian beweist keine Armada-Laufzeitkompatibilität.

## Zieltest

```sh
/path/to/gfn-armada-linux-arm64/gfn-armada diagnostics
/path/to/gfn-armada-linux-arm64/gfn-armada login
GFN_ARMADA_LOG=debug /path/to/gfn-armada-linux-arm64/gfn-armada launch
```

Login persistieren, erneut starten, Controller in einem Stream testen. Erst nach
expliziter Zuordnung aus Steam starten und anschließend den Decoderpfad gemäß
[hardware-decoding.md](hardware-decoding.md) nachweisen.
