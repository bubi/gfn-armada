# Electron → Iris: Untersuchung vom 2026-10-04

## Ergebnis und Aussagegrenzen

Die Hauptlücke liegt sehr wahrscheinlich im ausgelieferten Chromium-Decoderbackend,
nicht in fehlender Iris-Unterstützung des Geräts. Außerdem fehlt im betrachteten
stateful Chromium-Backend eine konkrete HEVC-Implementierung. Die genaue
Decoderinstanz des GFN-H.264-Streams ist weiterhin nicht festgestellt: das Portal
antwortete bei den neuen SSH-Versuchen nicht. Deshalb noch kein neuer
Laufzeitbefund und keine Auslieferung der neuen Diagnostik auf das Portal.

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

20 lokale Tests bestanden. Der isolierte echte Electron-Smoke-Test auf macOS
mit aktivierter Media-Diagnostik lädt GFN, bestätigt die Renderer-Sandbox und
empfängt Preload-Telemetrie. Die CDP-Anbindung wird beim Schließen getrennt;
kein aktiver Medienplayer und kein Decodername in diesem Test. Live-Prüfung
der neuen Diagnose auf Linux steht noch aus.

## Nächster kontrollierter Versuch

1. Portal wieder erreichen, neuen Diagnosecode übertragen, Stream kontrolliert
   mit XWayland und Media-Diagnostik starten; das bestehende Profil weiter nutzen.
2. Native Decoderangaben mit Streamzeitstempel und Device-FD-Samples korrelieren.
   V4L2-Queueaktivität ist für einen echten Hardwarebeweis stärker als ein FD.
3. Vorhandene Chromium-Binaries und deren Paket-Buildrezepte prüfen, bevor ein
   neuer Build gestartet wird. Fedora/Flatpak/ARM64 allein beweist kein V4L2.
4. Falls kein passendes Binary verfügbar ist, einen begrenzten V4L2-H.264-
   Vergleichsbuild vorbereiten. Das nicht validierte GN-Fragment
   `build/experimental-v4l2.gn` benennt die relevanten Buildschalter und ist
   ausdrücklich nicht Teil des bisherigen Bundle-Builds. Keine riesige
   Quellkopie oder Vollfork angelegt.
5. Erst nach erfolgreicher H.264-Iris-Anbindung HEVC-stateful-Zuführung
   implementieren und lokale Decode-Tests durchführen; dann WebRTC/GFN testen.

Heruntergeladene Quellen liegen unversioniert unter
`.artifacts/decoder-research/`; Quellprüfsummen in `source-sha256.json`.
