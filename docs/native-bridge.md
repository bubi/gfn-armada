# Experimentelle Brücke für den originalen GFN-Webclient

Paralleler GFN-H264-Hardwarepfad nachgewiesen; dauerhafte Ausgabe noch nicht validiert:

**Live-GFN-Test wieder aufgenommen:** Beim früheren zweiten echten Streamstart
wurde ein nicht unterstützter Farbraum abgelehnt; wenige Sekunden später
stürzte der Client mit SIGSEGV ab. Die Ursache ist noch nicht zugeordnet.
Ein Node-Worker ist ein Thread im selben Prozess und isoliert native
Speicherfehler nicht. Der native Pfad ist jetzt in einen separaten Electron-
Helper verlegt. Gezielt ausgelöste Helper-SIGSEGVs am Mac und auf dem Portal
ließen das Browservideo weiterlaufen. Die lokale Iris-/DMA-BUF-Ausgabe im
separaten Helper ist bei 720p über 30 Sekunden bestätigt; ein echter
GFN-Stream mit der neuen Prozessgrenze wurde anschließend getestet: der
erste Versuch stoppte bei acht ausstehenden Paketen vor dem ersten Transfer
mit `compressed-queue-overflow`. Der Helper beendete sich mit Exit 0 und
das ursprüngliche Browservideo lief mit FFmpeg weiter. Die native Pipeline
wird nun vor der Bereitschaftsmeldung vorbereitet; diese Korrektur besteht
lokale Mac-/Portal-Tests. Der anschließende echte Stream lieferte als
Farbraum-Befund volles BT.709, das bisher abgelehnt wurde. Der Adapter
übernimmt nun Limited/Full Range entsprechend den ausgehandelten Caps;
beide Varianten bestehen lokale Iris-/DMA-BUF-Farbtests. Der echte GFN-
Ausgabetest mit dieser Korrektur lieferte 610 Iris-/DMA-BUF-Transfers und
Renderer-Draws; danach stoppte die Bridge erneut bei voller komprimierter Queue.
Alle Samples wurden freigegeben und der Browserstream lief weiter. Dauerhafte
Hardwareausgabe ist damit noch nicht erreicht. Das Frontend bleibt XWayland,
der Helper Wayland. Die ursprüngliche SIGSEGV-Ursache ist offen.

```text
GFN RTCRtpReceiver → RTCRtpScriptTransform (unveränderte Frames weiterreichen)
                         ↓ Kopie der komprimierten H264-Access-Units
Tap-Worker → begrenzter MessagePortMain → Supervisor im GFN-Prozess
  (sandboxed Preload reicht den Port nur beim Aufbau weiter)
  → Staging-Queue (64 Pakete / 4 MiB, ACK bei Annahme, Burst-Puffer)
  → binär gerahmte Pipe (nur komprimierte Bytes und Status)
  → separater Electron-Helper / temporäres Profil / eigener GPU-Prozess
      → Node-Worker → GStreamer appsrc → h264parse → v4l2h264dec → appsink
      → NV12 DMA-BUF → SharedTexture → sandboxed Diagnose-Canvas
```

Die Originaloberfläche, Login, WebRTC-Transport, Audio, Controller und das
ursprüngliche Browser-Decoding bleiben aktiv. Es handelt sich bewusst um
einen parallelen Diagnosepfad in einem separaten Fenster. Er spart noch
keine CPU; Audio-Sync oder Ersetzen des ursprünglichen Videoelements sind
nicht implementiert. HEVC-Aushandlung wird nicht durch diesen Adapter ergänzt.

## Bauen und explizit aktivieren

```sh
./scripts/build-dmabuf
./scripts/build
```

Das GStreamer-/Node-API-Modul liegt in `.artifacts/dmabuf/bridge.node`; es
verwendet die Fedora-44-GStreamer-Systembibliotheken. Nur dieses Artefakt
und das ARM64-Clientbundle auf das Gerät übertragen, keine Basispakete
installieren. Beispielsweise das Modul im eigenen Datenverzeichnis ablegen:

```sh
GFN_ARMADA_OZONE=x11 \
GFN_ARMADA_NATIVE_SHADOW=1 \
GFN_ARMADA_NATIVE_BRIDGE="$HOME/.local/share/gfn-armada/native/bridge.node" \
GFN_ARMADA_LOG=debug gfn-armada launch steam:1091500
```

Der absolute Modulpfad muss existieren und das neue `openStream`-/`pushFrame`-
API enthalten. Ohne `GFN_ARMADA_NATIVE_SHADOW=1` wird kein natives Modul
geladen und kein Transform eingesetzt. Die normale GFN-Sitzung bleibt im
bisherigen Profil. Login vor dem experimentellen Streamtest erledigen.

Natives Wayland ist der bisher bestätigte Electron-DMA-BUF-Ausgabepfad.
Der Linux-Helper verwendet Wayland unabhängig vom Frontend. Das ursprüngliche
GFN-Frontend kann beim bisherigen XWayland-Modus bleiben; seine früheren
Stabilitätsprobleme unter nativem Wayland bleiben relevant. Der neue getrennte
Hardwarepfad ist mit lokalem H264-WebRTC auf dem Portal bestätigt.
XWayland-SharedTexture-Import funktionierte im lokalen Vergleich nicht.
Das zusätzliche Diagnosefenster kann Fokus/Steam-Input beeinflussen; dies
ist kein fertiger Gaming-Mode-Ausgabemodus.

## Codec, Timing und Fallback

* Der Worker wird geladen und bestätigt seine Bereitschaft, **bevor** er
  in einen Live-Empfänger eingesetzt wird. Ein durch CSP blockierter Worker
  wird deshalb nicht an den Decoderpfad gebunden. CSP/Web-Security und Sandbox
  bleiben aktiv.
* Der Proxy erfasst nur neue Videoempfänger. GFN darf zuerst seinen synchronen
  Track-Handler ausführen. Ein vorhandener Transform wird erhalten. Bereits
  existierende Peers, andere Frames/Worker oder spätere GFN-Transformwechsel
  können unsichtbar bleiben. Die echte GFN-CSP/Hook-Kompatibilität ist offen.
  Framefreie Prüfempfänger vor dem Spielstart verbrauchen den Anschluss nicht
  dauerhaft: nach ihrem Ende wird ein neuer Worker vorbereitet. Sobald echte
  Frames übernommen wurden, bleibt ein Empfängerwechsel ein Abbruchgrund.
  Anbindung erst bei `connectionState=connected` wurde verworfen: die lokale
  Probe lieferte dabei keine Encoded-Frames trotz weiterlaufendem Browservideo.
* Codec anhand `getMetadata().mimeType` beziehungsweise Payload-Type und
  ausgehandelten Receiver-Parametern bestimmen. Nur H264 zulassen. Kein
  Umdeuten von VP9/AV1/HEVC-Bytes als H264.
* Erst mit einem Annex-B-Keyframe einschließlich SPS/PPS beginnen. Ohne
  In-Band-Parameter-Sets bleibt die native Ausgabe aus. Keyframe-Request ist
  best effort; die Mac-Probe meldete teilweise `keyframe-request-unavailable`.
* RTP-Timestamps werden mit 90 kHz in relative GStreamer-PTS umgerechnet;
  uint32-Rollover wird unterstützt. Große Sprünge, veraltete/umgeordnete
  Pakete und Codec-/Receiverwechsel stoppen diesen ersten Prototyp. Keine
  B-Frame-/Clock-Recovery oder automatische Session-Wiederaufnahme.
* Maximal acht unbestätigte komprimierte Pakete, je höchstens 2 MiB und
  zusammen höchstens 4 MiB, separat in Tap-Worker, Supervisor-Zulauf, Helper-Pipe
  und Helper begrenzt. Bestätigungen enthalten die Sequenz; unbekannte
  Bestätigungen geben keine zusätzlichen Credits frei.
  Native appsrc maximal acht Frames / 4 MiB, Appsink zwei Frames, höchstens
  vier ausstehende DMA-BUF-Leases im Worker.
  Der Supervisor hält zusätzlich eine eigene Staging-Queue von höchstens
  64 Paketen / 4 MiB und bestätigt den Tap-Worker bei **Annahme**, nicht nach
  der nativen Runde. Ein Burst wird dadurch gepuffert, statt die Brücke zu
  beenden. Läuft das Tap-Fenster trotzdem voll, wird bis zum nächsten
  Keyframe mit SPS/PPS verworfen und danach weitergemacht; jeder verworfene
  Frame und jeder Resync wird gezählt und gemeldet. Kein Delta-Frame wird
  unbemerkt verworfen und trotzdem Erfolg gemeldet. Eine volle Staging-Queue
  bedeutet dauerhafte Überlast und stoppt den Diagnosepfad weiterhin.
* GStreamer-Aufrufe und Decoder-Close laufen im Node-Worker **des Helpers**.
  Nur dessen Main importiert FDs; der GFN-Main-Prozess lädt kein natives Modul.
  Der Sample-Lease bleibt im Worker bis zur prozessübergreifenden
  `allReferencesReleased`-Bestätigung. Es werden komprimierte Bytes kopiert,
  keine Rohpixel im Addon gemappt.
* Der Helper besitzt ein separates temporäres Profil ohne NVIDIA-Session,
  blockiert Netzwerkrequests und Berechtigungen und erlaubt nur das lokale
  Diagnosefenster. Die Prozessgrenze isoliert native Abstürze, ist keine
  zusätzliche OS-Berechtigungsgrenze: der Helper läuft als derselbe Benutzer.
  Parent und Helper tauschen keine numerischen FDs aus; dadurch ist kein
  SCM_RIGHTS-Adapter nötig. Nur komprimierte Access-Units werden kopiert.
* Supervisor zur Helper-Pipe: maximal acht offene Pakete / 4 MiB, davor die
  Staging-Queue; Paketbestätigung der Pipe spätestens nach
  zwei Sekunden, Bereitschaft nach höchstens 15 Sekunden. Fehler verwerfen
  offene Anfragen mit `false`. Stop wartet begrenzt auf den Helper und beendet
  ihn nach drei Sekunden nötigenfalls mit SIGKILL. Keine automatische
  Wiederholung eines abgestürzten Helpers. Dessen Exit-Code/Signal und PID
  werden protokolliert, der ursprüngliche Browserpfad bleibt aktiv.
* Paketablehnung oder native Decoder-/Importfehler deaktivieren die Kopie,
  während der Encoded-Worker die Originalframes weiterreicht. Ein Worker-
  Absturz **nach** erfolgreicher Anbindung ist ein eigener, noch nicht
  getesteter Fehlerfall: Transform entfernen, Fehler melden; ein erneuter
  GFN-Spielstart kann nötig sein. Nicht mit dem geprüften CSP-Preflight verwechseln.
* Vollständige Dokumentnavigation, Empfängergenerationwechsel, Schließen
  des Diagnosefensters und Fehler stoppen die Brücke. Zum neuen Experiment
  den Client neu starten. Kein automatischer Restart-Loop.

Farbraum/Import auf lineares NV12 und BT.709 mit ausgehandeltem begrenztem
oder vollem Wertebereich beschränkt; unbekannte/HDR-Farbräume bleiben abgelehnt.
Auflösungswechsel werden nicht als unterstützter Produktionspfad behauptet.
Die Iris→Electron-Ausgabe ist mit dem früheren HEVC-Clip und inzwischen
auch mit lokalem H264-WebRTC über appsrc validiert. Ein echter GFN-Stream
benötigt weiterhin einen eigenen Test.

## Diagnose und Tests

`runtime.json.nativeShadow` und strukturierte `native-shadow`-Logeinträge
enthalten Status, Codec, Frame-/Draw-/Freigabezähler, Zeitstempel und letzte
Transferzeit. Kein SDP, keine ICE-Adressen, keine Tokens und keine Videobytes
im Log. Der globale GFN-Hardwarestatus wird dadurch nicht auf `yes` gesetzt.
Ein geöffnetes V4L2-Element allein reicht nicht für einen Laufzeitnachweis.

Mac, reale lokale WebRTC-Sitzung mit dem produktiven Preload:

```sh
./node_modules/.bin/electron tests/smoke-native-bridge.cjs
GFN_ARMADA_TEST_HELPER_CRASH=1 ./node_modules/.bin/electron tests/smoke-native-bridge.cjs
GFN_ARMADA_TEST_HELPER_REJECT=1 ./node_modules/.bin/electron tests/smoke-native-bridge.cjs
GFN_ARMADA_TEST_BACKPRESSURE=1 ./node_modules/.bin/electron tests/smoke-native-bridge.cjs
GFN_ARMADA_TEST_BLOCK_WORKER=1 ./node_modules/.bin/electron tests/smoke-native-bridge.cjs
```

Das HTTPS-Testdokument wird im separaten temporären Profil lokal beantwortet;
keine NVIDIA-Web-App, keine Login-Daten oder externe Netzwerksitzung.
Ohne Modulpfad ist der Scope ausdrücklich `encoded-tap-only` und
`nativeTested:false`. Finale Mac-Probe: 99 komprimierte Pakete, 32 Browserframes;
Paketablehnungs-Fallback: ein Paket, 64 weiterlaufende Browserframes;
CSP-Preflight-Fallback: kein Paket, 64 Browserframes. Die verzögerte Ablehnung
belegt nicht, dass tatsächlich eine Queue überlief (`overflow:false`).

Linux ARM64 / Portal: denselben Test mit absolutem `GFN_ARMADA_NATIVE_BRIDGE`
ausführen. Er prüft zusätzlich mindestens 30 DMA-BUF-Transfers/Draw-Aufrufe,
Farbinhalt per einmaligem Pixelreadback und vollständige Lease-Freigabe.
Die gepackte Testlaufzeit braucht eine eigene `resources/app`-Zuordnung,
wie bei [der lokalen HEVC-Probe](../experiments/dmabuf/README.md).

Der gepackte Testentrypoint muss bei `--gfn-armada-native-helper` zuerst
`client/native-helper.cjs` laden; die produktive `client/main.cjs`-Bootstrapdatei
übernimmt diese Auswahl automatisch. Der lokale Hardwaretest kann das
Frontend mit `GFN_ARMADA_TEST_FRONTEND_OZONE=x11` und den Helper weiterhin
unter Wayland ausführen. Die finale Portal-Probe lieferte in 30.204 Sekunden
896 Transfers/Draws/Freigaben bei 1280×720 und einen sauberen Helper-Exit.
Der anschließende SIGSEGV-Test lieferte zunächst 35 native Frames; das
Browservideo lief von 36 auf 66 Frames weiter. Danach bestand ein neuer
Helper mit 36 Transfers und vollständigem Abschluss.
Evidenz: [validation-isolated-helper-odin.json](../experiments/dmabuf/validation-isolated-helper-odin.json).
29 Unit-Tests bestehen. Die zusätzliche Farbraumdiagnose enthält nur
Range-/Matrix-/Transfer-/Primaries-Enumwerte, keine Videobytes.

### Diagnose und Helper-Abschluss, 2026-10-04

Bei Wiederaufnahme der eigenen Brücke wurde die genaue native Fehlermeldung
in den Supervisor-Snapshots als `lastNativeError` erhalten. Sie bleibt dadurch
auch nach dem allgemeinen Stopstatus und Helper-Exit verfügbar. Ein Regressionstest
prüft die Decoderablehnung nach vollständigem Helper-Abschluss.
Die doppelte synchrone Profil-Löschung im Helper-`quit`-Handler wurde entfernt:
der Supervisor besitzt das temporäre Profil und entfernt es nach Child-Exit.
Ein erster Mac-Abschluss erforderte SIGKILL; nach der Änderung bestand der
Fehlertest mit Exit 0 und weiterlaufendem Browservideo (1 → 38 Frames).
Das beweist diesen erneuten Test, keine abschließend geklärte Ursache des
vorherigen Shutdown-Hängers oder des früheren GFN-Absturzes.

Die neue separate Portal-Testinstanz `bridge-color-20261004` bestand 29/29
ARM64-Unit-Tests und einen lokalen 1280×720-H.264-Iris-Test: 148 Transfers,
Draws und Freigaben in 5,040 Sekunden, keine offenen Leases, sechs Testfarben,
Helper-Exit 0. Die Farbraumprüfung ist weiterhin streng; keine Farbraumwerte
auf Verdacht überschrieben. Das unveränderte native Modul hat SHA256
`2e663ef54f5915140d21d415e8994b036a56c23fba1a832285338c60f4a3426d`.
Die produktive GFN-Installation wurde nicht ersetzt. Die getrennte Instanz
wurde anschließend mit Zustimmung des Nutzers für den echten GFN-Test
gestartet; das Ergebnis folgt im nächsten Abschnitt.
Strukturierter Testbeleg:
[validation-helper-diagnostics-odin.json](../experiments/dmabuf/validation-helper-diagnostics-odin.json).

### Erster isolierter GFN-Stream und Pipeline-Vorbereitung

Nach Zustimmung des Nutzers wurde die vorbereitete Testinstanz gestartet.
Beim Spielstart am 2026-10-04 um 16:42:34 UTC erreichten acht komprimierte
H.264-Pakete den Supervisor. Der Tap meldete `compressed-queue-overflow`,
bevor `native-opened` eintraf. Kein DMA-BUF wurde übertragen; der Helper
beendete sich mit Exit 0. Ein späterer Snapshot zeigte im selben GFN-Client
2.301 FFmpeg-decodierte Frames und 0 Drops. Damit ist ein sauberer
Fallback dieses realen Versuchs belegt, keine Hardwareausgabe oder
Farbraumkorrektur. Die genaue Burst-/ACK-Latenz ist noch nicht gemessen.

Die einmalige GStreamer-Pipeline-Erzeugung wird jetzt im Decoder-Worker
vor `ready` ausgeführt. `pullFrame` beginnt erst nach dem ersten angenommenen
Paket. SPS/PPS-basierte Treiberkonfiguration findet weiterhin beim Streamstart
statt. Öffnen allein bestätigt keine aktive VPU. Die Queuegrenzen bleiben
acht Pakete / 4 MiB; kein unkontrolliertes Vergrößern oder stilles Frame-Dropping.
Ein langsamer Testdecoder prüft Bereitschaft nach Vorbereitung und acht
aufeinanderfolgende Pakete; ein fehlendes Backend scheitert vor Bereitschaft.

31/31 Unit-Tests auf Mac und ARM64 bestanden. Die lokale Portal-Brücke mit
dieser Vorbereitung lieferte 149 Transfers/Draws/Freigaben in 5,046 Sekunden
bei 1280×720, sechs Testfarben und Exit 0. Der Mac-Ablehnungstest bewahrte
die native Fehlermeldung, während Browservideo von 1 auf 33 Frames weiterlief.
Die neue getrennte Testinstanz `bridge-prewarm-20261004` wurde gestartet;
`native-opened` ging nachweislich der Bereitschaftsmeldung voraus. Ein
korrigierter echter Spielstream bleibt zu prüfen.
Evidenz: [validation-prewarm-odin.json](../experiments/dmabuf/validation-prewarm-odin.json).

### Tatsächlicher GFN-Farbraum und gezielte Range-Korrektur

Der nächste echte Stream erreichte die native Sample-Prüfung. Sie meldete
`range=1 matrix=3 transfer=5 primaries=1`: gemäß den
[GStreamer-Enums](https://gstreamer.freedesktop.org/documentation/video/video-color.html)
BT.709 mit vollem Wertebereich 0–255. Die bisherige Ablehnung ist damit für
diesen Stream erklärt. Der Helper beendete sich mit Exit 0; der ursprüngliche
Browserpfad decodierte weiter mit FFmpeg, ohne gemeldete Drops.
Das erklärt nicht den früheren SIGSEGV und beweist keine frühere Farbraumgleichheit.

Das Modul akzeptiert jetzt ausschließlich die bereits unterstützten BT.709-
Primaries/Matrix/Transfer mit ausdrücklich gemeldetem Limited oder Full Range
und reicht diesen Wert an
[Electron ColorSpace](https://www.electronjs.org/docs/latest/api/structures/color-space)
weiter. Keine Umrechnung oder CPU-Kopie von Rohpixeln und keine geratenen
Defaults. Der Helper meldet `negotiatedColorSpace` ohne FDs oder Bilddaten.
Ein nativer ARM64-Test prüft den echten GFN-Enumtuple sowie die Ablehnung von
unbekanntem Range, BT.601 und nicht unterstützten Transferfunktionen.

Das neue Modul wurde mit `-Wall -Wextra -Werror` gebaut; SHA256
`425dc49231bbdd88ec5c61b5730fcbe6798a41d3e8fec46a1a64c5bb9f89c378`.
31 Unit-Tests bestanden auf Mac und ARM64. H.264-Limited-Range-Regression auf
dem Portal: 150 Transfers/Draws/Freigaben, keine übrigen Leases, Exit 0.
Für den gesonderten Range-Test wurden im temporären Linux-Container zwei
äquivalente synthetische HEVC-Testmuster mit Full-/Limited-Range erzeugt,
ohne Zielpakete zu installieren. Iris → NV12-DMA-BUF → Electron lieferte
jeweils 60 Frames mit passendem Farbraum, vollständiger Freigabe und Exit 0.
21 RGB-Testpunkte unterscheiden sich um höchstens zwei Kanalstufen;
diese einmaligen Readbacks dienen nur der Farbprüfung. Temporäre Encoder-
Container und das dafür erstellte Image wurden entfernt.

Die getrennte Instanz `bridge-fullrange-20261004` läuft mit dieser Korrektur.
Der darauf gestartete **echte GFN-H.264-Stream** lieferte 621 komprimierte
Pakete an die Bridge und 610 decodierte DMA-BUF-Transfers, Renderer-Draws
und Sample-Freigaben mit vollem BT.709. Native Pipeline explizit
`v4l2h264dec`, Gerät `/dev/video0`, Name `qcom-iris-decoder`, Treiber
`/sys/bus/platform/drivers/qcom-iris`; kein Software-Fallback in der Pipeline.
Das belegt Hardware-Decoding und Electron-Übergabe im parallelen Diagnosepfad
dieses Streams. Es ersetzt den ursprünglichen Browserdecoder nicht.

Nach ungefähr zehn Sekunden wurde die komprimierte Tap-Queue erneut voll.
Der Helper schloss mit Exit 0 und null offenen Leases. Der Browserstream
lief mit FFmpeg und ohne gemeldete Drops weiter. Die aktuelle Bridge ist
dadurch ausgeschaltet; automatische Runtimefelder bleiben konservativ.
Nächster Schritt: ACK-Rundlaufzeiten und Queue-Höchststände je Stufe messen,
die begrenzte Pufferung anschließend gezielt korrigieren. Kein unkontrollierter
Queue-Ausbau oder stilles Verwerfen abhängiger Delta-Frames.
Sustained Playback, tatsächlich präsentierte Compositorframes, interne
GPU-Kopien, Decode-/End-to-End-Latenz, GFN-HEVC, CPU-Einsparung und Audio-Sync
sind damit noch nicht nachgewiesen. Kein Kernel-Queue-Trace gesammelt.
Evidenz: [validation-fullrange-odin.json](../experiments/dmabuf/validation-fullrange-odin.json).

Die neue H264-Schnittstelle kompiliert mit `-Wall -Wextra -Werror`; 24 Unit-
Tests bestehen. Nach Wiederherstellung des SSH-Zugangs bestand die lokale
H264-Brücke auf Iris auch bei 1280×720 über 30 Sekunden. WebRTC hatte die
erste Probe auf 320×180 reduziert; die zweite Probe erhält die Auflösung
über die Einstellungen des synthetischen Senders, keine NVIDIA-Parameter.
Evidenz: [validation-h264-odin.json](../experiments/dmabuf/validation-h264-odin.json).
Der Hardwarestatus eines echten GFN-Streams bleibt **unknown**.
Nach erfolgreichem GFN-Doppelpfad folgen Audio-Sync, Framezeitmessung,
Keyframe-Recovery und erst dann ein experimenteller Ersatz der Browserausgabe.

Quellen: [W3C Encoded Transform](https://www.w3.org/TR/webrtc-encoded-transform/),
[GStreamer appsrc](https://gstreamer.freedesktop.org/documentation/app/appsrc.html),
[Electron SharedTexture](https://github.com/electron/electron/blob/v44.5.1/docs/api/shared-texture.md).

### Queue-/ACK-Messung (2026-10-04)

`queueMetrics` erfasst je Stufe die aktuelle Paket-/Bytebelegung, den
Paket-Höchststand, bestätigte Pakete, die maximale ACK-Rundlaufzeit und
das Alter des ältesten offenen Pakets. Die Tap- und Preload-Zähler sind
validierte, weiterhin untrusted Beobachtungen aus dem Renderer.
Helper-Pipe und Helper-Worker messen jeweils mit ihrem lokalen monotonen
Zeitgeber. `nativePushMaxMs` misst die Dauer der nativen Annahme von
komprimierten Paketen, **keine Decode-Latenz**. ACK bedeutet Annahme,
keinen fertig decodierten oder präsentierten Frame. Die Messbereiche
überlappen; ihre Maxima dürfen nicht addiert werden.

Tap/Preload melden höchstens einmal pro Sekunde; Helper-Statistiken werden
mit den bestehenden Kontrollsnapshots übertragen. Fortschrittslogs werden
höchstens einmal pro Sekunde gespeichert, statt bei jedem wiederholten
Snapshot eines durch 30 teilbaren Framezählers. Ein Abbruch bewahrt den
letzten Queue-Snapshot vor dem Aufräumen. Tap/Preload/Helper-Worker-Werte
können wegen der Stichproben älter sein; die Pipe-/Supervisorbelegung
wird beim Stop direkt erfasst. Grenzen bleiben acht Pakete / 4 MiB;
keine Delta-Frames werden still verworfen und Originalframes werden
weitergereicht. Keine Bilddaten, FDs oder Sitzungsinformationen im Export.

32 Tests bestanden auf Mac und Portal, einschließlich verzögertem ACK,
Queue-Höchststand und vollständigem Drain. Die isolierte ARM64-Instanz
`bridge-queues-20261004` bestand den synthetischen Iris-H264-Test mit
150 Transfers/Draws/Freigaben, null offenen Leases und Exit 0.
Tap-Höchststand 3 Pakete, Tap-ACK-Maximum ca. 11,9 ms;
Helper-Pipe-Maximum ca. 7,95 ms und native Paketannahme ca. 0,37 ms.
Dies ist ein synthetischer 1280×720-Test und erklärt den bisherigen
GFN-Abbruch noch nicht. Modul und native Pipeline bleiben unverändert.
Der echte GFN-Test dieser Instrumentierung steht noch aus.

### Direkter Tap-/Preload-Port (2026-10-04)

Der folgende echte GFN-Test stoppte bereits nach acht Paketen: Tap-Belegung
8 / 44.985 Byte, keine ACKs, ältestes Paket 121,4 ms. Gleichzeitig hatte
die Helper-Pipe vier Pakete bestätigt (ACK-Maximum 7,61 ms) und vier weitere
mit höchstens 3,56 ms Alter offen. Das weist auf Verzögerung im Renderer-
Weiterleitungs-/Rückweg hin; eine exakte Aufteilung zwischen Renderer-Tasks
und IPC-Antwortzustellung ist noch nicht gemessen. Der Helper schloss mit
Exit 0; der Browser lief mit FFmpeg und null gemeldeten Drops weiter.
Veraltete Helper-Worker-Stichproben mit null Zählern sind hier kein Nachweis
fehlender nativer Arbeit.

Ein vorbereiteter MessageChannel verbindet jetzt Tap-Worker und isolierten
Preload direkt für komprimierte Pakete, Status und ACKs. Die Seite überträgt
nur beim Aufbau den Port; ihre per-Frame-window.postMessage-Weiterleitung
entfällt. Bootstrap bleibt opt-in, die Daten werden unverändert validiert,
kein privilegierter Zugriff wird für die Seite freigeschaltet. Die Preload-
IPC läuft weiterhin im Renderer und kann bei dessen Blockade verzögert
werden. Der Port allein garantiert somit keine konstante Latenz.

Der Port wird vor dem Track-Ereignis vorbereitet. Ein erster Versuch mit
asynchronem Aufbau beim Track installierte den Transform zu spät und
lieferte im lokalen Test keine Tap-Frames; dieser Versuch wurde nicht für
GFN gestartet. Der korrigierte Aufbau installiert den Transform synchron
und bestand 32 Unit-Tests auf Mac/ARM64, 147 echte lokale Iris-Transfers/
Draws/Freigaben und einen Probe-Receiver-Test mit 149 Frames. Die Testausgabe
hat sechs Farben bei 1280×720, keine übrigen Leases und Helper-Exit 0.
Künstliches Backpressure stoppt nach acht Paketen und lässt die originale
Browserausgabe weiterlaufen; worker-src-CSP-Blockade erhält ebenfalls den
Browserstream. Die acht Pakete / 4 MiB bleiben unverändert begrenzt.
Die Latenzmaxima schwanken zwischen diesen synthetischen Versuchen; daraus
wird kein Performancegewinn abgeleitet. Echter GFN-Dauertest steht aus.
Evidenz: [validation-messageport-odin.json](../experiments/dmabuf/validation-messageport-odin.json).

### Burst-Verarbeitung im Tap (2026-10-04)

Der echte GFN-Test mit direktem Port lieferte 375 H264-Transfers und
Renderer-Draws mit Full-Range-BT.709, bevor die Tap-Queue erneut acht Pakete
erreichte. Ihr ältestes Paket war diesmal nur 3,1 ms alt. Die Helper-Pipe
hatte bereits 382 von 387 Paketen bestätigt; fünf waren noch offen,
ältestes 2,62 ms. Vor dem Abbruch gemessene Maxima: Helper-Worker-ACK
5,33 ms, native Paketannahme 0,187 ms, Pipe-ACK 18,83 ms, Preload-ACK
27,2 ms, Tap-ACK 99,4 ms. Die Maxima gehören nicht zwingend zum selben
Paket. Kein nativer Fehler, Helper-Exit 0, null verbleibende Leases;
beim Stop wurden zusätzlich zwei nicht mehr übertragenen Samples
freigegeben (377 Freigaben bei 375 Transfers). Der Browser lief weiter
mit FFmpeg und null gemeldeten Drops. Das bestätigt weiterhin nur den
parallelen H264-Hardwarepfad, keinen dauerhaften Decoder-Ersatz oder HEVC.

Die schnelle Füllung passt zu einem Burst bereits verfügbarer Streamframes,
der MessagePort-ACK-Tasks verdrängt. Der Transform gibt jetzt nach dem
Weiterreichen eines Originalframes bei mindestens vier offenen Paketen
mit einem `setTimeout(0)`-Yield die Worker-Ereignisschleife frei. Er wartet
nicht auf eine ACK-Bedingung und erweitert keine Queue. Weiterhin wird
bei acht unbestätigten Paketen abgeschaltet. Das bereits weitergereichte
Originalframe bleibt unverändert; die Annahme folgender Frames kann durch
den Yield verzögert werden. `yieldCount` und `yieldMaxMs` erfassen diesen
Scheduling-Aufwand; Timerlaufzeiten sind nicht garantiert und müssen im
GFN-Dauertest bewertet werden. Ein Yield garantiert keinen ACK-Eingang.

Neue Tests führen den tatsächlich serialisierten Worker mit einem Burst
von 40 Frames und task-basierten ACKs aus: alle 40 Kopien werden akzeptiert,
Höchststand höchstens vier. Ohne ACKs werden exakt acht Kopien zugelassen;
alle 40 Originalframes bleiben identisch und in Reihenfolge. Diese
Regression prüft Worker-Scheduling, nicht Chromium- oder GFN-Timing.

34 Tests bestanden auf Mac und ARM64. Der lokale 30-Sekunden-Iris-Test mit
1280×720 lieferte 880 Transfers/Draws, 881 Sample-Freigaben inklusive eines
beim Stop nicht mehr übertragenen Frames, null offene Leases und Exit 0.
Tap-Höchststand 1, ACK-Maximum 23,3 ms: der ruhige 30-fps-Test löste keinen
Yield aus und validiert somit noch nicht dessen Verhalten bei echten
GFN-Bursts. Der Electron-Backpressure-Test bestätigte erneut die Grenze
von acht Kopien bei weiterlaufender Originalausgabe.
Evidenz: [validation-yield-odin.json](../experiments/dmabuf/validation-yield-odin.json).

### Access-Unit-Fehler getrennt erfassen (2026-10-04)

Der folgende echte GFN-Test stoppte nach drei Paketen mit
`unsupported-access-unit`, ohne einen Yield oder DMA-BUF-Transfer.
Die alte Meldung fasste leere, nicht mit Annex-B beginnende und über
2 MiB große Frames zusammen; deshalb ist die konkrete Ursache dieses
Versuchs unbekannt. Helper-Exit 0, keine Leases; der Browser streamte
weiter H264 mit FFmpeg und null gemeldeten Drops. Dieser Versuch erlaubt
keine Bewertung der Burst-Korrektur.

Die Fehler heißen nun `empty-access-unit`, `non-annexb-access-unit` oder
`oversized-access-unit`. Tap-Snapshots enthalten `accessUnitBytes` und
`annexB` (0/1), ausschließlich aggregierte Größen-/Framing-Metadaten,
keine Payloads oder Bildinhalte. Ablehnung und Queue-Grenzen bleiben
unverändert. Neue Tests provozieren alle drei Fälle und prüfen genaue
Fehlermeldung, Größe sowie Weitergabe sämtlicher Originalframes.
Es wird noch kein neues Bitstream-Format angenommen oder konvertiert.

Die separate Instanz `bridge-accessunit-20261004` bestand 37 Tests auf
Mac/ARM64 und den lokalen Iris-H264-Test mit 151 Transfers/Draws/Freigaben,
null Leases, korrektem Testmuster und Exit 0. Ein weiteres komprimiertes
Paket war beim Test-Stop noch in der Annahme; dies ist kein dekodiertes
oder präsentiertes Frame. Tap-Metadaten melden das erwartete Annex-B-
Format. Der präzise GFN-Ablehnungsgrund wird erst im nächsten Versuch
erfasst; dessen Hardwarestatus bleibt bis dahin unbestätigt.


### Direkter Worker-/Supervisor-Port (2026-10-04)

Im folgenden GFN-Test waren die Pakete gültiges Annex-B-H264. Wieder
acht offene Pakete, ältestes 122,1 ms, keine Tap-ACKs; gleichzeitig vier
Helper-Pipe-ACKs bei maximal 8,55 ms. Fünf Worker-Yields waren bereits
beendet (Maximum 0,4 ms). Das zeigt, dass bloßes Worker-Yielding die
verzögerte Renderer-/Preload-Rückleitung nicht beseitigt. Kein nativer
Transfer, Helper-Exit 0; der Browser lief mit FFmpeg und null Drops weiter.
Der vorherige `unsupported-access-unit`-Fehler wurde nicht reproduziert;
seine konkrete Ursache bleibt offen.

Die komprimierten Pakete, Tap-Status und ACKs laufen nun über einen
`MessageChannelMain` direkt zwischen Encoded-Worker und Supervisor.
Der isolierte Preload prüft beim Aufbau die GFN-Origin und leitet einmalig
den Port weiter. Main bindet ihn an das originale Hauptframe und die
Receiver-Generation; Navigation, Framewechsel, fremde Generationen,
ungültige Pakete und überfüllte Queues schalten weiterhin ab.
Ein neuer Probe-Port ist nur vor dem ersten akzeptierten Paket erlaubt.
Die bestehende Pipeline-/Sample-Isolation im separaten Helper bleibt gleich.
Das entspricht dem dokumentierten
[Electron-MessagePort-Modell](https://www.electronjs.org/docs/latest/tutorial/message-ports).

Im lokalen Electron-44.5.1-Test kamen Kontrollnachrichten an, aber ein mit
Transferliste verschobener ArrayBuffer ließ sich auf der Main-Seite nicht
als gültige Paketnachricht lesen. Komprimierte ArrayBuffers werden deshalb
per Structured Clone ohne Transferliste geschickt. Dieser Pfad bestand den
lokalen Iris-Test. Das sind Kopien komprimierter Daten, keine Rohpixelkopien;
eine Zero-Copy-Behauptung für den komprimierten Transport wäre falsch.

37 Tests bestanden auf Mac/ARM64. Lokale Iris-Ausgabe: 145 Transfers/Draws/
Freigaben, null Leases und Exit 0. Probe-Receiver-Test: 147 Transfers/Draws,
148 Freigaben einschließlich eines beim Stop nicht mehr übertragenen Samples,
null Leases, Exit 0. Backpressure stoppt weiterhin nach acht Kopien;
CSP-Blockade erhält ebenfalls das ursprüngliche Browservideo.

Die neue Regression `smoke-worker-main-port.cjs` verwendet den echten
Produktions-Preload und Supervisor mit einem ausdrücklichen Mockdecoder.
Während die Seite 300 ms per Busy-Loop blockiert war, wurden in den ersten
150 ms weitere 47 Pakete im Worker/Main-Pfad bestätigt. Damit wurde die
Unabhängigkeit dieses ACK-Pfads von der Seiten-Ereignisschleife lokal
nachgewiesen, **kein** Hardware-Decoding durch den Mock und noch keine
Stabilität des echten GFN-Streams. Sustained GFN, HEVC, CPU-Einsparung,
Compositorpräsentation und End-to-End-Latenz bleiben unbestätigt.
Evidenz: [validation-mainport-odin.json](../experiments/dmabuf/validation-mainport-odin.json).

### Burst-Staging und Resync statt Abbruch (2026-10-04)

Der echte GFN-Test mit dem direkten Worker-/Supervisor-Port lief **rund 43 Sekunden mit nativen Transfers**
und lieferte 2.584 komprimierte Pakete, 2.563 DMA-BUF-Transfers, Renderer-Draws
und Sample-Freigaben mit vollem BT.709 über `v4l2h264dec` auf `/dev/video0`.
Gegenüber den vorherigen 375 Transfers in rund zehn Sekunden ist das der
bisher längste parallele Hardwarepfad. Der Port-Umbau hat die gemessene
Renderer-Verzögerung beseitigt: Tap-ACK-Maximum 28 ms statt 99,4 ms,
Tap-Höchststand 4 statt 8, Helper-Pipe 21,8 ms, Helper-Worker 8,6 ms,
native Paketannahme 0,25 ms.

Danach stoppte die Brücke erneut mit `compressed-queue-overflow`. Das war
**kein Absturz**: Helper-Exit 0, null offene Leases, 2.564 Freigaben bei
2.563 Transfers, und der Browser streamte mit FFmpeg weiter (5.841 Frames,
null gemeldete Drops). Die Brücke hat sich selbst planmäßig abgeschaltet.

Entscheidend ist der Zustand beim Stop: Tap-Belegung 8 Pakete / 125.230 Byte,
ältestes Paket **2,8 ms** alt, 2.576 ACKs bereits zurück. Die Queue füllte
sich also in unter drei Millisekunden, während die ACK-Rundlaufzeit bei
8–28 ms liegt. In 2,8 ms kann kein Credit zurückkommen; das ist keine
Latenz- und keine Durchsatzgrenze, sondern ein Ankunftsburst von mindestens
neun Frames, der tiefer ist als das Fenster. Mit 2.563 von 2.584 Paketen
decodiert hielt die Pipeline im Mittel mühelos mit.

Das Fenster lässt sich nicht einfach vergrößern. `experiments/dmabuf/bridge.c`
startet `appsrc` mit `max-buffers=8 max-bytes=4194304`, und `pushFrame`
verweigert ab acht Puffern. Diese Grenze steckt im gepinnten `bridge.node`
und leert sich nur mit der Decodierrate. Ein größeres Fenster vor dieser
Stufe hätte den Overflow lediglich in die native Schicht verschoben, wo er
als `native-compressed-queue-overflow` den Helper beendet. Deshalb zwei
gezielte Änderungen statt einer größeren Zahl:

* **Staging im Supervisor.** Der Supervisor nimmt den Burst in eine eigene
  Queue von höchstens 64 Paketen / 4 MiB auf und bestätigt den Tap-Worker
  sofort bei Annahme, statt erst nach der nativen Runde. Er speist die
  Helper-Pipe daraus streng in Reihenfolge mit höchstens acht offenen
  Paketen. Der ACK misst damit nur noch diesen Sprung; die native Grenze
  bleibt unangetastet und das Modul unverändert.
* **Resync statt Abbruch.** Läuft das Tap-Fenster trotzdem voll, verwirft
  der Tap bis zum nächsten Keyframe mit In-Band-SPS/PPS, fordert best effort
  einen Keyframe an und nimmt dann wieder auf. `dropped` und `resyncCount`
  zählen das; `queue-overflow-resync` und `queue-resync-resumed` werden
  gemeldet. Decodieren startet ausschließlich auf einem Keyframe, nie
  mitten im GOP. Es wird kein appsrc-Flush gesendet, daher können
  `h264parse`/`v4l2h264dec` nach einer Lücke kurz gestörte Frames liefern.
  Access-Unit-Fehler, Codec-/Receiverwechsel und eine volle Staging-Queue
  bleiben unverändert Abbruchgründe.

Der `setTimeout(0)`-Yield im Tap bleibt erhalten. Die frühere Annahme, er sei
wirkungslos, ist durch diesen Lauf widerlegt: er feuerte sechsmal und die ACKs
flossen. Er konnte nur die native Rundlaufzeit nicht überbrücken — genau die
verkürzt das Staging. Ein Yield garantiert weiterhin keinen ACK-Eingang.

`queueMetrics.supervisor` meldet jetzt zusätzlich `highWater`. Seine
`pendingBytes` zählen ausschließlich noch nicht abgeschickte Pakete; bereits
an die Pipe übergebene Bytes erscheinen unter `helper-pipe`. Die Bereiche
überlappen weiterhin und dürfen nicht addiert werden.

38 Unit-Tests bestehen auf dem Mac. Zwei neue Tap-Regressionen fahren den
tatsächlich serialisierten Worker: ein unbestätigter Burst wird bei acht
Kopien begrenzt, meldet genau einen Resync samt Keyframe-Anforderung und
reicht alle 40 Originalframes unverändert und in Reihenfolge weiter; kehrt
danach Credit zurück, nimmt der Tap bei Frame 20 auf einem Parameter-Set-
Keyframe wieder auf, mit zwölf gezählten verworfenen Frames. Die neue
`smoke-supervisor-burst.cjs` nutzt produktiven Preload und Supervisor mit
ausdrücklichem Mockdecoder und schickt den Burst in einer einzigen Task,
ohne auf Credit zu warten: 24, 40 und 64 Pakete werden vollständig
angenommen, erreichen die Helper-Pipe in Reihenfolge und entleeren sich
restlos; Staging-Höchststand 16 bzw. 56. Gegen den Supervisor vor dieser
Änderung scheitert derselbe Test mit `ipc-queue-overflow` — die Regression
ist damit belegt und nicht nur behauptet. Alle sechs Mac-Varianten von
`smoke-native-bridge.cjs` bestehen weiter, einschließlich Helper-SIGSEGV-
Isolation, Decoderablehnung, Paketablehnungs- und CSP-Fallback.

Das ist ein Mock- und Transportnachweis, **kein** Hardware-Decoding und keine
belegte GFN-Stabilität. Ob die beobachteten Bursts damit tatsächlich
aufgefangen werden, muss der nächste echte GFN-Lauf zeigen; er liefert dann
statt eines Abbruchs eine Glitch-Rate aus `dropped`/`resyncCount` pro Minute.
Der ARM64-Iris-Test mit dem unveränderten Modul steht ebenfalls noch aus.
Sustained Playback, präsentierte Compositorframes, Decode-/End-to-End-Latenz,
GFN-HEVC, CPU-Einsparung und Audio-Sync bleiben unbestätigt.


Deployment des Nutzer-Fixes auf Odin (2026-10-04): Die separate Instanz
`bridge-staging-20261004` enthält die per SHA256 geprüften aktuellen Quellen
und das unveränderte Modul. 38 Unit-Tests bestehen auch unter ARM64-Electron.
Der lokale Iris-H264-Test lieferte 147 Transfers/Draws/Freigaben, null Leases,
korrektes 1280×720-Testmuster und Helper-Exit 0. Der neue Mock-Burst-Test
bestätigte alle 24 Pakete, Staging-Höchststand 16, vollständiges Drain und
Exit 0. Dieser Mock-Test belegt weiterhin keine native Burst-Toleranz.
Der korrigierte Stand ist für den nächsten echten GFN-Test bereitgestellt;
Stabilität und Glitch-Rate müssen dabei noch gemessen werden.
Evidenz: [validation-staging-odin.json](../experiments/dmabuf/validation-staging-odin.json).

### Nicht unterstützte Access-Units als Resync behandeln (2026-10-04)

Der GFN-Test des Staging-Fixes lieferte 2.457 H264-Iris-Transfers/Draws/
Freigaben und stoppte dann mit `non-annexb-access-unit`: 467 Byte, kein
Startcode an der erwarteten Position. Kein Queue-Overflow, Tap-Höchststand
3 und zuletzt 13,7 ms ACK-Maximum. Die konkrete alternative Framing-Struktur
ist weiterhin unbekannt; es wurden keine Payloads gespeichert. Der Helper
beendete sich mit Exit 0 und null Leases. Der Hauptprozess PID 186999 lebte
beim Audit noch; danach gemessene Browserstats meldeten 4.046 H264-Frames
mit FFmpeg und null Drops. Protokolliert ist somit die native Abschaltung,
kein Hauptprozess-SIGSEGV.

Der Tap behandelt nun auch leere, zu große und nicht mit dem erwarteten
Startcode beginnende Access-Units als Lücke im nativen Pfad: Originalframes
weiterreichen, betroffene native Kopie und abhängige Delta-Frames zählen
und auslassen, best effort einen Keyframe anfordern und erst bei einem
Annex-B-Keyframe mit SPS/PPS wieder aufnehmen. Kein geratenes Präfix und
keine angenommene AVCC-Konvertierung. Die erste Fehlermeldung beim Eintritt
in den Resync bleibt erhalten; wiederholte problematische Frames erzeugen
keinen Meldungsstorm. `resyncing` (0/1), `resyncCount` und `dropped` zeigen
Wartezustand und Umfang der Lücke. Bestehende Queue-Grenzen bleiben gleich.
Main behandelt diese drei Meldungen informativ und stoppt weiter bei
Codecwechsel, ungültigem Transport, voller Staging-Queue oder nativen Fehlern.

38 Tests bestehen auf Mac und ARM64. Die Worker-Regression provoziert alle
drei Formate, wartet bis Frame 20 und bestätigt anschließend die Aufnahme
auf einem Parameter-Set-Keyframe: 17 gezählte ausgelassene Kopien, sämtliche
40 Originalframes identisch und in Reihenfolge. Ein echter Electron-Port-
Test mit Mockdecoder bestätigt, dass Main nach diesen Resync-Meldungen
aktiv bleibt; 60 ACKs kamen während der ersten 150 ms einer 300-ms-Seiten-
Blockade zurück. Separater lokaler Iris-Test: 151 Transfers/Draws/Freigaben,
null Leases, Exit 0. Dieser normale lokale Stream enthält keine Lücke und
belegt deshalb keine Hardware-Recovery nach einem tatsächlichen GFN-Fehler.
Ohne einen passenden nächsten Keyframe kann das native Fenster weiter
stehen bleiben. GFN-Keyframe-Anforderung, Wartezeit, mögliche Decoder-
Artefakte ohne Flush und tatsächliche Wiederaufnahme müssen im nächsten
GFN-Test gemessen werden. HEVC und Decoder-Ersatz bleiben unbestätigt.
Evidenz: [validation-bitstream-resync-odin.json](../experiments/dmabuf/validation-bitstream-resync-odin.json).

### Echter GFN-Resync-Test erfolgreich (2026-10-04)

Der korrigierte Stand lief in der getrennten Instanz
`bridge-bitstream-resync-20261004` über **150,710 Sekunden zwischen erster
und letzter erfasster Transfermeldung**, ohne native Fehlermeldung,
Abschaltung oder Helper-Exit. Letzte Stichprobe: 9.036 H264-Iris-/NV12-DMA-BUF-
Transfers, Renderer-Draws und Sample-Freigaben, null offene Leases, volles
BT.709. Der Decoderpfad und das verifizierte Modul bleiben unverändert.

Zwei Access-Units von 909 bzw. 1.032 Byte hatten nicht den erwarteten
Startcode. Beide führten zu einer Keyframe-Wiederaufnahme, insgesamt sechs
gezählte ausgelassene native Kopien. Die Statusintervalle bis zum Resume
betrugen 47 bzw. 64 ms; das sind **keine** Decode-/Präsentationslatenzen.
Nach dem zweiten Resume wurden weitere Tausende Frames übertragen,
gezeichnet und freigegeben. `resyncing=0`, Tap-ACK-Maximum 19,3 ms,
Helper-Pipe-Maximum 11,63 ms; Queue-Grenzen blieben eingehalten.

Das belegt erstmals einen mehr als zweiminütigen parallelen GFN-H264-
Hardwarelauf **mit tatsächlich beobachteter Wiederaufnahme nach den
zuvor terminalen Framing-Ereignissen**. Es belegt keine allgemeine oder
stundenlange Stabilität und keine artefaktfreie Wiederaufnahme: der
Compositor, das sichtbare Bild und die Audio-Synchronität wurden nicht
vermessen. Die konkrete Framing-Struktur der ausgelassenen Pakete bleibt
unbekannt. Der Originaldecoder läuft weiter mit FFmpeg (letzte Stichprobe:
8.717 Frames, null gemeldete Drops), deshalb noch keine CPU-Einsparung
oder vollständiger Hardwaredecoder-Ersatz. GFN-HEVC bleibt unbestätigt.
Der Client wurde zur Sicherung dieser Stichprobe nicht beendet.
Aktualisierte Evidenz:
[validation-bitstream-resync-odin.json](../experiments/dmabuf/validation-bitstream-resync-odin.json).
