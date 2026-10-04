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

## H264-Encoded-Frame-Brücke (nachfolgender Arbeitsschritt)

Der opt-in Anschluss ist im Client implementiert: produktiver sandboxed
Preload → komprimiertes H264-IPC → eigener Node-Worker → begrenztes GStreamer
appsrc/V4L2 → SharedTexture-Diagnosefenster. Originalbrowserdecode bleibt
aktiv. Annex-B-/SPS-/PPS-Gate, Codec-Frame-Metadaten, Receivergeneration,
Sequenz und RTP-Rollover werden geprüft. Maximal vier IPC-Pakete à 2 MiB,
native Queue acht Frames / 4 MiB. Fehler stoppen den Shadow-Pfad.

Neue native Modulprüfsumme (H264-stream-API, **noch nicht auf Iris getestet**):

```text
570f398438fbdcd7e2917ad0942cd408279b9241b62a9bf67eabe4db836efa9f
```

Mac mit realem lokalem WebRTC und produktivem Preload:

| Test | Ergebnis |
|---|---|
| H264-Encoded-Tap, finale ArrayBuffer-Typprüfung | 99 IPC-Pakete, 32 Originalbrowserframes |
| Verzögerte Paketablehnung | 1 Paket, 64 weiterlaufende Browserframes; kein gemessener Queue-Overflow |
| CSP blockiert Worker | 0 Pakete, 64 Originalbrowserframes; Preflight verhindert Einsetzen des Workers |

Ein erster CSP-Versuch ohne Worker-Preflight unterbrach die lokale Ausgabe;
die geprüfte Fassung setzt nur einen erfolgreich geladenen Worker ein.
Ein Workerabsturz nach Anbindung ist damit noch nicht abgedeckt.

Fedora-ARM64-Container: echtes Node-API-Modul geladen, Workerbereitschaft,
Fehler bei fehlendem `v4l2h264dec`-Pipelineelement und sauberer Workerabschluss
geprüft (`hardwareTested:false`). Kompiliert mit `-Wall -Wextra -Werror`.
24 Unit-Tests bestehen auf Mac und im Linux-ARM64-Build. ARM64-Paket gebaut;
alle elf Clientdateien stimmen per SHA-256 mit den finalen Quellen überein.
Ein noch laufender älterer Build wurde beendet, damit er den finalen Build
nicht überschreibt. Keine weiteren Buildprozesse dieses Projekts offen.

Die H264-appsrc-/GFN-Hardwareprobe ist wegen nicht stabil erreichbarem SSH
noch offen. Kein neuer Client auf dem Portal installiert oder aktives Spiel
für dieses Experiment beendet. Globale GFN-Hardwareklassifikation bleibt
unverändert, Shadow-Hardwarestatus `unknown`.
Aktivierung und Grenzen: [native-bridge.md](native-bridge.md).

Abschließendes ARM64-Bundle inklusive finaler Preload-Typprüfung:
`gfn-armada-0.1.0-linux-arm64.tar.gz`, SHA-256
`835e7dcbc6d8469dc97343ef5eac51556c71cb0d41c69a494cda7edfa37b57c9`.
Der erneute Paketbuild verwendete nach einem stockenden Build den bereits
vorhandenen, checksum-geprüften Electron-44.5.1-ARM64-Download als Cache.
Alle Clientdateien im exportierten Bundle stimmen mit den Quellen überein.

## H264-WebRTC-Brücke auf dem Portal, nach wiederhergestelltem SSH-Zugang

Der gesamte lokale Pfad RTCRtpScriptTransform → produktiver Preload →
Node-Worker → appsrc/h264parse/v4l2h264dec → DMA-BUF → Electron SharedTexture
bestand bei 1280×720 über 30.228 Sekunden: 882 komprimierte Pakete, 881
Transfers und Draw-Aufrufe, 881 freigegebene Samples, null offene Samples.
Ein Pixelcheck fand alle sechs Farbbalken. `/dev/video0` wurde als Iris
Decoder geöffnet; sysfs bestätigt `qcom-iris` und `qcom,sm8550-iris`.
Der Test verwendet Wayland und die Renderer-Sandbox.

Die erste Probe wurde von WebRTC auf 320×180 reduziert. Für den 720p-Test
erhält der synthetische Sender seine Auflösung über `maintain-resolution`
und eine lokale Bitratenbegrenzung. Dies sind keine GFN-Konfigurationsoptionen.
Ein weiterer 720p-Lauf deckte einen beim Schließen noch laufenden Transfer
auf. Der Client lässt dessen Lease jetzt vor dem Fensterschließen auslaufen;
nach spätestens einer Sekunde bleibt ein erzwungenes Schließen als Fallback.
Die finale Probe enthält keine Warnung über eine hängende Renderer-Referenz.

Evidenz und getestete Quellhashes:
[validation-h264-odin.json](../experiments/dmabuf/validation-h264-odin.json).
24 Unit-Tests bestehen. Dies bestätigt den lokalen H264-Hardwarepfad,
keinen echten GFN-Stream, keine CPU-Ersparnis, keine gemessene Latenz oder
Zero-Copy im Compositor. Der bestehende GFN-Client wurde nicht beendet;
kein Basispaket wurde installiert. HEVC-Aushandlung bleibt offen.

## Start des neuen GFN-Clients und Wiederanschluss nach Prüfempfänger

Der aktualisierte Client wurde auf ausdrücklichen Wunsch mit dem bisherigen
Chromium-Profil unter Wayland gestartet. GFN erzeugte schon auf der Startseite
einen kurzen Video-Prüfempfänger ohne Frames; dessen Ende schaltete zunächst
die Brücke ab. Der Hook bereitet nun nach einem framefreien Empfängerende
einen neuen Worker vor, und Main erhält den nativen Decoderanschluss. Ein
Wechsel nach tatsächlich übernommenen Frames bleibt ein Abbruchgrund.

Regression: erst einen Prüfempfänger ohne ICE/Frames erzeugen und schließen,
danach den realen lokalen WebRTC-Stream starten. Mac: 33 Encoded-Pakete und
32 Browserframes. Portal: 35 DMA-BUF-Transfers, Draw-Aufrufe und Freigaben
bei 1280×720, null offene Samples, sechs Farbbalken. Eine alternative späte
Anbindung bei `connectionState=connected` scheiterte dagegen auf Mac und
Portal: keine Encoded-Frames trotz weiterlaufendem Browservideo. Sie wurde
verworfen. Keine Hardwareaussage über einen echten GFN-Spielstream.
