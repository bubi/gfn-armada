# Validierungsstand 2026-10-04

| Prüfung | Ergebnis | Aussagegrenze |
|---|---|---|
| `npm test` | 14/14 bestanden | Launcher, Mapping, Backup, Config, Manifest und Runtime-Argumente; keine Gerätefunktion |
| JS-Syntaxprüfung Main/Preload | bestanden | kein Ersatz für Streamingtests |
| echter Electron-Start auf Apple Silicon | bestanden | macOS ARM64, nicht Armada |
| offizielle GFN-Hauptseite | im Smoke-Test geladen | kein Login und kein Spielstream |
| Renderer-Sicherheit | sandbox=true, contextIsolation=true, nodeIntegration=false geprüft | keine umfassende Sicherheitsprüfung |
| Preload → Main-World → IPC | Codec-/Controller-Report empfangen | kein aktiver Peer-/Hardwaredecoder-Nachweis |
| Linux-ARM64-Paketierung auf macOS | bestanden | Linux-Binary nicht auf dem Mac ausführbar |
| `file` des gepackten Runtime-Binary | ELF 64-bit ARM aarch64 | kein Linux-Laufzeittest |
| Linux-ARM64-Containerbau und Export | am 2026-10-04 bestanden; 14/14 Tests im Container | kein Armada-GUI-/Decoder-Test |
| NVIDIA-Login und Wiederverwendung des Profils | Gerätetest bestanden | Apple-Passwortlogin durch Nutzer; Profil beim Backend-Neustart wiederverwendet |
| Controller | Spiel erkennt Xbox-Controller; Standard-Gamepad gemeldet | GFN-Overlay-Shortcut noch zu testen |
| Steam Gaming Mode | offen | Spieltest in KDE unter XWayland |
| GFN-Spielstream unter XWayland | Gerätetest bestanden | H.264, 19.334 Frames, 0 gemeldete Drops; Decoder unknown |
| HEVC auf Qualcomm VPU | synthetischer 720p-Test bestanden | GStreamer Iris / DMA-BUF, kein GFN-Stream |
| AV1 auf Qualcomm VPU | unknown | Element vorhanden, kein Decodiertest |
| Electron auf ArmadaOS | startet und lädt GFN | H.265 fehlt im WebRTC-Angebot; Login/Stream offen |
| DMA-BUF / Low-Copy | unknown | Import-/Queue-/Compositor-Nachweis fehlt |

Am 2026-10-04 wurde das bereits installierte OrbStack gestartet. Docker 28.5.2
meldet `aarch64`. `./scripts/build` baute mit der gepinnten Linux-ARM64-
Containerbasis und exportierte das Bundle unter dem normalen macOS-Benutzer.
Das anfängliche Exportproblem wurde behoben: Packager-Ausgaben müssen vor dem
Export für den unprivilegierten Benutzer lesbar sein (`chmod -R a+rX dist`).
Die exportierte Runtime wurde als ELF für ARM aarch64 geprüft; der exportierte
Clientquellcode stimmt mit dem Repository überein. Docker Desktop wurde nicht
zusätzlich installiert. Dies ersetzt weiterhin keinen Test auf ArmadaOS.

Der echte macOS-Test vom 2026-10-03 verwendete Electron 44.5.1 / Chromium 152.0.7977.130 /
Node 24.21.0. Der Renderer meldete unter anderem H264, H265 und AV1 in den
WebRTC-Empfangsfähigkeiten. Das ist **ausschließlich ein macOS-Browserangebot**,
keine NVIDIA-Verhandlung und keine Fähigkeit des Linux-ARM64-Pakets.
Ein nichtfataler macOS-Sandbox-Resource-Warnhinweis erschien; Seite und Telemetrie
wurden trotzdem erfolgreich geladen. Die Sandbox blieb eingeschaltet.

Das Smoke-Profil liegt lokal unter `.artifacts/smoke`, getrennt von produktiven
GFN-Daten. `.artifacts` und Build-Ausgaben werden nicht committed. Kein Steam-
Profil wurde verändert. Kein Login, Passwort oder Auth-Token wurde hinterlegt.

Optionaler Smoke-Test bei installierter nativer Electron-Runtime:

```sh
XDG_CONFIG_HOME="$PWD/.artifacts/smoke/config" \
XDG_DATA_HOME="$PWD/.artifacts/smoke/data" \
XDG_STATE_HOME="$PWD/.artifacts/smoke/state" \
./node_modules/.bin/electron tests/smoke-runtime.cjs
```

Das Script beendet Electron nach Seitenladung und empfangener Telemetrie,
spätestens nach 45 Sekunden mit Fehler. Es ist wegen GUI-/Netzwerkzugriff nicht
Teil der Unit-Tests. Beim ersten Start lädt Electron seine native Runtime nach.

Gerätetest und Reproduktion: [odin-device-validation.md](odin-device-validation.md).
Nach Wayland- und Apple-Login-Korrektur bestehen lokal 17/17 Tests; der zuvor gebaute
Container lief mit 14 Tests. Das installierte Testbundle enthält die Korrektur,
das ursprüngliche Releasearchiv noch nicht.

Die anschließende Decoder-Untersuchung ergänzt Prozess-/Geräte-FD-Proben und
optionale native CDP-Media-Metadaten. 20/20 lokale Tests bestehen. Der neue
macOS-Electron-Smoke-Test mit Media-Diagnostik bestätigt zunächst Seitenladung
und Telemetrie, scheitert aber an sauberer Beendigung; nach Korrektur der
GPU-Update-Rückkopplung überschreitet ein weiterer Versuch das Startzeitlimit.
Die neue GUI-Diagnostik ist damit noch nicht vollständig validiert.
Diese Ergänzungen sind noch nicht auf das derzeit per SSH unerreichbare Portal
übertragen. Die konkrete GFN-Decoderinstanz bleibt deshalb unbestätigt.
Quellbefunde: [electron-decoder-investigation.md](electron-decoder-investigation.md).
