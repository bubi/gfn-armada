# Steam-Integration, Stand 2026-10-05

## Umgesetzt

Der Linux-ARM64-Client bleibt bei der originalen NVIDIA-Webanwendung. Steam
startet das native AppImage; Proton ist dafür nicht nötig. Es wird kein zweiter
Gamescope gestartet. Display-, Audio- und Steam-Input-Umgebung werden vom
aufrufenden Gaming Mode übernommen. Bei vorhandenem `WAYLAND_DISPLAY` verwendet
der Launcher Wayland. Ob Steam/FEX dabei den Prozess, Overlay und Controller
korrekt verfolgt, muss mit diesem Paket noch am Odin getestet werden.

Mappings unterstützen `steam:<appid>`, `epic:<id>`, `gog:<id>` und `xbox:<id>`.
Diese IDs sind lokale Zuordnungsschlüssel, keine behauptete NVIDIA-API.
Store-Versionen desselben Titels bleiben getrennt. Eine erfasste GFN-Route
enthält keine gesicherte Store-Auswahl: beim Erfassen die korrekte Version starten
und beim späteren Direktstart erneut prüfen. Store-Dialoge können weiter erscheinen.

Der VDF-Importer berücksichtigt ausschließlich Einträge mit **beiden** Werten
`bookmarked: true` und `owned: true`. Fehlende Werte bedeuten unbekannt und
werden übersprungen. Er erstellt oder aktualisiert eigene Non-Steam-Shortcuts,
erhält deren AppID beim Umbenennen und lässt fremde Shortcuts unverändert.
Unbekannte oder nicht mehr ausgewählte Spiele werden derzeit nicht gelöscht.

## Bibliothek vorbereiten

`gfn-armada library` liest inzwischen den Katalog mit der bestehenden NVIDIA-
Sitzung. Favoriten und Besitz werden pro Store-Version übernommen; manuell
bestätigter Besitz wird entsprechend gekennzeichnet. Schema und öffentlicher
Katalog sind live geprüft; der authentifizierte Odin-Import ist noch ungetestet.
Siehe [Katalogimport](catalog-import.md). Die folgenden Schritte bleiben als
manuelle Alternative; deren Besitzwerte sind Benutzerangaben.

```sh
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run login
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run map steam:1091500 --name "Cyberpunk 2077"
```

Den passenden Stream in GFN öffnen, Ctrl+Shift+P drücken und die Route nach
Prüfung bestätigen. Im gespeicherten Eintrag bei bestätigtem Besitz und
Lesezeichen `"owned": true` und `"bookmarked": true` ergänzen. Für Epic/GOG/Xbox
den geprüften Store-Identifier statt einer Steam-AppID verwenden. Keine
NVIDIA-IDs oder Store-Identifier erraten. Siehe [Direktstart](direct-launch.md).

## Import prüfen und anwenden

Das AppImage zuerst an einen festen Ort kopieren, zum Beispiel
`~/.local/share/gfn-armada/bin/`, und ausführbar machen. Eine spätere Verschiebung
erfordert erneutes Sync, damit Steam den richtigen absoluten Pfad startet.

```sh
chmod +x ./gfn-armada-0.1.0-aarch64.AppImage
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run steam-users
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run sync --steam-user /home/armada/.local/share/Steam/userdata/DEINE_ID
# Steam vollständig beenden; ein laufender Gaming Mode mit Steam zählt mit.
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run sync --steam-user /home/armada/.local/share/Steam/userdata/DEINE_ID --apply
```

Den tatsächlichen Accountpfad aus `steam-users` übernehmen. Genau ein gefundener
Account wird ohne `--steam-user` ausgewählt; bei mehreren wird eine Auswahl
verlangt. `sync` im paketierten Client prüft standardmäßig die geplanten Änderungen.
Nur `--apply` schreibt. Im Entwicklungsaufruf ohne Paketpfad exportiert `sync`
weiterhin nur Mapping-Metadaten; `--executable /absoluter/Pfad/zum/AppImage`
aktiviert den konkreten VDF-Plan.

Der AppImage-Shortcut verwendet automatisch
`--appimage-extract-and-run launch <store>:<id>`. Damit ist FUSE für den Start
nicht erforderlich; das temporäre Entpacken kostet Startzeit und freien Platz.
Es wird niemals der flüchtige Entpackpfad als Steam-Ziel gespeichert.
Steam anschließend starten und ein Gamepad-Layout für den Shortcut wählen.
Der Import erlaubt Steam Input/Overlay, konfiguriert aber kein Layout oder
Overlay-Tastenkürzel automatisch. Vor dem Spielstart einen bereits separat
laufenden GFN-Client schließen, damit Steam die Spielinstanz verfolgen kann.

## Schutz und Wiederherstellung

Vor jedem Schreibvorgang prüft der Importer, dass Steam beendet ist. Er prüft
außerdem unveränderte Quelldaten, sperrt parallele eigene Schreibvorgänge,
erstellt ein eindeutiges Backup samt SHA256-Metadaten und ersetzt die Datei atomar.
Nicht unterstützte oder beschädigte VDF-Dateien werden nicht verändert.
Die Sperre wird von Steam selbst nicht verwendet; Steam während Sync nicht starten.

Die JSON-Ausgabe von `--apply` enthält den genauen Backup-Pfad:

```sh
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run steam-restore /ABSOLUTER/PFAD/shortcuts.vdf.gfn-armada-backup-ZEIT-ID
```

Restore verweigert das Überschreiben, wenn Steam die Datei inzwischen verändert
hat. Backups bleiben erhalten. Keine realen Steam-Dateien auf dem Entwicklungs-Mac
wurden für die Tests verändert.

## Noch offen

1. Den implementierten Original-GFN-Katalogimport mit dem angemeldeten Odin-
   Konto prüfen: Vollständigkeit, Favoriten, konkrete Store-Version und Direktstart.
   Fehlender Besitzstatus bleibt unbekannt; keine Passwort-/Token-Speicherung im Mapping.
2. Grid/Cover/Hero/Logo anhand geprüfter Metadaten importieren, mit Backup und
   Erhalt eigener Benutzerbilder. Der aktuelle Importer lädt kein Artwork.
3. AppImage-Direktstart, Prozessende, Steam Input, Overlay-Zugang und Bildausgabe
   unter ArmadaOS/Gamescope am Gerät testen.
4. Den neu gebauten, im AppImage enthaltenen Iris-VA-API-Treiber am Gerät testen.
   Quellcommit und alle vier Patches entsprechen dem experimentellen Stand.
   H.264-Hardwaredecode wurde mit dem früher separat gebauten Modul belegt;
   HEVC, Bildprüfung und Zero-Copy bleiben offen. Aktivierung und Abschaltung:
   [AppImage-Decoder](appimage-decoder.md).

Formatreferenz für den konservativen binären KeyValues-Reader:
[ValvePython/vdf](https://github.com/ValvePython/vdf/blob/master/vdf/__init__.py).
