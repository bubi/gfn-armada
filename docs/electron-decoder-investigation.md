# Electron → Iris: Untersuchung vom 2026-10-04

## Ergebnis und Aussagegrenzen

Die Hauptlücke liegt sehr wahrscheinlich im ausgelieferten Chromium-Decoderbackend,
nicht in fehlender Iris-Unterstützung des Geräts. Außerdem fehlt im betrachteten
stateful Chromium-Backend eine konkrete HEVC-Implementierung. Die genaue
Decoderinstanz des GFN-H.264-Streams ist weiterhin nicht festgestellt. Nach
Wiederherstellung von SSH wurden Geräte-FD-Proben im GFN-Stream durchgeführt;
der anschließend ergänzte native Statistikreader ist in isolierten lokalen
WebRTC-Tests auf Mac und Portal validiert. Vor seiner Integration in die laufende
GFN-Sitzung brach SSH erneut ab. Siehe die Ergebnisse weiter unten.

Die bisherigen GStreamer- und GFN-Tests sind in
[odin-device-validation.md](odin-device-validation.md) getrennt dokumentiert.

## Exakt passende Quellen

Electron `44.5.1` verwendet laut
[DEPS](https://github.com/electron/electron/blob/v44.5.1/DEPS)
Chromium `152.0.7977.130`, dieselbe Version wie im Gerätelog.

- [Electron all.gn](https://github.com/electron/electron/blob/v44.5.1/build/args/all.gn):
  `proprietary_codecs=true`, FFmpeg-Branding Chrome; kein V4L2-Override.
- [Electron release.gn](https://github.com/electron/electron/blob/v44.5.1/build/args/release.gn):
  importiert diese gemeinsamen Einstellungen.
- [Linux-ARM64-Buildworkflow](https://github.com/electron/electron/blob/v44.5.1/.github/workflows/pipeline-segment-electron-build.yml):
  zusätzliche Linux-ARM64-GN-Argumente setzen CPU und Linker/Installer-Optionen,
  kein `use_v4l2_codec=true`.
- [Chromium args.gni](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/gpu/args.gni):
  `use_v4l2_codec=false`; VA-API standardmäßig auch für Linux ARM64.
- [V4L2 BUILD.gn](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/gpu/v4l2/BUILD.gn):
  bindet die Backendquellen nur mit `use_v4l2_codec` ein.

Diese Kombination ist ein starker Quellbeleg für ein ohne V4L2 gebautes
Standard-Electron. Die vollständigen aufgelösten `args.gn` des veröffentlichten
Binaries liegen noch nicht vor. Es wurde kein eigener Electron-Sourcebuild
gestartet.

Die lokale Linux-ARM64-Runtime enthält VA-API- und FFmpeg-Diagnosestrings, aber
bei der Stringsuche keine `media/gpu/v4l2/`-Quellpfade oder Namen des konkreten
stateful V4L2-Decoders. Der einzelne String `V4L2VideoDecoder` ist **kein**
Backendbeweis: er steht auch im allgemeinen Enum-zu-Name-Konverter
[media/base/decoder.cc](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/base/decoder.cc).
Das Fehlen von Strings allein ist ebenfalls kein sicherer Buildflag-Nachweis.

## HEVC: zusätzlicher fehlender Decode-Pfad

In [V4L2StatefulVideoDecoder::Decode](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/gpu/v4l2/v4l2_stateful_video_decoder.cc)
werden H.264-Frames zusammengesetzt. Für HEVC folgt dagegen `NOTIMPLEMENTED()`
und die Rückgabe `kUnsupportedCodec`. Auch der am 2026-10-04 heruntergeladene
aktuelle `main` enthält diese Ablehnung. „HEVC-Sonderbehandlung“ in älteren
Architekturnotizen darf deshalb nicht als erfolgreiche HEVC-Unterstützung
verstanden werden. Ein HEVC-stateless-Delegate im selben Quellverzeichnis löst
die stateful Iris-Anforderung nicht.

Ein kleiner HEVC-Patch müsste mindestens die Bitstream-/Access-Unit-Zuführung
im stateful Decode-Pfad implementieren und gegen Iris testen. Die Ablehnung
einfach zu entfernen wäre kein korrekt validierter Fix. Zusätzlich müssen
Profilermittlung, Auflösungswechsel, Flush und Fehlerbehandlung getestet werden.
Zuerst den vorhandenen H.264-Pfad nutzbar machen, dann diese HEVC-Lücke schließen.

## Auswahl und WebRTC-Anbindung

[ActiveLinuxVideoDecoderType](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/base/decoder.cc)
wählt bei gleichzeitig eingebautem VA-API und V4L2 standardmäßig VA-API;
`PreferV4L2VideoAcceleration` wählt V4L2 nur, wenn beide Backends eingebaut sind.
Ein Featureflag kompiliert keinen fehlenden Decoder nachträglich ein.

[gpu_mojo_media_client_linux.cc](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/mojo/services/gpu_mojo_media_client_linux.cc)
bindet den gewählten Decoder an die Linux-Pipeline an. Bei GL sind zusätzlich
die Bedingungen von `AcceleratedVideoDecodeLinuxGL` relevant.
[VideoDecoderPipeline](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/gpu/chromeos/video_decoder_pipeline.cc)
wählt für stateful Geräte `V4L2StatefulVideoDecoder`.

[RTCVideoDecoderFactory](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/third_party/blink/renderer/platform/peerconnection/rtc_video_decoder_factory.cc)
benötigt für H.265 unter anderem `RTC_USE_H265`, den Empfangsfeature-Schalter
und passende vom Plattformdecoder gemeldete Profile. HEVC-Parsing allein
reicht nicht. Das bisherige Fehlen von H.265 in `getCapabilities()` passt dazu,
legt aber nicht eindeutig fest, welche dieser Bedingungen zuerst scheitert.

## Vorbereitete Diagnostik

- `gfn-armada diagnostics` erhält `processVideoAccess`: identifiziert
  Client-/Chromiumprozesse anhand von `/proc/PID/exe` und liest ausschließlich
  FD-Links zu Video-/Media-/DRM-Geräten. Keine Kommandozeilen, Cookies oder Tokens.
- `scripts/sample-video-access.cjs 30` wiederholt die Prüfung für 30 Sekunden
  alle 250 ms. Ausgaben erfolgen bei Änderungen und am Ende. Auf Linux mit Node
  oder der gepackten Runtime in `ELECTRON_RUN_AS_NODE=1` ausführbar.
- `GFN_ARMADA_MEDIA_DIAGNOSTICS=1` aktiviert die native CDP-Media-Diagnostik.
  Es werden nur Decodername und Plattformdecoder-Eigenschaft gespeichert,
  keine Player-URLs oder Titel. Quelle:
  [CDP Media](https://chromedevtools.github.io/devtools-protocol/tot/Media/).
  WebRTC muss über diese Domain keine Player-Ereignisse liefern; fehlende
  Ereignisse bedeuten deshalb `unknown`. Ein Report darf nicht automatisch
  einem GFN-Peer oder der Qualcomm-VPU zugeordnet werden.
- Debug-VModules decken zusätzlich die WebRTC-Decoderadapter ab. Manche
  `DVLOG`-Ausgaben fehlen in Releasebuilds; ohne Meldung keine Decoderbehauptung.
- GPU-Featureinformationen werden nach Initialisierung aktualisiert und mit
  eigenem Zeitstempel versehen; der frühe Startup-Snapshot genügt nicht.

20 lokale Tests bestanden. Der erste isolierte Electron-Smoke-Test auf macOS
mit aktivierter Media-Diagnostik lud GFN, bestätigte die Renderer-Sandbox und
empfing Preload-Telemetrie, beendete sich aber nicht sauber. Eine Rückkopplung
zwischen vollständiger GPU-Abfrage und `gpu-info-update` wurde entfernt: der
Eventhandler fragt nur den Featurestatus ab und startet keine neue vollständige
GPU-Abfrage. Die eigenen festhängenden Testprozesse wurden gezielt beendet.
Der erneute Smoke-Test überschritt anschließend sein 45-Sekunden-Startlimit;
deshalb **kein vollständig bestandener neuer GUI-Smoke-Test**. Keine aktive
Medienwiedergabe und kein Decodername in diesen Tests. Die CDP-Media-Diagnose
im GFN-Stream liefert weiterhin keinen Decodernamen. Der
neue, getrennte native WebRTC-Smoke-Test besteht dagegen auf Mac und Portal.

## Native Statistiken statt Mikrofonfreigabe

Die genau verwendete Chromium-Version filtert `decoderImplementation` und
`powerEfficientDecoder` aus Seiten-`getStats()`, solange der Kontext keine
aktive Medienaufnahme hat: [rtc_stats_report.cc](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/third_party/blink/renderer/modules/peerconnection/rtc_stats_report.cc),
`ExposeHardwareCapabilityStats` / `ToV8Stat`. Fehlende Werte sind damit nicht
automatisch ein fehlendes Decoderinstrument im nativen Backend.

Der native [PeerConnectionTracker](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/third_party/blink/renderer/modules/peerconnection/peer_connection_tracker.cc)
liefert die definierten nativen Attribute an `chrome://webrtc-internals` ohne
diesen Seitenfilter. `client/webrtc-internals.cjs` nutzt eine unsichtbare lokale
WebUI und deren `add-standard-stats`-Ereignisse. Nur Video-Inbound-Berichte für
die exakte GFN-Origin werden exportiert: Codec, Decodername, Effizienzflag,
Framezähler und Zeitwerte. SDP, ICE, IPs, Track-IDs und URLs bleiben in der
WebUI. Keine Mikrofon-/Kamerafreigabe, kein Netzwerk-Debugport. Aktivierung
zusammen mit `GFN_ARMADA_MEDIA_DIAGNOSTICS=1`; Ergebnisse unter `nativeWebRTC`
im Laufzeitsnapshot. Älter als 15 Sekunden wird der Export als `stale` geleert.

`tests/smoke-webrtc-internals.cjs` nutzt synthetisches Canvas-H.264 und lokale
PeerConnections mit eigenem temporären Profil. Ergebnisse vom 2026-10-04:

| Runtime | native Beobachtung | Grenze |
|---|---|---|
| Electron 44.5.1 / Apple Silicon | `ExternalDecoder (VideoToolboxVideoDecoder)`, Effizienzflag true; letzter Test 109 Frames | lokaler Stream, kein GFN und kein Qualcomm |
| Electron 44.5.1 / Portal | `FFmpeg`, Effizienzflag false, 80 Frames, 0 Drops | Softwaredecoder für diesen synthetischen Test nachgewiesen; aktive GFN-Instanz noch separat prüfen |
| Fedora Chromium 154.0.8037.57-1.fc44 / Portal | `FFmpeg`, Effizienzflag false, 31 Frames, 0 Drops | GL-Vergleich mit `AcceleratedVideoDecodeLinuxGL`; Hardwareprofile leer, Video-Feature `disabled_software` |

21/21 Unit-Tests bestehen. Die neuen lokalen Smoke-Tests ersetzen keine
vollständige GFN-Login-/Spiel-/Beendigungsprüfung der neuen Integration.

## Fertiges Fedora-Binary als Vergleich

Das aktuelle [Fedora-44-Rezept](https://src.fedoraproject.org/rpms/chromium/blob/f44/f/chromium.spec)
aktiviert auf aarch64 `use_v4l2_codec` und deaktiviert VA-API. Das gelesene
Rezept nennt inzwischen Version 154.0.8037.92; es ist kein exakt gepinnter
Buildnachweis des getesteten älteren .57-Binaries.

Die .57-RPMs aus dem Geräte-Repository wurden mit `rpm -Kv` geprüft:
Signatur und Digests OK, Fedora-Fingerprint
`36f612dcf27f7d1a48a835e4dbfcf71c6d9f90a6`. Sie wurden mit `rpm2cpio`/`cpio`
im Benutzerverzeichnis entpackt, keine Installation oder Paket-Hooks ausgeführt.
Zwei fehlende Bibliotheken (`libXNVCtrl`, `google-crc32c`) wurden ebenso ergänzt.
Der Browser startet mit diesen Bibliotheken. Testpfad:
`~/.local/share/gfn-armada-tests/fedora-chromium/`.

`scripts/probe-chromium.cjs /absolute/path/to/chromium` steuert ausschließlich
einen lokalen Test über CDP-Prozesspipes und ein temporäres Profil. Es meldet
native Streamwerte und GPU-Decodeprofile; der Test beendet seinen eigenen Browser.
`GFN_ARMADA_PROBE_LOG` speichert optional synthetische Testlogs.
`GFN_ARMADA_PROBE_IGNORE_BLOCKLIST=1` ist nur ein experimenteller Vergleich:
dieser Folgetest verlor SSH und hat **kein abgerufenes Ergebnis**. Keine
Ursachenzuordnung zum Browser, zur Blockliste oder zum Netzwerk möglich.
Keine solchen Schalter wurden in den regulären Client übernommen.

Alternative Decoder-/Streamerwege: [streamer-options.md](streamer-options.md).

## Nächster kontrollierter Versuch

1. Portal wieder erreichen, den neuen WebRTC-Internals-Reader übertragen, Stream
   mit XWayland und Media-Diagnostik starten; das bestehende Profil weiter nutzen.
2. Native Decoderangaben mit Streamzeitstempel und Device-FD-Samples korrelieren.
   V4L2-Queueaktivität ist für einen echten Hardwarebeweis stärker als ein FD.
3. Den vorbereiteten Fedora-Vergleich eingrenzen: warum sind die gemeldeten
   Decodeprofile leer? Fedora/Flatpak/ARM64 allein beweist kein VPU-Decoding.
4. Parallel den kleinen Decoderadapter-Versuch aus `streamer-options.md` prüfen.
   Falls kein passendes Binary/Adapter verfügbar ist, einen begrenzten V4L2-H.264-
   Vergleichsbuild vorbereiten. Das nicht validierte GN-Fragment
   `build/experimental-v4l2.gn` benennt die relevanten Buildschalter und ist
   ausdrücklich nicht Teil des bisherigen Bundle-Builds. Keine riesige
   Quellkopie oder Vollfork angelegt.
5. Erst nach erfolgreicher H.264-Iris-Anbindung HEVC-stateful-Zuführung
   implementieren und lokale Decode-Tests durchführen; dann WebRTC/GFN testen.

Heruntergeladene Quellen liegen unversioniert unter
`.artifacts/decoder-research/`; Quellprüfsummen in `source-sha256.json`.
