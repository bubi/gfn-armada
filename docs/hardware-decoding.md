# Hardware-Decoding: Evidenz, Lücken und Prüfplan

Die versionsgenaue Electron-/Chromium-Untersuchung steht in
[electron-decoder-investigation.md](electron-decoder-investigation.md).
Sie identifiziert den standardmäßig ausgeschalteten V4L2-Buildpfad und die
explizite HEVC-Ablehnung im stateful Decoder von Chromium 152 und aktuellem main.

Stand: 2026-10-04. HEVC-VPU-Decoding mit DMA-BUF-Ausgang ist auf dem Portal
für einen synthetischen GStreamer-Testclip nachgewiesen. AV1, der GPU-/Wayland-
Import und Hardwaredecodierung im GFN-Client bleiben unbestätigt.
`diagnostics` gibt deshalb für den Clientpfad weiterhin `unknown` aus.
Weder GPU-Rendering noch niedrige CPU-Last allein beweisen Hardware-Decoding.

## Armada-Stack aus dem Quellcode

Untersucht wurde Armada-Commit `43c0cca880cefbb963d5fdc1554816ffd0a5691f`.
Die jeweiligen Dateien sind genaue Quellbelege, keine Messungen des installierten OS:

- [Kernel BASE.env](https://github.com/armada-os/armada/blob/43c0cca880cefbb963d5fdc1554816ffd0a5691f/packages/kernel/BASE.env) pinnt `7.2.6`.
- [Mesa BASE.env](https://github.com/armada-os/armada/blob/43c0cca880cefbb963d5fdc1554816ffd0a5691f/packages/mesa/BASE.env) pinnt Mesa `26.2.3`, mit Fedora-Paketierung.
- [Portal DTS](https://github.com/armada-os/armada/blob/43c0cca880cefbb963d5fdc1554816ffd0a5691f/packages/kernel/dts/qcs8550-ayn-odin2portal.dts) nennt `qcom,qcs8550` und `qcom,sm8550` und inkludiert das gemeinsame AYN-DTSI.
- [AYN-DTSI](https://github.com/armada-os/armada/blob/43c0cca880cefbb963d5fdc1554816ffd0a5691f/packages/kernel/dts/qcs8550-ayn-common.dtsi) setzt `&iris { status = "okay"; }`.
- [Config overrides](https://github.com/armada-os/armada/blob/43c0cca880cefbb963d5fdc1554816ffd0a5691f/packages/kernel/config/armada-kernel.config.overrides) setzen SM8550-Videoclocks. Sie werden über ARM64-defconfig gemerged; das Fehlen eines Iris-Overrides bedeutet weder enabled noch disabled im fertigen Kernel.
- [Basis-Pakete](https://github.com/armada-os/armada/blob/43c0cca880cefbb963d5fdc1554816ffd0a5691f/build_files/10-base-packages.sh) umfassen FFmpeg und GStreamer-Plugins.

Die ausgelieferte Version, finale `.config`, Firmware, Treiberbindung und
Device-Permissions sind auf dem konkreten Gerät offen. Das Pinning ist kein
Beweis, dass das genannte Kernel-Tarball alle untersuchten Mainline-Änderungen
enthält oder derzeit extern abrufbar ist. Eine angefragte Upstream-v7.2-Quelldatei
war nicht abrufbar; aktuelle Iris-Quellen wurden separat auf `master` gelesen.

## Qualcomm: stateful V4L2 zuerst

Der aktuelle [Iris-Kconfig](https://github.com/torvalds/linux/blob/master/drivers/media/platform/qcom/iris/Kconfig)
selektiert V4L2 mem2mem und DMA-contiguous videobuf2. Die
[VPU3x-Plattformtabelle](https://github.com/torvalds/linux/blob/master/drivers/media/platform/qcom/iris/iris_platform_vpu3x.c)
enthält H.264, HEVC, VP9 und AV1 sowie SM8550-Plattformdaten. Das zeigt eine
Quellcodeperspektive; verfügbare Codecs sind über das tatsächliche Device zu
enumerieren. Gemeinsame Tabellen garantieren nicht jede Kombination von Profil,
Bit-Tiefe, Auflösung, Framerate und Firmware auf jedem Board.

Für Iris ist der erste Integrationskandidat **stateful V4L2 mem2mem**: komprimierte
Streams auf der OUTPUT-Queue, dekodierte Bilder auf CAPTURE. Die Media Request API
mit Slice-Controls ist ein anderer, stateless Pfad. Eine `/dev/media*`-Node oder
ein Chromium-H265-stateless Delegate macht Iris nicht zum Request-API-Decoder.
Venus älterer SoCs und Androids downstream `msm_vidc` dürfen nicht mit dem
hier aus dem Device-Tree abgeleiteten Iris-Pfad gleichgesetzt werden.

Für den ersten HEVC-Test 8-Bit Main / SDR bevorzugen. Linear NV12 ist ein
vernünftiger Integrationskandidat, **falls der konkrete Treiber es ausgibt**.
UBWC, Modifier, Plane-Layouts, P010 und Cache-/Fence-Synchronisation sind getrennt
zu testen. Die Adreno-740-GPU rendert; die Qualcomm-VPU decodiert. Turnip allein
liefert keinen VA-API-Decoder und keinen Nachweis von Vulkan-Video-Decoding.

## Chromium / Electron: fehlende Verbindung

[Chromium media/gpu/args.gni](https://chromium.googlesource.com/chromium/src/+/main/media/gpu/args.gni)
setzt `use_v4l2_codec=false` als Standard. VA-API ist ein anderer Backendpfad,
auch wenn ARM64 für den Linux-VA-API-Build zulässig ist. Ein VA-API-Schalter
verbindet Electron daher nicht automatisch mit Iris.

Aktuelles Chromium hat bereits:

- [V4L2StatefulVideoDecoder](https://chromium.googlesource.com/chromium/src/+/main/media/gpu/v4l2/v4l2_stateful_video_decoder.cc): stateful Codec-/Queue-Verwaltung, HEVC-Sonderbehandlung und DMA-BUF/MMAP-Pfade.
- [VideoDecoderPipeline](https://chromium.googlesource.com/chromium/src/+/main/media/gpu/chromeos/video_decoder_pipeline.cc): V4L2-Backend-Auswahl mit Linux-spezifischer Frameallokation. Der Verzeichnisname `chromeos` ist kein Beweis einer ausschließlich ChromeOS-basierten Ausführung.
- [PlatformVideoFrameUtils](https://chromium.googlesource.com/chromium/src/+/main/media/gpu/chromeos/platform_video_frame_utils.cc): Linux/V4L2-spezifischer Zugriff auf Rendernodes für GBM.
- [PlatformVideoFramePool](https://chromium.googlesource.com/chromium/src/+/main/media/gpu/chromeos/platform_video_frame_pool.cc): DMA-BUF-basierte Frame-Ressourcen.
- [GpuVideoDecodeAcceleratorFactory](https://chromium.googlesource.com/chromium/src/+/main/media/gpu/gpu_video_decode_accelerator_factory.cc): V4L2-Guard für Linux oder ChromeOS, wenn der Buildflag gesetzt ist.

Diese `main`-Quellen sind beweglich und **nicht** der Nachweis, dass das gebündelte
Electron-44-Binary genau diese Revision oder aktivierte Buildflags enthält.
[Electron-Buildargumente](https://github.com/electron/electron/blob/v44.5.1/build/args/all.gn)
aktivieren proprietäre Codecs und Chrome-FFmpeg-Branding. Das allein aktiviert
keinen V4L2-Decoder. System-FFmpeg und Electron-internes FFmpeg sind getrennte
Builds. Die Installation eines FFmpeg-V4L2-Decoders ändert WebRTC nicht.

Die WebRTC-HEVC-Buildentscheidung ist in
[webrtc.gni](https://webrtc.googlesource.com/src/+/refs/heads/main/webrtc.gni)
an `enable_hevc_parser_and_hw_decoder` gekoppelt. Zusätzlich müssen Browser-
Decoderfähigkeiten in die WebRTC-Decoderfactory und SDP-Angebote gelangen.
Ein HEVC-MP4, WebCodecs oder `canPlayType()` sind kein Beweis für WebRTC HEVC.
AV1 in `getCapabilities()` kann auf einem Softwaredecoder beruhen.

## HEVC und AV1 getrennt

| Ebene | H.264 | HEVC | AV1 |
|---|---|---|---|
| Produktpriorität | funktionaler Fallback | erster VPU-Nachweis | erst nach HEVC |
| aktueller Iris-Quellpfad | vorhanden | vorhanden | gemeinsame VPU3x-Tabelle enthält AV1 |
| konkretes Portal / Firmware / finale Config | unknown | unknown | unknown |
| gebündeltes Electron / V4L2 Backend | unbestätigt | unbestätigt | unbestätigt |
| WebRTC Codecangebot | zur Laufzeit erheben | zur Laufzeit erheben | zur Laufzeit erheben |
| GFN-Verhandlung in dieser App | unknown | unknown | unknown |
| Hardwaredecoder tatsächlich aktiv | unknown | unknown | unknown |

Die [aktuelle NVIDIA-Codecdokumentation](https://nvidia.custhelp.com/app/answers/detail/a_id/5824)
beschreibt automatische Auswahl und Codecoptionen mit OS-/Browser-/GPU-
Abhängigkeiten; Browser-HEVC verlangt dort 8-Bit-Farbqualität. Das widerlegt eine
pauschale Aussage, GFN-Browser könnten niemals HEVC anbieten. Es bestätigt
**nicht** HEVC oder AV1 für Linux ARM64 Electron auf dem Portal. Deshalb kein
fest erzwungener HEVC/AV1-SDP-Patch, kein gefälschter Decoderfähigkeitsbericht.

## Videopfad und Zero-/Low-Copy

```text
GFN-Server (tatsächlich gewählter Codec)
  → WebRTC depacketize / jitter buffer
  → Chromium WebRTC decoder factory / media decoder
  → stateful V4L2 OUTPUT (komprimierte Daten)
  → Iris / Firmware / Qualcomm-VPU
  → CAPTURE (NV12 oder unterstütztes alternatives Layout)
  → DMA-BUF export/import / NativePixmap / SharedImage
  → EGL oder passendes GPU-Backend, YUV→RGB
  → Ozone Wayland / Gamescope
  → DRM/KMS Display
```

Dies ist die **Zielarchitektur**, nicht der aktuelle Ist-Pfad des Electron-Bundles.
Ein Low-Copy-Pfad benötigt kompatible DMA-BUF-Plane-Offsets, Strides, Modifier,
GBM-/EGL-Imports und Synchronisation. GPU-Farbkonvertierung oder Compositor-
Komposition sind nicht automatisch CPU-Kopien. Direct Scanout ist ein weiteres,
separates Kriterium; Gamescope kann weiterhin komponieren. Keine pauschale
Null-Kopien-Behauptung anhand eines Chromium-Schalters.

## Prüfplan auf dem Gerät

1. `gfn-armada diagnostics` sichern; Kernel/Image-Version ergänzen. `/dev/video*`
   und `/dev/media*` prüfen, finale Kernelconfig (`/proc/config.gz` oder
   `/boot/config-$(uname -r)`) lesen. Iris-Bindung und Firmwarefehler mit Kernel-
   Log kontrollieren. Fehlende Rechte sind `unknown`, nicht Hardwareausfall.
2. Für jede Video-Node `v4l2-ctl -d /dev/videoN --all` und getrennte OUTPUT-/
   CAPTURE-Formatlisten für Single-/Multiplanar queues erheben. M2M, H264/HEVC/AV1,
   Auflösung und Bit-Tiefe dokumentieren. Mit `media-ctl -p` Topologie prüfen,
   falls vorhanden. Die Diagnose verpackt auch nicht verfügbare Tools als Evidenz.
3. Lokalen bekannten 8-Bit HEVC-Teststream explizit mit
   `ffmpeg -c:v hevc_v4l2m2m -i sample.hevc -f null -` prüfen, **falls dieser
   Decoder im Build existiert**. Decoderlog und Iris-Queueaktivität korrelieren.
   Analog H264. `-hwaccels` allein genügt nicht; V4L2m2m erscheint auch als Decoder.
   Dieser Null-Ausgabe-Test beweist keine DMA-BUF-Renderingkette.
4. Optional GStreamer `gst-inspect-1.0 video4linux2` / `v4l2codecs` und passende
   Decoder prüfen. GStreamer kann unabhängige Decoder-/Importtests liefern;
   Austausch von WebRTC in Electron ist damit nicht implementiert.
5. Chromium-Build zuerst gegen denselben lokalen HEVC-Stream testen. GPU-
   Prozess-/Sandboxzugriff auf Video- und DRM-Nodes prüfen. Danach WebRTC
   HEVC mit kontrolliertem Gegenüber prüfen. Erst dann GFN starten.
6. `GFN_ARMADA_LOG=debug gfn-armada launch` + `chrome://gpu` + WebRTC-Snapshot
   auswerten: Codec, Decodername, Frames, Drops und mittlere Decodezeit.
   `totalDecodeTime/framesDecoded` ist ein Mittel seit Streambeginn, keine
   Ende-zu-Ende-Latenz. Nicht ausgefüllte Statistikfelder bleiben unbekannt.
7. V4L2-Queue- und Iris-Aktivität per Trace/strace oder geeigneten Kernel-
   Tracepoints **zeitlich mit genau diesem Stream** korrelieren. Softwaredecoder
   ausschließen. Erst Codec + ausgewählter Hardwarepfad + aktive Iris-VPU ergeben
   einen Nachweis. `powerEfficientDecoder` ist nur ein Browserhinweis.
8. DMA-BUF-Import und CPU-Mappings separat erfassen. GPU/Compositor-Traces,
   Format/Modifier, CPU-Last und Dropped Frames vor/nach Änderung vergleichen.
   HEVC-Nachweis sichern; danach denselben Ablauf für AV1 durchführen.

## Kleinstmöglicher nächster Build-/Patchschritt

Kein Patch ohne reproduzierten Fehler. Zuerst den konkreten Electron-Chromium-
Commit und `args.gn` sichern. Prüfen, ob `use_v4l2_codec=true`, passendes Ozone-
Wayland/GBM und `enable_hevc_parser_and_hw_decoder` im Build möglich sind und
`IsV4L2DecoderStateful()` den richtigen Decoder auswählt. `use_vaapi`-/AV1-
Flagabhängigkeiten im konkreten GN-Graph prüfen, keine ungeprüften Rezeptflags.

Falls lokale HEVC-VPU-Decodierung funktioniert, Chromium aber scheitert, den
Fehler eingrenzen: Backendauswahl / SupportedConfigs, Iris-Queueformate,
HEVC-Bitstreamkonvertierung, Sandbox-Devicezugriff, Framepool oder GPU-Import.
Daraus ergibt sich ein kleiner Patch nur an der nachgewiesen fehlenden Verbindung.
Die relevanten Komponenten stehen oben. Keine Android-/MediaCodec-Brücke und
kein vollständiger dauerhaft gepflegter Chromium-Fork als erster Schritt.

## Grenzen der implementierten Telemetrie

Preload beobachtet neu erstellte `RTCPeerConnection`s im Hauptfenster und ruft
`getStats()` auf. Worker, andere Frames, vorher erstellte Verbindungen und ein
proprietärer Streamtransport können unsichtbar bleiben. Main-World-Hooking ist
best effort; GFN kann es durch Änderungen umgehen. Die Remote-Seite kann Reports
beeinflussen. IPC ist auf Sender/Origin/Größe begrenzt; solche Reports bleiben
als **page-reported** markiert und setzen Hardwarestatus niemals auf `yes`.
`runtime.json` ist eine historische, timestamped Momentaufnahme, kein Live-
Hardwareattest. `active` ist nur die zuletzt gespeicherte Sitzungsbeobachtung;
bei Crash kann es veraltet sein. Die Diagnose liest es ohne Frischebehauptung.
# Nachtrag: Gerätetest 2026-10-04

Der Iris-HEVC-Pfad wurde auf dem Portal mit einem synthetischen Clip und
GStreamer erfolgreich getestet, einschließlich DMA-BUF-Ausgang. Das getestete
Electron-Bundle bietet jedoch kein H.265 in WebRTC an. Details und Grenzen:
[odin-device-validation.md](odin-device-validation.md). GFN-Hardwaredecodierung
bleibt unbestätigt.
