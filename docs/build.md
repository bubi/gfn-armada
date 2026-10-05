# Linux ARM64 build

Der separate, noch nicht kompilierte V4L2-Electron-Sourcebuild ist in
[electron-v4l2-experiment.md](electron-v4l2-experiment.md) dokumentiert.
Er verändert den hier beschriebenen normalen Bundle-Build nicht.

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
./scripts/build-appimage
# Podman, bei laufender Linux ARM64 machine:
CONTAINER_ENGINE=podman ./scripts/build
```

Eine laufende Linux-VM/Containerengine ist erforderlich. Das installierte Docker
CLI allein genügt nicht. Am 2026-10-04 wurde das bereits installierte OrbStack
mit `open -a OrbStack` gestartet. Docker 28.5.2 meldet `aarch64`; der komplette
Containerbau mit 14 Tests und Paketexport ist jetzt verifiziert.
`./scripts/build` zeigt bei einer nicht erreichbaren Engine auch deren ursprüngliche
Fehlermeldung. Der Packager erzeugt als root zunächst private Ausgabeverzeichnisse;
der Container macht das distributierbare Bundle vor dem Export lesbar für den
normalen macOS-Benutzer. Das Systemprofil und Login-Daten sind nicht Teil des Builds.

Alternativ ist weiterhin hostseitige Cross-Paketierung möglich:

```sh
./scripts/package
```

Optional `./scripts/archive` erzeugt mit Python 3 ein transportierbares
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

`./scripts/build-appimage` baut zusätzlich `dist/gfn-armada-0.1.0-aarch64.AppImage`
und dessen SHA256-Datei. Tool und Type-2-Runtime sind in
`build/appimage-sources.json` anhand der SHA256-Werte gepinnt; ein abweichender
Download bricht den Build ab. Die Continuous-URLs können sich ändern; ein
Update erfordert eine ausdrücklich geprüfte neue Prüfsumme. Der Build-Container
installiert `file=1:5.44-3`; Debian-Abhängigkeiten stammen aus dem Paketarchiv,
das derzeit noch nicht auf einen historischen Snapshot gepinnt ist.
Byte-identische AppImage-Ausgaben sind nicht nachgewiesen.

Start ohne FUSE: `./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run help`.
Steam-Sync setzt diesen Runtimeparameter selbst. Profil und Cookies bleiben
außerhalb des Pakets, das Basissystem wird nicht verändert. Der Iris-VA-API-Treiber
ist nicht enthalten; das AppImage löst keinen Hardwaredecode-Pfad von selbst.
Flatpak bietet Runtimeverteilung, braucht aber sorgfältige
Video-/DRM-/Controller- und Wayland-Berechtigungen und ein passendes ARM64-SDK.
Ein Armada-RPM verändert das bootc-System und ist für das erste Experiment
unnötig. Keine dieser Varianten garantiert Hardware-Decoding.

Zielbibliotheken: glibc, GTK, NSS, ATK, GBM/EGL, Wayland/X11 und ALSA bzw.
Audiointegration. ABI-/Sandbox-/Treiberprüfung auf Armada steht aus.
Das Paketieren auf Debian beweist keine Armada-Laufzeitkompatibilität.

Runtime-Smokecheck des tatsächlich gebauten AppImage ohne reale Steam-Dateien:

```sh
docker build --platform linux/arm64 -f build/Containerfile.appimage-test -t gfn-armada-appimage-test .
docker run --rm --platform linux/arm64 gfn-armada-appimage-test
```

Dieser Test läuft als unprivilegierter Benutzer und prüft CLI, Diagnose,
unbekannte Mappings und Review/Apply/Idempotenz/Restore in einer temporären
Steam-Bibliothek. GUI, Controller, NVIDIA-Anmeldung und Gamescope benötigen den Odin.

Am 2026-10-05 erfolgreich ausgeführt: 48 Unit-Tests auf macOS und Linux ARM64,
anschließend der tatsächliche AppImage-Runtimecheck als UID 1000. Artefakt-
Prüfsumme und genaue Testgrenzen stehen in
[`validation-appimage-20261005.json`](../experiments/packaging/validation-appimage-20261005.json).
Dieses Paket wurde noch nicht auf dem Odin installiert.

## Zieltest

```sh
/path/to/gfn-armada-linux-arm64/gfn-armada diagnostics
/path/to/gfn-armada-linux-arm64/gfn-armada login
GFN_ARMADA_LOG=debug /path/to/gfn-armada-linux-arm64/gfn-armada launch
```

Login persistieren, erneut starten, Controller in einem Stream testen. Erst nach
expliziter Zuordnung aus Steam starten und anschließend den Decoderpfad gemäß
[hardware-decoding.md](hardware-decoding.md) nachweisen.
