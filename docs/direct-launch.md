# Direct Game Launch

GFN-Appkennungen sind nicht Steam-AppIDs. Keine Zuordnung wird geraten.
Im untersuchten [gfn-electron main.js](https://github.com/hmlendea/gfn-electron/blob/10af7432ff3097a58973496a3f266e294582b483/scripts/main.js)
findet sich eine Route mit `launchSource=GeForceNOW` und `cmsId` im Fragment
unter `https://play.geforcenow.com/mall/`. Das ist ein Upstream-Beleg, kein
stabiler offizieller NVIDIA-Deep-Link-Vertrag. Store-Auswahl, Login und mögliche
Bestätigungsdialoge können dennoch Benutzerinteraktion verlangen.

Erfassung im Client:

```sh
gfn-armada map steam:1091500 --name "Cyberpunk 2077"
```

In GFN den gewünschten Titel mit dem
korrekten Store starten. Ctrl+Shift+P erfasst die aktuell geöffnete Streamer-URL, fragt mit dem expliziten
Store-Identifier-/Titelpaar nach und speichert nur nach Bestätigung. Ein vorhandenes
Mapping erhält vor dem atomaren Ersetzen ein Backup. Für die erste Anmeldung
kann `gfn-armada login` verwendet werden. Ctrl+Shift+I öffnet bei Bedarf die
Entwicklertools. Keine Tokens/Sessionparameter speichern. Ein passender Datensatz ist:

```json
[
  {
    "steamAppId": "1091500",
    "name": "Cyberpunk 2077",
    "launchURL": "HIER_DIE_TATSAECHLICH_ERFASSTE_GFN_STREAMER_URL"
  }
]
```

Das Platzhalterbeispiel ist absichtlich **nicht** ausführbar. Speichern unter
`~/.config/gfn-armada/games.json`; die CLI akzeptiert nur die beobachtete
Route auf der offiziellen Origin und die beiden oben genannten Parameter.

```sh
gfn-armada launch steam:1091500
gfn-armada sync --output shortcuts-review.json
```

Steam: Non-Steam-Game hinzufügen, absolute Bundle-Wrapper-Datei als Executable,
Bundleverzeichnis als Startverzeichnis, Launch Options `launch steam:1091500`.
Steam Input auf ein Gamepad-Layout setzen. Vor dem Steam-Test einen bereits
laufenden Client schließen: weitere Starts verwenden derzeit dieselbe Instanz;
Steam kann den kurzlebigen zweiten Launcher sonst nicht zuverlässig verfolgen. Steam/FEX startet hier ein natives
ARM64-Shell-/Electron-Programm; dies muss im Gaming Mode verifiziert werden.

Unbekannte ID: klarer Fehler. Geänderte GFN-Route: Hauptclient mit
`gfn-armada launch` öffnen, Titel manuell in GFN suchen und Zuordnung erneuern.
Ein unbeaufsichtigter Login oder garantierter Ein-Klick-Start ist nicht vorhanden.
Die Suche über wechselnde DOM-Strukturen wurde bewusst noch nicht automatisiert.

Mappings unterstützen außerdem `epic:<id>`, `gog:<id>` und `xbox:<id>`.
Der paketierte Client kann mit `sync --apply` echte Steam-Shortcuts kontrolliert
importieren; Backups und Restore sind umgesetzt. Voraussetzung sind bestätigte
Lesezeichen-/Besitzwerte und eine erfasste oder katalogbasierte Start-Route.
`gfn-armada library` kann diese Daten aus der originalen NVIDIA-Sitzung einlesen;
der authentifizierte Gerätetest steht aus. Artwork bleibt offen.
Ablauf: [Katalogimport](catalog-import.md) und [Steam-Integration](steam-integration.md).
