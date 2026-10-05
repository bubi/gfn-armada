# VA-API-Treiber für die Iris: Codeprüfung und Testvorbereitung

Stand: 2026-10-05. Die Abschnitte bis „Verhältnis zur bestehenden Brücke" sind
Quellprüfung und Ablaufplan, entstanden bei ausgeschaltetem Gerät. Die
gemessenen Ergebnisse stehen am Ende unter
[Messergebnisse am Gerät](#messergebnisse-am-gerät-2026-10-05); erst dort
beginnt der Nachweis.

**Fortsetzung:** [VA-API-Untersuchung vom 2026-10-05](../../docs/vaapi-investigation-2026-10-05.md).
Der unten dokumentierte Abbruch vor der Surface-Erstellung lässt sich mit
Wayland/ANGLE GL umgehen. Ein synthetischer Stream decodiert auf Iris; im echten
GFN-Stream meldet Chromium anschließend VA-API, der Treiber aber OUTPUT-Fehler.
Mit der anschließend bestätigten PPS-ID-Korrektur ist **H.264-Hardware-Decoding
im echten GFN-Stream für knapp vier Minuten belegt** (14.484 Iris-Frames, keine
beobachteten Treiberfehler/Fallbacks). HEVC und visuelle Bildkorrektheit bleiben
unbestätigt; der Pfad verwendet eine GPU-Kopie. Siehe
[`validation-pps-fix-odin.json`](validation-pps-fix-odin.json).

## Warum dieser Weg überhaupt in Frage kommt

Aus dem ausgelieferten Linux-ARM64-Electron (`dist/gfn-armada-linux-arm64/gfn-armada-electron`,
220 MB) gelesen:

| | Treffer | Inhalt |
|---|---|---|
| V4L2 | 19 | ausschließlich Capture-Pfade (`v4l2_capture_delegate.cc`, `video_capture_v4l2.cc`) |
| VA-API | 80 | `VaapiVideoDecoder`, `H264VaapiVideoDecoderDelegate::SubmitDecode`, `libva.so.` |

Kein einziges V4L2-**Decode**-Symbol. Das offizielle Electron ist mit
`use_vaapi = true` und `use_v4l2_codec = false` gebaut; `libva` ist der einzige
einkompilierte Hardware-Decode-Einstiegspunkt. Deshalb blieb die Messung mit
`WebRtcAllowH265Receive` wirkungslos — es ist ein Compile-Flag-Problem, kein
Laufzeitschalter-Problem (siehe `docs/electron-v4l2-experiment.md`).

Daraus folgen genau zwei Auswege: Chromium selbst bauen, oder einen
**VA-API-Treiber für die Iris** bereitstellen. Letzterer braucht keinen Build
des Browsers.

Mesa leistet das **nicht**. Freedreno enthält kein Video-Decode; die Iris-VPU
ist ein eigener IP-Block hinter einem V4L2-Kerneltreiber. Eine automatische
V4L2-zu-VA-API-Übersetzung existiert nicht.

## Der Kandidat

[`phxinyang/qualcomm-iris-vaapi`](https://github.com/phxinyang/qualcomm-iris-vaapi),
gepinnt in [`sources.json`](sources.json) auf `f587b14e`, 100 Commits,
MIT und LGPL-2.1-or-later. Die Copyright-Header nennen Bootlin (2019) und
Max Schettler (2023): das steht in der Linie der bestehenden
`libva-v4l2`-Arbeit, ist also keine Neuschöpfung.

Die Passung ist ungewöhnlich genau. Qualifiziert wurde upstream auf
Snapdragon **SM8550**, Fedora 44 ARM64, Chrome 152, Treiberknoten `qcom-iris`.
Unser Gerät ist SM8550 (Adreno 740, gemessen als `ANGLE (freedreno, FD740)`),
ArmadaOS ist Fedora-basiert, Electron 44.5.1 fährt Chromium 152, und der Knoten
meldet sich als `qcom-iris-decoder`.

## Codeprüfung

Gelesen: `src/codec/bitwriter.h` vollständig, `src/va/driver.h`,
`src/iris/slots.cc`, `src/meson.build`, Fedora-Spec, README, TEST-RESULTS.

**Speichersicherheit ist konstruiert, nicht zufällig.** Der Bitstream-Writer
arbeitet auf `std::vector<uint8_t>` mit `push_back` — kein fester Puffer, also
kein Überlauf möglich. `BitReader::bit()` prüft `p >= size_bits()` und liefert
sonst 0; alle Lesefunktionen gehen durch `bit()`, damit bleiben auch
`seek`/`skip` ohne eigene Prüfung gefahrlos.

**Die VA-Objektverwaltung ist richtig gelöst.** `std::map` von VA-IDs auf
`std::shared_ptr`, und die Lookups „throw iris::Error with the VA status" —
eine ungültige `VASurfaceID` vom Client ergibt also einen VA-Fehler statt eines
Absturzes. Genau dort stürzen schlampige Treiber ab. Ein `std::recursive_mutex`
schützt die Tabellen, mit dokumentiertem Geltungsbereich.

**Dateideskriptoren per RAII.** `Frame::~Frame()` und `SlotPool::~SlotPool()`
schließen, und `scratch_fd_` wird nach `close` auf `-1` gesetzt, was
Doppelschließen verhindert. Ein vom Client importierter `import_fd_` wird
bewusst nicht geschlossen — korrekt, der Kernel hält nach
`queue_buffer_dmabuf` seine eigene Referenz auf das dma_buf.

**Ein echter latenter Fehler.** In `BitReader::ue()`:

```cpp
unsigned zeros = 0;
while (!bit() && zeros < 32) ++zeros;
return ((1u << zeros) - 1) + bits(zeros);
```

Bei genau 32 führenden Nullen ist `1u << 32` undefiniertes Verhalten
(Shift ≥ Breite des Typs). Erreichbar über manipulierte oder beschädigte
Bitstreamdaten. Die Folge ist ein falscher Wert, keine Speicherkorruption —
hier wird damit nicht indiziert. Trotzdem ein Befund, der upstream gehört.
Kleinere Randfälle derselben Art: `su()` mit `count == 64` und `bits()` mit
`count > 64` wären ebenfalls UB, werden aber von den Aufrufern nicht erreicht.

**Bewertung.** Das ist Code von jemandem, der V4L2 und VA-API kennt. Das
Projekt legt zudem denselben Beweismaßstab an, den dieses Repo führt:
„a mapped node or a running GPU process proves nothing".

## Was dagegen spricht

Null Sterne, ein Autor, zwei Wochen alt, zuletzt am Erstellungstag angefasst.
Alle Testergebnisse sind **Eigenangaben**; die 76-KB-`TEST-RESULTS.md` nennt
Boot-IDs, Kernel- und Modulhashes und trennt sauber „Passed" von „Pending",
aber niemand sonst hat das validiert.

Schwerer wiegt der Einsatzort: ein Userspace-Treiber, der in **Chromiums
GPU-Prozess** geladen wird und dort fremde Bitstreams verarbeitet, inklusive
eigener HEVC- und AV1-Rekonstruktion. Er würde in dem Prozess laufen, der die
authentifizierte NVIDIA-Sitzung bedient. In diesem Projekt gab es bereits einen
ungeklärten SIGSEGV.

Upstream meldet AV1 ausdrücklich **nicht** als angeboten; HEVC Main erreicht
Fluster 111 von 147, was laut Autor der Fähigkeit der Firmware selbst entspricht.

## Ablauf

Alles ohne Änderung am Hostimage, ohne `rpm-ostree`-Layering und ohne
systemweite Installation. Das Modul wird in einem Wegwerfcontainer gebaut und
ausschließlich über `LIBVA_DRIVERS_PATH` geladen; Entfernen heißt ein
Verzeichnis löschen.

```sh
# 1. Voraussetzungen prüfen. Ändert nichts, startet keinen Client.
experiments/vaapi-iris/preflight.sh

# 2. Treiber im Container bauen, Modul ins Benutzerverzeichnis.
experiments/vaapi-iris/build-driver.sh

# 3. Fähigkeiten messen, mit Referenzlauf ohne Treiber zum Vergleich.
GFN_VAAPI_ROOT=~/.local/share/gfn-armada-tests/vaapi-iris-YYYYMMDD \
GFN_ARMADA_INSTANCE=~/.local/share/gfn-armada-tests/bridge-nativequeue-20261004 \
experiments/vaapi-iris/run-probe.sh
```

Schritt 1 entscheidet alles Weitere: **ist `libva.so.2` auf ArmadaOS
vorhanden?** Chromium lädt sie dynamisch. Fehlt sie, ist dieser Weg ohne
zusätzliche Bibliothek zu, und es bleiben Sourcebuild oder WebKit.

## Abbruchkriterien und Bewertung

`run-probe.sh` fährt bewusst zuerst einen Referenzlauf **ohne** Treiber, damit
ein Unterschied dem Treiber zuzuordnen ist und nicht den Schaltern.

* `video/H265` erscheint und `mediaCapabilities.hevc.supported` wird `true`
  → die GPU-Decoderfabrik meldet HEVC, GFN kann H.265 verhandeln.
* `mediaCapabilities.h264.powerEfficient` springt auf `true`
  → Hardware-Decode für den heute tatsächlich verhandelten Codec.
* Keine Änderung gegenüber der Referenz → der Treiber wurde nicht geladen.

Angebotene Fähigkeit bleibt kein Nachweis. Erst ein echter Stream zählt, und
dort ausschließlich `decoderImplementation` aus `getStats()` sowie Frames und
Drops über ein Zeitfenster — dieselbe Messung, die den bisherigen
FFmpeg-Softwaredecode belegt hat.

## Verhältnis zur bestehenden Brücke

Trägt dieser Weg, wird die Brücke für die Produktion überflüssig: der Frame
verlässt den Browser nicht, damit entfallen Präsentationsersatz, A/V-Sync,
Live-Fallback und der Helperprozess. Die Brückenarbeit bleibt der Nachweis,
dass die Iris den echten GFN-Stream in Echtzeit decodiert, und sie bleibt das
Messinstrument. Abgeschaltet wird sie erst, wenn dieser Weg gemessen trägt.

## Messergebnisse am Gerät (2026-10-05)

Alles unten ist am Odin 2 Portal gemessen, Kernel 7.2.6, ArmadaOS
20261002.43c0cca. Nichts systemweit installiert, Hostimage unberührt.

### Voraussetzungen: erfüllt

`libva.so.2` liegt unter `/lib64`, dazu libva-drm, libdrm, EGL, GLESv2, gbm.
Iris-Decoder `/dev/video0` (`driver=iris_driver`, `card=Iris Decoder`), Encoder
auf `/dev/video1`. Die vorhandenen VA-Treiber sind ausschließlich Mesa-Gallium
(d3d12, nouveau, r600, radeonsi, virtio_gpu) — **nichts für Qualcomm**, was die
Annahme einer Mesa-Übersetzungsschicht widerlegt. `v4l2-ctl` fehlt, wird vom
Treiber aber nicht gebraucht: er findet den Knoten selbst per `glob` und
`VIDIOC_QUERYCAP`.

Per ioctl gelesen, `/dev/video0` OUTPUT (Eingang der Firmware):
**`H264`, `HEVC`, `VP90`, `AV01`**, alle als komprimiert markiert; CAPTURE
liefert `NV12`, `P010` sowie die UBWC-Varianten `Q08C`/`Q10C`. Die Firmware
akzeptiert HEVC und AV1 und kann 10 Bit.

### Der Treiber decodiert auf dieser Hardware

Bau im Wegwerfcontainer, Upstream-Unit-Tests auf dem Gerät 26 Fälle/0 Fehler,
Meson-Suite 14/14. libva lädt ihn (`va_openDriver() returns 0`,
„Qualcomm Iris V4L2 stateful").

Mit einem Clip **ohne B-Frames** (`-tune zerolatency -bf 0`, 60 fps, 180 AUs)
über ffmpeg:

```text
session finish submitted=180 completed=180 errors=0 drops=0 timeouts=0 drains=1
```

Mit B-Frames schlägt es fehl (`syncSurface: target decode failed`, Fehler 23).
Ursache aus dem Trace: `mode=display-order`. Ohne das decode-order-Kernelmodul
hält die Firmware Frames zur Umsortierung zurück, der Client wartet auf Frame 1,
der Treiber bricht per Timeout mit einem Drain auf und startet die Session neu.
**Für GFN bedeutungslos** — Spielstreaming nutzt keine B-Frames. Die
Upstream-Probe `iris-import-probe` verlangt dieses Modul ausdrücklich
(`decode-order control: NO`), der Treiber selbst nicht.

### Chromium: Fähigkeiten ja, Decode nein

Erster Befund, aus `media/gpu/vaapi/vaapi_wrapper.cc`: der Render-Node-Scan
überspringt **alle Nicht-PCI-Geräte**. Eine SoC-GPU wird daher nie gefunden,
VA-API initialisiert nicht, und keine Feature-Flag ändert das.
`--hardware-video-device-path` umgeht den Scan.

Damit meldet das unveränderte, ausgelieferte Electron:

| Codec | supported | powerEfficient |
|---|---|---|
| H.264 | true | **true** |
| HEVC | **true** | **true** |
| AV1 | true | false |

und `video/H265` erscheint in den Receive-Capabilities, also im SDP-Angebot an
GFN. Ohne Sourcebuild.

Im echten Stream bleibt es dennoch bei
`FFmpeg (fallback from: ExternalDecoder (VaapiVideoDecoder))`. Der
instrumentierte Treiber zeigt, warum nicht bei ihm gesucht werden muss:

```text
va init ... profiles=7
va create_config id=1 profile=13 rt_format=0x1     # HEVC Main
va create_config id=2 profile=7  rt_format=0x1     # H.264 High
session open node=/dev/video0 mode=display-order codec=H264 1920x1088
va create_context id=3 profile=7 1920x1088 targets=0
va destroy_context id=3 pending=0                  # 13 ms später
```

Beim GPU-Init fragt Chromium alle Profile vollständig ab (6, 7, 13, 17, 18, 19)
und erhält Antworten. In der Decodephase ruft es **weder `querySurfaceAttributes`
noch `createSurfaces`** — es erzeugt den Kontext und verwirft ihn. Der Abbruch
liegt damit in Chromiums eigener Frame-Pool-Einrichtung, die den VA-Treiber
nicht berührt. Chromium meldet dazu keine Fehlerzeile;
`videoDecodeAcceleratorSupportedProfile` ist leer.

Zwei Hypothesen wurden geprüft und **widerlegt**:

* *GPU-Sandbox blockiert `/dev/video0`.* Mit `--disable-gpu-sandbox` änderte sich
  nichts, und der Trace zeigt `session open node=/dev/video0` im GPU-Prozess bei
  aktiver Sandbox. Der Treiber öffnet den Knoten dort problemlos.
* *Fehlender DRM_PRIME_2-Import.* Der beiliegende Patch
  [`patches/0001-va-accept-drm-prime-2-surface-import.patch`](patches/0001-va-accept-drm-prime-2-surface-import.patch)
  bewirbt `MEM_TYPE_DRM_PRIME_2` und nimmt klientallokierte Puffer an (ein
  Objekt, linearer Modifier, Fourcc-Prüfung, Plane-Layout- und Größenprüfung,
  duplizierter fd, Surface als `persistent_export`, sodass der bestehende
  Kopierpfad hineinschreibt). Er baut mit `-Wall -Wextra`, die Upstream-Suite
  bleibt grün — und am Verhalten ändert er nichts, weil Chromium nie bis zur
  Surface-Anforderung kommt.

### Offen

Chromiums Grund ist unbeobachtet. Seine VERBOSE-Logs sind aus dem Client nicht
zu bekommen: Chromium initialisiert Logging vor dem JS-Einstieg, weshalb
`app.commandLine.appendSwitch('vmodule',…)` wirkungslos bleibt (INFO erscheint,
VERBOSE nie), und der Launcher lehnt beliebige Runtime-Flags bewusst ab — diese
Zusicherung prüft `tests/launcher.test.cjs:82` und sie bleibt unangetastet. Der
Diagnose-Entrypoint `tests/probe-vaapi-stream.cjs` kann die Schalter auf argv
übergeben, in seinem Fenster startet GFN aber keine Sitzung (0 Stichproben in
110 s), während der produktive Client zuverlässig streamt. Damit fehlt der eine
Logeintrag, der die Frage beantworten würde.

### Nebenbefund, endgültig

GFN schaltet AV1 für Linux **serverseitig** ab. Aus der Clientkonfiguration im
Log: `"disableConfigList":["PLT=WINDOWS;VEN=QUALCOMM;COD=AV1","PLT=STEAMOS;COD=AV1","PLT=LINUX;COD=AV1",…]`.
Clientfähigkeit spielt dafür keine Rolle.
