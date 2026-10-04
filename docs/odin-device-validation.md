# Odin 2 Portal: Gerätetest vom 2026-10-04

SSH-Zugriff als normaler Benutzer; keine Basissystempakete installiert und keine
Steam-Dateien geändert. Client als portables Bundle unter
`~/.local/opt/gfn-armada-0.1.0/gfn-armada-linux-arm64` ausgepackt.
Das übertragene Archiv wurde per SHA256 geprüft. Anschließend wurden Main und
Launcher mit der Wayland-Startkorrektur aus dem Repository aktualisiert.

## System

- Gerät: AYN Odin 2 Portal, aarch64
- ArmadaOS: `20261001.72f2a63`, Fedora 44
- Kernel: `7.2.6`
- Grafik: Turnip Adreno 740, Mesa `26.2.3`
- Sitzung: KDE/KWin Wayland; kein Gamescope-Prozess beim Test
- `/dev/video0`: `qcom-iris-decoder`, Treiber `qcom-iris`
- `/dev/video1`: `qcom-iris-encoder`
- Keine `/dev/media*` beim Test; `v4l2-ctl` nicht installiert
- FFmpeg bietet `hevc_v4l2m2m` und `h264_v4l2m2m`; diese wurden nicht getestet.
- GStreamer `1.28.7`: `v4l2h264dec`, `v4l2h265dec`, `v4l2av1dec`

## HEVC: VPU-Test erfolgreich

Ein selbst erzeugter HEVC Main / 8-bit / 720p30-Testclip mit 60 Frames wurde
erfolgreich durch `v4l2h265dec` bis EOS decodiert. Das Debuglog bestätigt
`Opened device 'Iris Decoder' (/dev/video0) successfully` und auf dem
Decoder-Ausgang `video/x-raw(memory:DMABuf)`, `DMA_DRM`, `NV12`.
Die Pipeline enthält keinen Softwaredecoder. Das ist ein erfolgreicher
Qualcomm-VPU-Test für diesen Clip, kein Nachweis eines GFN-Hardwarestreams.
`fakesink` prüft nicht den DMA-BUF-Import in Wayland/GPU, Bildkorrektheit oder
die Zahl der Frame-Kopien bis zur Anzeige. Noch kein 1080p/120-Hz-Leistungstest.

Reproduktion auf dem Portal:

```sh
mkdir -p ~/.local/share/gfn-armada-tests
ffmpeg -nostdin -hide_banner -loglevel warning \
  -f lavfi -i testsrc2=size=1280x720:rate=30 -frames:v 60 \
  -c:v libx265 -preset ultrafast \
  -x265-params pools=2:frame-threads=2:log-level=error \
  -y ~/.local/share/gfn-armada-tests/hevc-720p.h265
GST_DEBUG=v4l2*:4 timeout 20 gst-launch-1.0 -v \
  filesrc location="$HOME/.local/share/gfn-armada-tests/hevc-720p.h265" \
  ! h265parse ! v4l2h265dec ! fakesink sync=false
```

Die `device`-Eigenschaft dieses generierten GStreamer-Decoders ist nicht
schreibbar. Ein erster Test mit `device=/dev/video0` erzeugte einen Warnhinweis;
der bestätigende Test oben wurde ohne diese Eigenschaft wiederholt.
AV1 und H.264 wurden noch nicht tatsächlich decodiert.

## Electron: GFN lädt, HEVC fehlt im WebRTC-Angebot

Electron `44.5.1` / Chromium `152.0.7977.130` läuft mit explizitem
`--ozone-platform=wayland`. Die Auswahl erst in Main-JavaScript kam bei diesem
Bundle zu spät: der erste Start scheiterte am X11-Zugriff. Der Launcher setzt
den Schalter jetzt beim Prozessstart; Argumente für Erst- und Zweitinstanz
werden passend ausgewertet. Zusammen mit der Apple-Login-Korrektur bestehen
17 Tests auf dem Mac.

Die geladene GFN-Seite meldet über die Telemetrie
`ANGLE (freedreno, FD740, OpenGL ES 3.2)` und WebRTC-Empfangscodecs H.264,
VP8, VP9 und AV1. **H.265 fehlt in diesem Laufzeitangebot.** Der erfolgreiche
GStreamer-Test macht HEVC deshalb noch nicht im Electron-Client nutzbar.
Das Startlog enthält außerdem `vaInitialize failed`; VA-API ist kein bestätigter
Pfad zur Iris-VPU. Frühe GPU-Feature-Snapshots vor abgeschlossener Initialisierung
meldeten Software/disabled und dürfen nicht allein als Endzustand gelesen werden.

NVIDIA-Loginseite wurde geladen. Beim Apple-Login blockierte die ursprüngliche
Navigationskontrolle externe Anmeldeseiten. `appleid.apple.com` wurde entsprechend
Apples [offizieller Autorisierungsdokumentation](https://developer.apple.com/documentation/signinwithapplerestapi/request-an-authorization-to-the-sign-in-with-apple-server.)
explizit erlaubt und die Testinstanz neu gestartet. Keine pauschale Freigabe
aller Apple-Domains. Blockierte Navigationen melden nur die Origin, keine
OAuth-Queryparameter. Erfolgreicher Login bleibt durch den Nutzer zu prüfen.
Der Nutzer bestätigt, dass die Apple-Seite nach der Korrektur erreichbar ist.
„Sign in with iPhone“ zeigt jedoch keinen QR-Code. Kein weiterer blockierter
Redirect/Popup wurde bei diesem Versuch protokolliert. Das ist somit kein
belegter weiterer Allowlist-Fehler. Electron besitzt nicht automatisch die
Chrome-Oberfläche für den WebAuthn-Hybridtransport. Im
[WebAuthn-Delegate von Electron 44.5.1](https://github.com/electron/electron/blob/v44.5.1/shell/browser/webauthn/electron_authenticator_request_client_delegate.cc)
werden Bluetooth-Aktionscallbacks nicht an eine QR-/Transportoberfläche
angebunden. Diese Einschränkung passt zum beobachteten Verhalten; der konkrete
WebAuthn-Request der Apple-Seite wurde noch nicht instrumentiert.
Als erster Loginversuch bleibt Apples Anmeldung mit Apple-Account und Passwort
innerhalb derselben Sitzung. Ein voller Chromium-Browser wäre eine Alternative
für Hybrid-Passkeys, würde aber ein eigenes persistentes Profil benötigen.
Ein Login im externen Browser überträgt nicht automatisch eine Sitzung an
Electron; keine Cookies oder Auth-Tokens kopieren oder einen Callback erfinden.
Controller-Liste war leer: es gab noch keinen bestätigten Gamepad-Test.
Bei diesem ersten Login-Test noch kein aktiver Stream; der spätere
Spielstart ist im folgenden Abschnitt dokumentiert.
Hardwaredecoder und DMA-BUF im GFN-Client bleiben `unknown`.

## Erster Spielstream und Absturz

Der Nutzer konnte sich anmelden und ein Spiel starten. Am 2026-10-04 um
09:10 CEST meldete WebRTC `video/H264`, 136 decodierte Frames, 0 gemeldete
Drops und durchschnittlich ca. 5,45 ms Decode-Zeit (kumulativer kurzer Snapshot).
Decodername und `powerEfficientDecoder` wurden nicht geliefert.
Wenige Sekunden später stürzte der Electron-Hauptprozess mit SIGSEGV ab.
Der System-Core ist abgeschnitten und bietet bisher keinen verwertbaren Stack.
Damit ist weder ein VPU-Fehler noch ein spezifischer Wayland-Bug bewiesen.

Für einen kontrollierten Vergleich wurde dieselbe Profilsitzung mit
`GFN_ARMADA_OZONE=x11`, `DISPLAY=:0` und dem vorhandenen Sitzungs-`XAUTHORITY`
neu gestartet. Der Renderer meldet dort Freedreno FD740 / OpenGL 4.6;
GFN lädt. Der Nutzer bestätigt einen erfolgreichen Spielstart und einen als
Xbox-Controller erkannten eingebauten Controller. Im letzten Stream-Snapshot
wurden 19.334 H.264-Frames, 0 gemeldete Drops und ca. 5,32 ms durchschnittliche
Decode-Zeit gemeldet. Gamepad: Standard-Mapping, 17 Buttons, 4 Achsen.
Der Prozess blieb nach diesem Test am Leben. Das belegt diesen erfolgreichen
XWayland-Test, keine langfristige Stabilität oder genaue Wayland-Absturzursache.
Der Standard bleibt natives Wayland. `GFN_ARMADA_OZONE` akzeptiert nur `x11`
oder `wayland` und verändert weder NVIDIA-Streamparameter noch Sandbox.
Der Launcher protokolliert jetzt auch Exit-Code/Signal des GUI-Prozesses.
18/18 lokale Tests bestehen. Keine Debuggerpakete ins Basissystem installiert.

## GFN-Overlay mit Controller

NVIDIA dokumentiert langes Halten der START-/Menütaste als Standardshortcut.
Im Overlay kann die Kombination unter Einstellungen → Shortcuts → Gamepad
geändert werden. Der Shortcut wird seit GFN 2.0.83 auch auf Linux und den
meisten Browserplattformen angeboten. Quelle:
[NVIDIA Support](https://nvidia.custhelp.com/app/answers/detail/a_id/5827).
Noch nicht auf diesem Gerät bestätigt; deshalb keine zweite Belegung injiziert,
die den vorhandenen GFN-Shortcut doppelt auslösen könnte.

Lokales unversioniertes VPU-Testlog: `.artifacts/odin/hevc-v4l2.log`.
Geräteseitige Testdaten: `~/.local/share/gfn-armada-tests/`.
Chromium-Debuglogs können Seitenmeldungen enthalten und müssen vor Weitergabe
auf personenbezogene Daten geprüft werden; keine Auth-Logs committen.

## Laufende Decoderdiagnose am 2026-10-04

SSH ist wieder erreichbar. Die ergänzte Diagnose läuft im ursprünglichen
GFN-Webclient unter XWayland, Electron 44.5.1 / Chromium 152.0.7977.130.
Um 09:39 UTC meldet der Stream H.264, 12.157 decodierte Frames, 0 gemeldete
Drops und ca. 5,10 ms kumulative mittlere Decode-Zeit. Der Controller meldet
Standard-Mapping, 17 Buttons und 4 Achsen.

Eine 60-Sekunden-Probe zwischen 09:35:31 und 09:36:31 UTC liest die zugänglichen
Dateideskriptoren der Clientprozesse alle 250 ms. Beobachtet wird
`/dev/dri/renderD128`, kein `/dev/video*` oder `/dev/media*`. Das zeigt GPU-Zugriff,
aber keinen beobachteten Zugriff auf Iris. Die Probe kann kurzlebige Zugriffe
oder Zugriffe anderer Prozesse übersehen und beweist allein kein Software-Decoding.
Weder WebRTC noch die optionale CDP-Media-Diagnose liefern bislang einen
konkreten Decodernamen. `hardwareDecoderActive` und GFN-DMA-BUF bleiben `unknown`.
Auch Chromiums Featurestatus `video_decode: enabled` ist kein Hardwarebeweis.

Die Nutzerentscheidung bleibt der originale GFN-Webclient. OpenNOW wurde für
die Untersuchung heruntergeladen und entpackt, aber nicht als Client gestartet.
Der getrennte erfolgreiche HEVC-Iris-Test bleibt ein Nachweis des Gerätedecoders,
kein Nachweis für HEVC im GFN-Stream.
