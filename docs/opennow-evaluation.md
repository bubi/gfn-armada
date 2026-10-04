# OpenNOW als nativer Vergleichskandidat

**Entscheidung des Nutzers am 2026-10-04:** beim originalen GFN-Webclient mit
Electron/Chromium bleiben. Die unten stehende Empfehlung wurde damit verworfen.
OpenNOW wurde nur heruntergeladen, auf dem Portal per SHA256 geprüft und im
Benutzer-Testverzeichnis entpackt; nicht gestartet oder angemeldet. Kein
OpenNOW-Backend für gfn-armada implementieren. Die Analyse bleibt als Referenz.

Stand: 2026-10-04. Untersucht:
[OpenCloudGaming/OpenNOW](https://github.com/OpenCloudGaming/OpenNOW),
Commit `bee18c118dbc89f42319436dcdb172d5b9e15e0c`.
Der stabile Tag `v1.0.2` zeigt auf denselben Commit wie der heruntergeladene
`main`-Stand. Keine OpenNOW-Programme oder Build-/Installationsskripte ausgeführt.

## Empfehlung

OpenNOW zuerst auf dem Portal als unabhängigen nativen Vergleichsclient testen,
bevor wir einen Chromium-/Electron-Sourcebuild anfangen. Seine Qt/Rust-
Architektur umgeht die Chromium-WebRTC-Decoderfabrik vollständig. Der notwendige
stateful HEVC-/DMA-BUF-Pfad für Iris ist allerdings auch dort noch nicht fertig.
Damit ist OpenNOW eine plausible kleinere Erweiterungsbasis, keine bereits
validierte Lösung für das Odin-HEVC-Ziel.

Der vorhandene funktionierende gfn-armada-Electron-Client bleibt die H.264-
Vergleichsbasis. Noch kein Backendwechsel und keine Steam-Dateien geändert.

## Was tatsächlich anders ist

Die aktuelle Qt-Version ersetzt das frühere Electron-Projekt:
[README](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/README.md).
Qt Quick zeichnet die Oberfläche; ein Rust-Core verwaltet Account, Katalog und
Sitzungen. Der native Rust-Streamer verarbeitet GFN-NVST-Transport, Decoder,
Audio und Eingaben und wird über eine C ABI eingebunden. Kein Browser und kein
Chromium/WebRTC-Fallback im aktuellen Qt-Client. Ältere Forks und Releases
beschreiben noch Electron und sind hierfür keine passende Referenz.

Linux ARM64 ist als AppImage und Debian-Paket veröffentlicht. Für das Fedora-
basierte ArmadaOS ist das AppImage der erste Vergleichskandidat; ein `.deb`
ist kein ArmadaOS-Paket. Ob gebündelte Bibliotheken und Qt/Vulkan-Plugins auf
ArmadaOS funktionieren, muss am Gerät getestet werden.

## Codec- und Speicherpfade getrennt

| Pfad im geprüften Quellcode | Umsetzung | Konsequenz für Odin/Iris |
|---|---|---|
| stateful V4L2 H.264 | direkter Rust-V4L2-M2M-Decoder | plausibler erster VPU-Spieltest, noch nicht ausgeführt |
| V4L2 HEVC | FFmpeg Request API, HEVC_SLICE und SAND128 NV12 | passt nicht zum bisher beobachteten stateful Iris-Knoten |
| VA-API HEVC | eigener FFmpeg-/VA-API-Pfad | kein belegter Qualcomm-Iris-Pfad |
| Vulkan Video | FFmpeg-Vulkan-Backend | Turnip-Rendering allein beweist keine Vulkan-Video-Decodierung |
| Softwaredecode | FFmpeg-Fallback | erfolgreiche Wiedergabe beweist keine Hardwareverwendung |
| DMA-BUF-Import | vorhandener Linux-Vulkan-Frameimport | nützliche Infrastruktur, aber kein automatischer Zero-Copy-Iris-Nachweis |

Quellbelege:

- [session.rs](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/native/opennow-streamer/crates/opennow-streamer-platform-linux/src/session.rs):
  `open_decoder` wählt bei V4L2/H.264 den direkten Decoder, bei HEVC dagegen
  den FFmpeg-Request-Pfad. AV1 ist in diesem V4L2-Zweig nicht implementiert.
- [v4l2.rs](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/native/opennow-streamer/crates/opennow-streamer-platform-linux/src/video/v4l2.rs):
  Geräteprobe und OUTPUT-FourCC sind auf H.264 begrenzt; SDR NV12/I420.
  CAPTURE verwendet MMAP; die Frameausgabe erzeugt CPU-Planes und setzt
  `dmabuf: None`. Hardwaredecode ist damit von Zero-Copy zu unterscheiden.
- [v4l2_request.rs](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/native/opennow-streamer/crates/opennow-streamer-platform-linux/src/video/v4l2_request.rs):
  prüft `HEVC_SLICE` (`S265`), Media-Requests und SAND-NV12-Formate.
- [capability.rs](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/native/opennow-streamer/crates/opennow-streamer-platform-linux/src/capability.rs):
  meldet diese getrennten Decoderproben. Ein erfolgreicher Capability-Probe
  ersetzt keinen laufenden Streamtest.
- [presentation.rs](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/native/opennow-streamer/crates/opennow-streamer-platform-linux/src/presentation.rs)
  und `frame_producer.rs`: Vulkan-Import und Synchronisierung externer DMA-BUF-
  Frames. Layout-, Modifier-, Lebensdauer- und Synchronisationsanforderungen
  müssen zu den Iris-Puffern passen.

## Direkter Spielstart und Controller

[AppController.cpp](https://github.com/OpenCloudGaming/OpenNOW/blob/bee18c118dbc89f42319436dcdb172d5b9e15e0c/opennow-qt/src/app/AppController.cpp)
verarbeitet `--launch-app-id`, `--app-id`, `--launch-title` und weitere
Titelargumente. Die App-ID ist die OpenNOW/GFN-Katalog-ID, **kein belegter
Steam-AppID-Ersatz**. Den vorhandenen gfn-armada-Mappinglayer erst nach Prüfung
der Katalogidentitäten anbinden; keine IDs gleichsetzen.

`--console` wird in `ApplicationStartup.cpp` ausgewertet. Qt bietet eine
Controlleroberfläche und eigene Streammenüs; das kann unsere Overlay-
Bedienprobleme verkleinern. Kein Laufzeittest auf dem Portal bisher.

## Vorbereitetes Testpaket

Die GitHub-API meldet am 2026-10-04 `v1.0.2` als stabile Veröffentlichung und
zusätzlich `v1.0.3-nightly.853.1`. Zwischengespeicherte Webansichten von
`releases/latest` zeigten teilweise noch `v0.5.5`; die API und der stabile
Git-Tag wurden deshalb unabhängig geprüft.

[Stabiles Release v1.0.2](https://github.com/OpenCloudGaming/OpenNOW/releases/tag/v1.0.2)
enthält `OpenNOW-Qt-1.0.2-Linux-arm64.AppImage`, 105.892.360 Bytes, SHA256:

```text
55b57e7c2c5b1343266ce1741e15de1f2cf5fee15c92c189677e1b0ea016a59a
```

`python3 scripts/fetch-opennow` lädt genau dieses Artefakt nach
`.artifacts/opennow/`, prüft den gepinnten Hash und legt Herkunftsmetadaten ab.
Es installiert und startet nichts. Eine passende Prüfsumme allein ist keine
Prüfung der separat vorhandenen Update-Manifestsignatur.

## Geräteexperiment und mögliche kleine Erweiterung

1. AppImage getrennt vom Electron-Profil in einem Benutzer-Testverzeichnis
   starten und die OpenNOW-Decoderdiagnose aufnehmen. Login führt der Nutzer
   aus; bestehende Electron-Cookies werden nicht kopiert.
2. Einen H.264-GFN-Stream mit explizitem V4L2-Backend testen. Decodername,
   Iris-Gerätezugriff und Queueaktivität korrelieren; Softwarefallback erkennen.
3. HEVC-stateful zunächst lokal ergänzen: Codec/FourCC und Geräteprobe
   generalisieren, vollständige Access Units, Auflösungswechsel und Flush
   gegen den bereits funktionierenden Iris/GStreamer-Test vergleichen.
4. Anschließend CAPTURE-DMA-BUF-Export und Lebensdauerhaltung statt CPU-Planes
   an den vorhandenen Vulkan-Import anbinden. Keine Wiederverwendung von Puffern
   vor abgeschlossener GPU-Nutzung; Format/Modifier und Synchronisation prüfen.
5. Erst dann echten HEVC-GFN-Stream und später AV1 testen.

Diese Schritte wären Änderungen am nativen Decoderbackend, nicht an einem
vollständigen Chromium-Fork. Aufwand und Zuverlässigkeit werden erst nach dem
ersten Gerätetest belastbar. OpenNOW nutzt ein inoffizielles GFN-Protokoll;
Upstream-/Serveränderungen können Sitzungsaufbau und Codecverhandlung beeinflussen.

Das Projekt ist MIT-lizenziert; bei Codeübernahme Copyright/Lizenz erhalten.
Abhängigkeiten haben separate Lizenzhinweise. Bisher kein Upstream-Code kopiert.
