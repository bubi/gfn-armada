# Validierungsstand 2026-10-04

| Prüfung | Ergebnis | Aussagegrenze |
|---|---|---|
| `npm test` | 14/14 bestanden | Launcher, Mapping, Backup, Config, Manifest und Runtime-Argumente; keine Gerätefunktion |
| JS-Syntaxprüfung Main/Preload | bestanden | kein Ersatz für Streamingtests |
| echter Electron-Start auf Apple Silicon | bestanden | macOS ARM64, nicht Armada |
| offizielle GFN-Hauptseite | im Smoke-Test geladen | kein Login und kein Spielstream |
| Renderer-Sicherheit | sandbox=true, contextIsolation=true, nodeIntegration=false geprüft | keine umfassende Sicherheitsprüfung |
| Preload → Main-World → IPC | Codec-/Controller-Report empfangen | kein aktiver Peer-/Hardwaredecoder-Nachweis |
| Linux-ARM64-Paketierung auf macOS | bestanden | Linux-Binary nicht auf dem Mac ausführbar |
| `file` des gepackten Runtime-Binary | ELF 64-bit ARM aarch64 | kein Linux-Laufzeittest |
| Linux-ARM64-Containerbau und Export | am 2026-10-04 bestanden; 14/14 Tests im Container | kein Armada-GUI-/Decoder-Test |
| NVIDIA-Login und Wiederverwendung des Profils | Gerätetest bestanden | Apple-Passwortlogin durch Nutzer; Profil beim Backend-Neustart wiederverwendet |
| Controller | Spiel erkennt Xbox-Controller; Standard-Gamepad gemeldet | GFN-Overlay-Shortcut noch zu testen |
| Steam Gaming Mode | offen | Spieltest in KDE unter XWayland |
| GFN-Spielstream unter XWayland | Gerätetest bestanden | H.264, 19.334 Frames, 0 gemeldete Drops; Decoder unknown |
| HEVC auf Qualcomm VPU | synthetischer 720p-Test bestanden | GStreamer Iris / DMA-BUF, kein GFN-Stream |
| AV1 auf Qualcomm VPU | unknown | Element vorhanden, kein Decodiertest |
| Electron auf ArmadaOS | startet und lädt GFN | H.265 fehlt im WebRTC-Angebot; Login/Stream offen |
| DMA-BUF / Low-Copy | unknown | Import-/Queue-/Compositor-Nachweis fehlt |

Am 2026-10-04 wurde das bereits installierte OrbStack gestartet. Docker 28.5.2
meldet `aarch64`. `./scripts/build` baute mit der gepinnten Linux-ARM64-
Containerbasis und exportierte das Bundle unter dem normalen macOS-Benutzer.
Das anfängliche Exportproblem wurde behoben: Packager-Ausgaben müssen vor dem
Export für den unprivilegierten Benutzer lesbar sein (`chmod -R a+rX dist`).
Die exportierte Runtime wurde als ELF für ARM aarch64 geprüft; der exportierte
Clientquellcode stimmt mit dem Repository überein. Docker Desktop wurde nicht
zusätzlich installiert. Dies ersetzt weiterhin keinen Test auf ArmadaOS.

Der echte macOS-Test vom 2026-10-03 verwendete Electron 44.5.1 / Chromium 152.0.7977.130 /
Node 24.21.0. Der Renderer meldete unter anderem H264, H265 und AV1 in den
WebRTC-Empfangsfähigkeiten. Das ist **ausschließlich ein macOS-Browserangebot**,
keine NVIDIA-Verhandlung und keine Fähigkeit des Linux-ARM64-Pakets.
Ein nichtfataler macOS-Sandbox-Resource-Warnhinweis erschien; Seite und Telemetrie
wurden trotzdem erfolgreich geladen. Die Sandbox blieb eingeschaltet.

Das Smoke-Profil liegt lokal unter `.artifacts/smoke`, getrennt von produktiven
GFN-Daten. `.artifacts` und Build-Ausgaben werden nicht committed. Kein Steam-
Profil wurde verändert. Kein Login, Passwort oder Auth-Token wurde hinterlegt.

Optionaler Smoke-Test bei installierter nativer Electron-Runtime:

```sh
XDG_CONFIG_HOME="$PWD/.artifacts/smoke/config" \
XDG_DATA_HOME="$PWD/.artifacts/smoke/data" \
XDG_STATE_HOME="$PWD/.artifacts/smoke/state" \
./node_modules/.bin/electron tests/smoke-runtime.cjs
```

Das Script beendet Electron nach Seitenladung und empfangener Telemetrie,
spätestens nach 45 Sekunden mit Fehler. Es ist wegen GUI-/Netzwerkzugriff nicht
Teil der Unit-Tests. Beim ersten Start lädt Electron seine native Runtime nach.

Gerätetest und Reproduktion: [odin-device-validation.md](odin-device-validation.md).
Nach Wayland- und Apple-Login-Korrektur bestehen lokal 17/17 Tests; der zuvor gebaute
Container lief mit 14 Tests. Das installierte Testbundle enthält die Korrektur,
das ursprüngliche Releasearchiv noch nicht.

Die anschließende Decoder-Untersuchung ergänzt Prozess-/Geräte-FD-Proben und
optionale native CDP-Media-Metadaten. 20/20 lokale Tests bestehen. Der neue
macOS-Electron-Smoke-Test mit Media-Diagnostik bestätigt zunächst Seitenladung
und Telemetrie, scheitert aber an sauberer Beendigung; nach Korrektur der
GPU-Update-Rückkopplung überschreitet ein weiterer Versuch das Startzeitlimit.
Die neue GUI-Diagnostik ist damit noch nicht vollständig validiert.
Diese Ergänzungen wurden nach Wiederherstellung des SSH-Zugriffs auf das Portal
übertragen. Der originale GFN-Webclient liefert dort einen laufenden H.264-Stream
und Controller-Telemetrie. Die 60-Sekunden-Geräteprobe beobachtet GPU-Zugriffe,
aber keinen Iris-Zugriff; native Decodermetadaten fehlen weiterhin.
Dieser frühere Test allein bestimmte die GFN-Decoderinstanz nicht; der spätere
native Reader hat sie inzwischen als FFmpeg-Softwaredecode identifiziert.
Quellbefunde: [electron-decoder-investigation.md](electron-decoder-investigation.md).

## Native WebRTC-Diagnose und Decoderadapter-Versuch

21/21 lokale Unit-Tests bestehen. `GFN_ARMADA_MEDIA_DIAGNOSTICS=1` aktiviert
zusätzlich einen gefilterten Reader für `chrome://webrtc-internals`.
Der gesonderte synthetische H.264-Smoke-Test besteht auf Mac (VideoToolbox) und
Portal (FFmpeg); das ist noch kein GFN-Test der neuen Integration.
Fedora-Chromium .57 liefert im gleichen lokalen Vergleich ebenfalls FFmpeg.
Nach zwischenzeitlichem SSH-Ausfall wurde der neue Reader mit Backup in das
Portal-GFN-Bundle integriert und im echten GFN-Spiel bestätigt: FFmpeg,
Effizienzflag false, 3.260 Frames, 0 Drops im dokumentierten Snapshot.

Die lokalen optionalen GUI-Tests ohne Login oder externe Streamserver:

```sh
./node_modules/.bin/electron tests/smoke-webrtc-internals.cjs
./node_modules/.bin/electron tests/smoke-encoded-transform.cjs
```

Der Encoded-Transform-Test besteht am Mac und Portal mit je 30 durchgereichten
H.264-Frames und Annex-B-Startcodes. Er untersucht nur den Framezugriff; kein
nativer Decoder, DMA-BUF-Import oder HEVC darin implementiert.
Die Begrenzungen und nächste Versuchsarchitektur sind in
[streamer-options.md](streamer-options.md) dokumentiert.

Der Linux-ARM64-Containerbuild wurde mit diesen Änderungen erneut erfolgreich
ausgeführt: 21/21 Tests, Packaging für Electron 44.5.1. Bundle-Export erfolgreich.
Ein zu früh parallel zum Export begonnener Archivversuch scheiterte an einem
Datei-Timeout; nach beendetem Export wurde das Archiv erfolgreich neu erzeugt.
Zwischenarchiv `dist/gfn-armada-0.1.0-linux-arm64.tar.gz` (inzwischen ersetzt):

```text
d022d019c042c7c0370c280a58b7fabeb0313fed1c0c6a31857d966728489f2b
```

Dieser Zwischenbuild enthielt den Reader. Nach anschließender konservativer
Softwareklassifikation wurden 22/22 Tests auf Mac und im Linux-ARM64-Container
bestanden und das Bundle erneut gebaut. Das Export-Script überträgt jetzt ein
Tar über den Container-Datenstrom statt per macOS-VM-Bind-Mount zu kopieren.
Die laufende Portal-Instanz meldet FFmpeg bereits in `nativeWebRTC`; die neue
`hardwareDecoderActive: no`-Zusammenfassung gilt erst nach Neustart. Keine
HEVC- oder Hardwaredecode-Fähigkeit wird durch Packaging behauptet.

Aktuelles Archiv mit 22-Test-Build und konservativer Softwareklassifikation:

```text
ad67b21a08d90b3bb027b6cf371fad9fb6fc50c413a82bf7411dfd2c1ccb8d9f
```

Die aktualisierten Clientdateien sind mit Backups auf dem Portal für den
nächsten Start bereitgestellt; das laufende Spiel wurde dafür nicht neu gestartet.

## Isolierte native DMA-BUF-Brücke (2026-10-04)

`scripts/build-dmabuf` baut das experimentelle Node-API-8-Modul im gepinnten
Fedora-44-ARM64-Image. GCC 16.2.1, GStreamer 1.28.7, Node-Header 24.18.0;
`-Wall -Wextra -Werror` erfolgreich. DNF-Paketversionen werden exportiert,
Repositories sind noch nicht eingefroren. ELF aarch64, SHA-256:

```text
fcd369709004866916387defc52e21e4187ca5fb550d95d727042937916f2ecb
```

Portal/Wayland: Iris-HEVC → NV12-DMA-BUF → Electron SharedTexture → sandboxed
VideoFrame-/Canvas-Ausgabe bestanden. 60 Transfers und Draw-Aufrufe,
60 Freigaben, 0 verbleibende Leases. Testbild per Pixelcheck und Screenshot
geprüft, ANGLE/Freedreno FD740, GPU-Compositing/OpenGL aktiv. Ownership-
Fehlerfälle werden während des realen Tests mit Assertions geprüft.
XWayland-Vergleiche fehlgeschlagen, deshalb keine Unterstützung behauptet.
Details: [Gerätetest](odin-device-validation.md),
[strukturierter Report](../experiments/dmabuf/validation-odin.json).

Bestehende 22 Launcher-/Diagnostiktests auf dem Mac bestanden; neue JS-Dateien
und Packaging-Script syntaxgeprüft. Experiment wird vom produktiven Bundle
ausgeschlossen. Das oben genannte Produktionsarchiv bleibt unverändert:
kein neues GFN-Bundle gebaut oder eine native GFN-Stream-Anbindung behauptet.
