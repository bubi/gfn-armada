# GFN-Katalog und Bibliotheksimport

Stand 2026-10-05. Der Client bleibt die originale NVIDIA-Webanwendung. Der neue
Befehl `gfn-armada library` liest ihren Katalog mit der bereits angemeldeten
Sitzung und erzeugt die geprüften lokalen Mappings für `sync`.

## Ablauf auf dem Odin

Einen bereits laufenden GFN-Client zuerst schließen. Dann:

```sh
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run library
```

GFN lädt mit dem persistenten Profil. Falls erforderlich normal anmelden.
Sobald die Webanwendung eine authentifizierte Kataloganfrage stellt, übernimmt
der Importer deren tatsächlichen Endpoint, VPC und Sprache. Er liest danach
alle Katalogseiten mit einer reinen GraphQL-Leseabfrage. Erst nach vollständigem
Erfolg schreibt er ein Backup und aktualisiert `~/.config/gfn-armada/games.json`.
Der Dialog zeigt importierte Store-Versionen, unbekannten Besitz und manuell
bestätigten Besitz. Bei Abbruch ohne fertigen Import endet die CLI mit Fehlerstatus.
Währenddessen keine DevTools öffnen: deren Debugger kann die Beobachtung trennen.

Steam wird dabei nicht verändert. Anschließend:

```sh
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run sync
# Steam vollständig schließen, dann:
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run sync --apply
```

Danach Steam starten. Das AppImage vorher an seinen festen Speicherort legen.
Accountauswahl und Wiederherstellung sind in [Steam-Integration](steam-integration.md)
beschrieben. Eine automatische Steam-Beendigung wird nicht durchgeführt.

## Was importiert wird

- `app.library.favorited === true`: in GFN vorgemerkt.
- `variant.gfn.library.status === PLATFORM_SYNC`: Besitz von GFN über Store-Sync gemeldet.
- `MANUAL`: in GFN manuell bestätigter Besitz; separat als `gfn-manual` gekennzeichnet.
- `NOT_OWNED`: nicht importieren. Fehlende/unbekannte Werte bleiben unbekannt.

Der Filter wird **pro Store-Version** angewandt. Ein besessener Steam-Titel
macht eine nicht besessene Epic-Version nicht importfähig. Unterstützte
Store-Bezeichnungen sind die direkt von NVIDIA gelieferten Werte `STEAM`,
`EPIC`, `GOG` und `XBOX`. Andere Stores werden übersprungen.

Jede importierte Variante erhält den stabilen Schlüssel `gfn:<variantId>`.
Diese ID stammt aus dem Katalog. Die originale Webanwendung benutzt dieselbe
Varianten-ID als `cmsId` für ihren Streamer und Desktop-Shortcut. Das ist ein
beobachteter Webclientpfad, keine Garantie eines langfristigen API-Vertrags.
Store-Dialoge, Anmeldung und Verfügbarkeit können weiterhin den Start unterbrechen.

Eine aus der NVIDIA-Store-URL eindeutig gelesene Steam-AppID wird zusätzlich
als Alias gespeichert: `launch steam:<appid>` bleibt möglich. Epic-Slugs und
Xbox-Produktkennungen werden nur von passenden Store-Domains gelesen. GOG-
Seitenslugs werden nicht als numerische GOG-ID ausgegeben; `gfn:<variantId>`
funktioniert als lokaler Schlüssel ohne erfundene Store-Zuordnung.

Der Import erhält manuell gepflegte Metadaten beim Zusammenführen. Nicht mehr
ausgewählte frühere Katalogmappings werden als zurückgestellt markiert; ihr
Besitz wird unbekannt. Bestehende Steam-Shortcuts werden beim Sync nicht entfernt.
Beim Umstellen eines früher manuell importierten Shortcuts bleibt dessen AppID
erhalten, damit Bilder und Steam-Input-Konfiguration nicht verloren gehen.

## Sitzung und Fehlerverhalten

Der Importer beobachtet mit Chromiums Debugger ausschließlich Anfragen an
`https://games.geforce.com/graphql` oder `https://apps.gxn.nvidia.com/graphql`.
Gastanfragen werden nicht als Konto-Bibliothek importiert. Das vorhandene
`GFNJWT` wird kurzzeitig im Speicher für die Leseanfragen verwendet, ohne
neue Authentifizierung, Hardcoding, Protokollierung oder Speicherung in Mappings.
Auch Cookies und unverarbeitete Antwortdaten werden nicht exportiert.
Ein SHA256-Fingerabdruck des bereits gehashten Konto-Kontexts kennzeichnet die
lokale Datenherkunft; er enthält keinen Anmeldeschlüssel.

Weiterleitungen der API-Anfrage werden abgelehnt. HTTP-/GraphQL-Fehler,
veränderte Schemas, doppelte/mehrdeutige IDs und nicht fortschreitende Cursor
brechen den Import ab. Keine halbe Bibliothek wird geschrieben. Grenzen:
100 Seiten mit je höchstens 100 Spielen, 180 Sekunden Gesamtzeit und 8 MiB
pro Antwort. Bei Verlust der Debugger-Beobachtung oder Schließen des Fensters
wird der laufende Import abgebrochen. Es werden keine Besitz-/Favoriten-
Mutationen an NVIDIA gesendet.

## Quellen und Validierung

Primär geprüft: [NVIDIA-Webclient](https://play.geforcenow.com/mall/main.c2e839a18214e672.js),
geladen am 2026-10-05. Seine Query-Definitionen enthalten `apps`, `pageInfo`,
`library.favorited`, `variants.id`, `appStore`, `storeUrl` und den Bibliotheksstatus.
Der Code für Desktop-Shortcuts übergibt die ausgewählte Varianten-ID als `cmsId`.
Die Implementierung übernimmt keine fremde Client- oder Streamingarchitektur.

Die implementierte Abfrage wurde live ohne Anmeldung am offiziellen NVIDIA-
Endpoint geprüft: Schema/Pagination erfolgreich, vier öffentliche Gastspiele,
keine importfähigen Spiele. Die Store-Definitionen wurden ebenfalls direkt
abgerufen. Tests prüfen Auth-Grenzen, Store-Trennung, unbekannten Besitz,
Pagination/Fehler, geheime Daten, atomaren Import und Shortcut-Migration.
Der AppImage-Test prüft den paketierten Parser mit synthetischen Kontodaten
bis zum echten Steam-VDF-Writer und Restore.

**Noch nicht nachgewiesen:** vollständiger Import aus dem echten angemeldeten
Odin-Konto. Der Odin ist aktuell nicht erreichbar. Es wird kein erfolgreicher
Kontoimport behauptet. Artwork-Downloads und ein automatischer periodischer
Abgleich bleiben offen. NVIDIA hat diese Katalog-API nicht als öffentliche
stabile Bibliotheks-API dokumentiert; Schemaänderungen müssen geprüft werden.

NVIDIA dokumentiert separat offizielle Spiel-Detail-Links:
[GFN SDK Deep Linking](https://github.com/NVIDIAGameWorks/GeForceNOW-SDK/blob/master/doc/GfnSdk-Deep-Linking.md).
Diese öffnen Spiel-Details und ersetzen nicht den hier beobachteten Variantenstart.
