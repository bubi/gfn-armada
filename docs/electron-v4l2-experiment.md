# Direkter Chromium-V4L2-Versuch

Stand 2026-10-04: Buildrezept vorbereitet, **kein Sourcebuild und kein
V4L2-Electron-Hardwaretest abgeschlossen**. Der produktive Client und seine
NVIDIA-Sitzung wurden nicht verändert. Das normale `scripts/build` paketiert
weiterhin die offizielle Electron-Runtime.

## Ziel und offene Aufgaben

Die separate GStreamer-Brücke hat Iris → DMA-BUF → Electron für lokale Clips
nachgewiesen. Sie ersetzt jedoch den Softwaredecoder des originalen GFN-Streams
noch nicht. Dieser Versuch bindet stattdessen den vorhandenen Chromium-
V4L2-Stateful-Decoder direkt an WebRTC an. Die originale GFN-Weboberfläche bleibt.

Reihenfolge:

1. Sourcebuild und GN-Argumente validieren.
2. H.264 in lokalem WebRTC mit tatsächlich ausgewähltem V4L2-Decoder testen.
3. Iris-Queueaktivität und DMA-BUF-Ausgabe demselben Stream zuordnen.
4. Echten GFN-H.264-Stream testen, inklusive Controller, Beenden und Wiederstart.
5. Separaten HEVC-Passthrough-Build testen: lokaler Clip, Flush, Reset,
   Auflösungswechsel, Fehler und kontrollierter WebRTC-Empfang.
6. Erst anschließend GFN-HEVC-Aushandlung prüfen. AV1 ist vorläufig ausgeschaltet.

Die bekannte Farbraumablehnung der bisherigen Brücke ist weiter offen. Sie
blockiert den unabhängigen Chromium-Versuch nicht. Der frühere GFN-SIGSEGV
hat keinen verwertbaren Stack; seine Ursache bleibt offen. Die Prozessisolation
der Brücke ist dagegen mit absichtlichem Helper-SIGSEGV auf dem Portal geprüft.

## Herkunft und Eingaben

Die zwei Patches stammen unverändert aus dem vom Nutzer bereitgestellten
`gfn-electron-v4l2.zip`. Archiv-/Patchprüfsummen stehen in
[`sources.json`](../build/electron-v4l2/sources.json). Beide bestanden
`git apply --check` gegen die entsprechenden Chromium-152-Quelldateien.
Das ist weder eine erfolgreiche Kompilierung noch ein Gerätetest.

Electron `44.5.1`, Commit `19c601167d4ae75989938416c18ed81eb21c6020`, verwendet
Chromium `152.0.7977.130`. depot_tools ist auf
`8a5434051036b32412a2ecb10c213a72e3f3ccb9` fixiert und automatische Updates
sind deaktiviert. Der Container nutzt den bereits bekannten Node-24.18.0-
Imageindex per Digest, diesmal mit Linux-x86_64 als Buildhost. Das Ziel ist ARM64.
APT-Pakete sind **nicht** per Snapshot fixiert; installierte Versionen werden
in `builder-packages.txt` erfasst. Vollständige Reproduzierbarkeit bleibt offen.

Das Rezept folgt dem offiziellen
[Electron-Sourcebuild](https://www.electronjs.org/docs/latest/development/build-instructions-gn).
Hostabhängigkeiten, GN-Generierung, PGO-Downloads und Siso/Autoninja müssen im
ersten echten Build noch geprüft werden. Unbekannte GN-Argumente führen zu einem
Fehler, statt stillschweigend ignoriert zu werden.

## Varianten

`h264`: V4L2 an, VA-API aus, HEVC/AV1-Hardwareangebot aus; ausschließlich der
Sandbox-Broker-Patch. `hevc`: zusätzlicher HEVC-Passthrough-Patch und HEVC-
Buildflags. Jede Variante benötigt ihren eigenen Checkout. Das Skript verweigert
Variantenwechsel im selben Checkout und erzwingt keine konfliktbehafteten Patches.

Der HEVC-Patch entfernt die bisherige Ablehnung. Vollständige Access Units,
Parameter-Sets und Decoderzustände sind noch zu validieren; der vorhandene
H.264-Reassembler-Kommentar beweist keine HEVC-Korrektheit.
Der Sandbox-Patch erlaubt `/dev/video0..255` und `/dev/media0..255`; für ein
auslieferbares Binary müssen die notwendigen Decoderzugriffe eingegrenzt werden.
Sandbox-Abschaltung und `ignore-gpu-blocklist` sind kein Standard dieses Rezepts.

## Build-Aufruf

Python 3 und eine laufende Docker-/Podman-Engine vorausgesetzt. Ein Linux-
x86_64-Host ist bevorzugt. Apple Silicon kann den x86_64-Container emulieren;
dessen Builddauer und Toolchain-Kompatibilität sind nicht getestet.
Für den ersten Checkout konservativ 250 GiB freien Speicher vorsehen,
32 GiB RAM empfohlen; VM-RAM separat prüfen. Die Vorprüfung liest nur
Architektur, Engine-Verfügbarkeit und Speicher und lädt nichts herunter.

```sh
./scripts/build-electron-v4l2 preflight --checkout /large-disk/gfn-electron-h264
./scripts/build-electron-v4l2 sync --checkout /large-disk/gfn-electron-h264
./scripts/build-electron-v4l2 configure --checkout /large-disk/gfn-electron-h264
GFN_BUILD_JOBS=4 ./scripts/build-electron-v4l2 build --checkout /large-disk/gfn-electron-h264
```

Auf macOS muss der angegebene Pfad von der Containerengine geteilt werden.
Sourcecheckout mit sehr vielen kleinen Dateien bevorzugt auf einem geeigneten
Linux-Dateisystem bauen. Das Skript bindet nur Buildrezept (lesend) und expliziten
Checkout ein; keine GFN-Profile und keine Video-/GPU-Geräte. Containerdateien
entstehen als root; auf einem Linux-Buildhost Eigentümer nach Bedarf anpassen.
Keine automatische Löschung von Checkouts oder Docker-Caches.

Die erste Speicherprüfung meldete rund 7 GiB frei; der abschließende Preflight
meldete **15,7 GiB frei** und stoppte vor
Imagebau oder Sourcecheckout. Docker läuft auf aarch64. Deshalb wurde die
Kompilierung hier noch nicht gestartet. Für `configure`/`build` gelten getrennte
Restplatzreserven von 20/80 GiB; die Größen sind vorsichtige Schätzungen.

Ergebnis bei erfolgreicher Kompilierung:
`<checkout>/src/out/Gfn-v4l2-h264/dist.zip`, SHA256, aufgelöste GN-Argumente,
Dependency-Revisionsliste, Quellmanifest und lokaler Chromium-Diff. Kein
automatischer Austausch der produktiven Runtime.

## Isolierter Gerätetest nach dem Build

Runtime in ein neues Testverzeichnis entpacken. Den bestehenden lokalen Test
mit dem neuen Binary starten, weiterhin mit Sandbox und temporärem Profil:

```sh
/path/to/test-runtime/electron \
  --ozone-platform=wayland --enable-features=AcceleratedVideoDecoder \
  /path/to/gfn-armada/tests/smoke-webrtc-internals.cjs
```

Dieser bestehende Smoke-Test besteht auch bei Softwaredecode: entscheidend ist
sein ausgegebener **Decodername**, nicht allein der Exit-Code. Dazu GPU-
Decodeprofile, V4L2-Logs und zeitlich zugehörige Iris-Queueaktivität erfassen.
`powerEfficient`, `getCapabilities()` und `mediaCapabilities` allein reichen
nicht. DMA-BUF-Import, Farbraum und Compositor-/GPU-Kopien getrennt prüfen.
Bei Sandbox-/GBM-/EGL-Problemen die fehlenden Zugriffe identifizieren; nicht
pauschal die Sandbox abschalten. GFN- und Login-Test folgen erst anschließend.
