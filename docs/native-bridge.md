# Experimentelle Brücke für den originalen GFN-Webclient

Implementierter Anschluss, noch kein validierter GFN-Hardwarestream:

```text
GFN RTCRtpReceiver → RTCRtpScriptTransform (unveränderte Frames weiterreichen)
                         ↓ Kopie der komprimierten H264-Access-Units
sandboxed Preload → begrenztes IPC → Node-Worker → GStreamer appsrc
  → h264parse → v4l2h264dec → appsink → NV12 DMA-BUF
  → Electron SharedTexture → sandboxed Diagnose-Canvas
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
GFN_ARMADA_OZONE=wayland \
GFN_ARMADA_NATIVE_SHADOW=1 \
GFN_ARMADA_NATIVE_BRIDGE="$HOME/.local/share/gfn-armada/native/bridge.node" \
GFN_ARMADA_LOG=debug gfn-armada launch steam:1091500
```

Der absolute Modulpfad muss existieren und das neue `openStream`-/`pushFrame`-
API enthalten. Ohne `GFN_ARMADA_NATIVE_SHADOW=1` wird kein natives Modul
geladen und kein Transform eingesetzt. Die normale GFN-Sitzung bleibt im
bisherigen Profil. Login vor dem experimentellen Streamtest erledigen.

Natives Wayland ist der bisher bestätigte Electron-DMA-BUF-Ausgabepfad.
Original-GFN plus neue H264-Brücke unter Wayland ist **noch nicht geprüft**;
frühere Stabilitätsprobleme des GFN-Clients unter Wayland bleiben relevant.
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
  zusammen höchstens 4 MiB, separat in Worker, Preload und Main begrenzt.
  Bestätigungen enthalten die Sequenz; unbekannte Bestätigungen geben keine
  zusätzlichen Credits frei.
  Native appsrc maximal acht Frames / 4 MiB, Appsink zwei Frames, höchstens
  vier ausstehende DMA-BUF-Leases im Worker. Bei Overflow den Diagnosepfad
  stoppen; keine Delta-Frames unbemerkt verwerfen und trotzdem Erfolg melden.
* GStreamer-Aufrufe und Decoder-Close laufen im Node-Worker. Main importiert
  nur die FDs. Der Sample-Lease bleibt im Worker bis zur prozessübergreifenden
  `allReferencesReleased`-Bestätigung. Es werden komprimierte Bytes kopiert,
  keine Rohpixel im Addon gemappt.
* Paketablehnung oder native Decoder-/Importfehler deaktivieren die Kopie,
  während der Encoded-Worker die Originalframes weiterreicht. Ein Worker-
  Absturz **nach** erfolgreicher Anbindung ist ein eigener, noch nicht
  getesteter Fehlerfall: Transform entfernen, Fehler melden; ein erneuter
  GFN-Spielstart kann nötig sein. Nicht mit dem geprüften CSP-Preflight verwechseln.
* Vollständige Dokumentnavigation, Empfängergenerationwechsel, Schließen
  des Diagnosefensters und Fehler stoppen die Brücke. Zum neuen Experiment
  den Client neu starten. Kein automatischer Restart-Loop.

Farbraum/Import zunächst auf lineares NV12 und begrenztes BT.709 beschränkt.
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
