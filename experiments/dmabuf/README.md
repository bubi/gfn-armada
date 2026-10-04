# Isolierter HEVC → DMA-BUF → Electron-Test

Dieser Prototyp lädt ausschließlich einen lokalen synthetischen HEVC-Clip.
Die produktive GFN-Anwendung lädt das Modul nur bei explizit aktiviertem
[H264-Shadow-Experiment](../../docs/native-bridge.md). Die hier beschriebene
HEVC-Testanwendung verwendet keine NVIDIA-Cookies,
kein Netzwerkstream, kein `decodebin`, kein Softwaredecoder und kein
`videoconvert` in dieser Pipeline.

```text
filesrc → h265parse → v4l2h265dec → appsink
                                    ↓ GstSample-Lease / NV12 DMA-BUF
Electron main → sharedTexture.importSharedTexture → sandboxed preload
                                                      ↓ VideoFrame
                                                   2D canvas
```

## Bauen auf Apple Silicon

```sh
./scripts/build-dmabuf
```

Ausgabe: `.artifacts/dmabuf/bridge.node` und `build-packages.txt`.
Fedora-44-ARM64-Basisimage ist per Digest festgelegt; die DNF-Repositories
sind noch nicht eingefroren. Der Paketmanifest hält die verwendeten Versionen
fest. Das ist ein wiederholbarer Containerbuild, noch kein nachweislich
bitidentischer Offlinebuild. Es werden keine Pakete auf ArmadaOS installiert.
Node-API 8 vermeidet eine Bindung an die Electron-V8-ABI. GStreamer >=1.24
und kompatible ARM64-Systembibliotheken bleiben erforderlich.

## Ausführen auf dem Portal

Die vier Dateien `main.cjs`, `preload.cjs`, `index.html`, `package.json` und
das ARM64-Addon `bridge.node` in ein eigenes Testverzeichnis kopieren.
Für das gepackte Electron eine separate `resources/app`-Zuordnung verwenden:
dessen Executable sucht die Anwendung relativ zu seinem eigenen Pfad und
ignoriert die Übergabe eines anderen App-Verzeichnisses. Bibliotheken dürfen
aus dem installierten Bundle verlinkt werden; die produktiven Ressourcen
werden nicht überschrieben.

```sh
GFN_ARMADA_TEST_CLIP="$HOME/.local/share/gfn-armada-tests/hevc-720p.h265" \
GFN_ARMADA_OZONE=wayland ./runtime/gfn-armada-electron
```

Eine aktive Desktopumgebung mit korrektem `XDG_RUNTIME_DIR`, `DISPLAY` und
`XAUTHORITY` ist für den X11-Vergleich nötig. `GFN_ARMADA_OZONE=x11` ist ein
separater Vergleich; dieser Import funktionierte auf dem Portal bisher nicht.
Kein `--no-sandbox`, keine deaktivierte Web-Security. Das Profil ist temporär
und enthält keinen GFN-Login.

Der Test beendet sich nach den 60 Fixture-Frames, EOS oder spätestens 30 Sekunden. Er fordert
mindestens 30 Transfers und Renderer-Draw-Aufrufe, Farbinhalt im Canvas und die Freigabe
sämtlicher Leases. `test-pattern.png` und der einmalige Pixelcheck dienen
nur der Validierung: diese CPU-Readbacks gehören nicht zum Decoder-/Playbackpfad.
Die Draw-Zähler messen keine tatsächlich präsentierten Compositor-Frames.
Eine `passed`-Meldung belegt keinen HEVC-Stream von GFN, keine gemessene
Ende-zu-Ende-Latenz und kein Zero-Copy innerhalb von Chromium/Gamescope.

## Grenzen und Besitz

* Der Decoder ist ausdrücklich `v4l2h265dec`. Die Caps erzwingen lineares
  NV12 mit `memory:DMABuf`; abweichende Modifier und fehlende/inkonsistente
  `GstVideoMeta` führen zum Fehler. Keine Rohdaten werden gemappt.
* Eine Allocation-Query kündigt Unterstützung für `GstVideoMeta` an, damit
  der Decoder gepaddete Capturebuffer ohne CPU-Umpacken liefern kann.
* Farbraum muss ausgehandeltes BT.709 mit begrenztem Wertebereich sein;
  er wird explizit an Electron übergeben. Andere Farbräume sind noch abgelehnt.
* Stride, Planengröße, Speicher-Offset und gepaddete Höhe stammen aus
  GStreamer-Metadaten. Jede Plane muss in genau einer DMA-BUF-Memory liegen.
  Crop-Metadaten und linkes/oberes Padding sind im ersten Prototyp abgelehnt.
* Das Addon hält den `GstSample` bis `allReferencesReleased`. Erst dann darf
  der Decoder den Capturebuffer wiederverwenden. Renderer schließt VideoFrame
  und SharedTexture; Main gibt seine eigene SharedTexture-Referenz frei.
* Maximal acht native Leases, höchstens vier Transfers gleichzeitig; Appsink
  maximal zwei gepufferte Frames. `close()` verweigert noch geleaste Frames.
* Bounded Polling im Main-Prozess ist bewusst nur für diesen Test. Vor einer
  GFN-Anbindung braucht es einen asynchronen Worker, Sessiongenerationen,
  Auflösungswechsel, Synchronisation mit Audio und Fehler-/Keyframe-Recovery.
  Ein separater Node-Worker und begrenztes H264-appsrc sind inzwischen
  implementiert; deren Laufzeittest auf Iris ist noch offen.
* Dieser Test nutzt die experimentelle Electron-44.5.1-SharedTexture-API.
  Import-/GPUfehler dürfen nicht als funktionierende Ausgabe gelten.

Quellen: [Electron SharedTexture](https://github.com/electron/electron/blob/v44.5.1/docs/api/shared-texture.md),
[sandboxed Renderer API](https://github.com/electron/electron/blob/v44.5.1/lib/sandboxed_renderer/api/module-list.ts),
[GStreamer DMA-DRM](https://gstreamer.freedesktop.org/documentation/video/video-info-dma-drm.html),
[GstVideoMeta](https://gstreamer.freedesktop.org/documentation/video/gstvideometa.html).
