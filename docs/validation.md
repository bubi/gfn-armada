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
| persistenter NVIDIA-Login | offen | isoliertes Testprofil, keine Anmeldung |
| Steam Gaming Mode / Controller | offen | Zielgerät nicht erreichbar |
| HEVC / AV1 auf Qualcomm VPU | unknown | kein Gerät, kein GFN-Stream |
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
