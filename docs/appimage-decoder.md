# Experimenteller Decoder im AppImage

Stand 2026-10-05: Das AppImage enthält `iris-driver/dri/v4l2_drv_video.so`,
den gepinnten Commit `f587b14e6b22955c7250a45ff5f43588bbce2114` und alle vier
Patches aus `experiments/vaapi-iris/patches`: DRM-PRIME-2-Import, Slice-Trace,
PPS-ID-Korrektur und gemeinsame Exp-Golomb-Grenzprüfung. Der Build verwendet
Debian bookworm ARM64 mit GCC 12 und GPU-Copy-Unterstützung. Der frühere Odin-
Build verwendete Fedora 44: gleicher Quellstand bedeutet keine identische
Binärdatei oder bereits nachgewiesene Laufzeitkompatibilität.

`build/Containerfile.iris` baut das Modul, führt die statischen Upstream-Prüfungen
und die Meson-Tests aus. Das AppImage enthält das Manifest mit Modul-/Patch-
Prüfsummen und Build-Paketversionen, die Lizenzdateien samt Autorenhinweisen
und `patched-source.tar.gz` mit den vollständigen modifizierten Quellen.
Der Decoder ist eine separate dynamisch geladene Bibliothek. Die Systembibliotheken
libva, libdrm, EGL, GLESv2, GBM und libstdc++ bleiben vom Betriebssystem gestellt;
Mesa/Turnip wird nicht durch Debian-Bibliotheken im Paket ersetzt.

## Auswahl

Ohne zusätzliche Umgebungsvariablen wählt der Launcher das beigepackte Modul,
wenn alle Bedingungen erfüllt sind:

- Linux ARM64, `hardware_decode = true`.
- Device-Tree-Modell enthält Odin und Portal.
- Wayland-Umgebung und kein ausdrücklicher X11-Override.
- Iris-Decoder in `/sys/class/video4linux` und ein DRM-Renderknoten vorhanden.
- Kein bereits gesetzter externer VA-API-Treiber/-Pfad.
- Modulprüfung stimmt mit dem eingebetteten Manifest überein.

Die Knoten werden anhand der vorhandenen Geräte ermittelt. Der Launcher setzt
`LIBVA_DRIVER_NAME=v4l2`, den **internen** `LIBVA_DRIVERS_PATH`, den erkannten
Videoknoten und `GFN_ARMADA_VAAPI` auf den Renderknoten. Die bestehenden
Wayland-/ANGLE-GL-Schalter bleiben der gemessene Browserpfad. Es wird kein
Gamescope gestartet und keine Sandbox abgeschaltet. Die Auswahl kann Fähigkeiten
inklusive HEVC anbieten; GFN-Einstellungen werden nicht automatisch geändert.

Abschalten für einen Vergleich mit dem normalen Browserpfad:

```sh
GFN_ARMADA_BUNDLED_IRIS=0 ./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run launch
```

`GFN_ARMADA_BUNDLED_IRIS=1` überspringt nur die Modellprüfung für explizite
Experimente auf anderer Iris-Hardware; Wayland und Geräte bleiben erforderlich.
`auto` ist der Standard. Externe `LIBVA_DRIVERS_PATH`, `LIBVA_DRIVER_NAME` oder
`GFN_ARMADA_VAAPI` behalten Vorrang und müssen vollständig eingerichtet sein.
Die bestehenden Steam-Shortcuts starten dieselbe Datei und erhalten damit den
gleichen Decoderstand, ohne individuelle Treiberpfade.

## Diagnose und Beweisgrenzen

`diagnostics` zeigt unter `bundledDecoder` Quellcommit, Modulhash, Patchliste,
Auswahlstatus und Grund. `selected: true` bedeutet **angefordert**, nicht
Hardwaredecode bestätigt. Der Client schreibt diese Auswahl in seinen
Runtime-Snapshot; dessen tatsächliche Decoder-/Frame-Evidenz bleibt separat.

Der AppImage-Smokecheck entpackt das echte Paket, prüft vier Patches/GPU-Copy,
SHA256, auflösbare ELF-Abhängigkeiten und das Laden per `dlopen` als UID 1000.
Er testet keine VPU ohne Gerät. Der bisherige Hardware-Nachweis gilt dem
separat installierten H.264-Treiber, nicht diesem neu gebauten Modul.
HEVC und AV1 bleiben unbestätigt; der gemessene H.264-Pfad verwendet eine GPU-Kopie.
