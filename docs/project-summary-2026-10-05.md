# GFN Armada – Zusammenfassung, 2026-10-05

**Unmaintained Proof of Concept.** Projektspezifischer Code, lokale Patches und
Dokumentation wurden zu 100 % durch AI erstellt, unter menschlicher Anleitung
und mit Tests am Gerät. Drittanbieter-Code stammt von den genannten Autoren
und behält deren Lizenzen. Keine Zusage für Wartung, Support oder zukünftige
Kompatibilität; kein offizieller NVIDIA-, AYN- oder ArmadaOS-Client.

## Ergebnis

Auf dem AYN Odin 2 Portal mit ArmadaOS lässt sich das ARM64-AppImage als
**Non-Steam-Game „GFN Armada“** aus Steam Gaming Mode starten. Es verwendet
weiterhin die originale GeForce-NOW-Webanwendung mit persistentem Login.
Der Nutzer bestätigt Controller-Bedienung und die korrigierte Darstellung
ohne störenden Fensterrahmen oder Verzerrung.

Der finale Lauf meldet **H.265, 1920×1080, 60 FPS und
`ExternalDecoder (VaapiVideoDecoder)`**. Im aufgezeichneten Snapshot: 9.979
decodierte Frames, sechs Browser-Drops, mittlere Chromium-Decodezeit 3,53 ms;
der GPU-Prozess hält `/dev/video0`. Das ist keine Ende-zu-Ende-Latenz und
kein kontrollierter Performancevergleich. In diesem finalen Lauf wurde kein
zusätzlicher Treiber-Completion-Trace erfasst. Die früheren HEVC-Traces belegen
separat erfolgreiche Iris-VPU-Ausgabe.

[Finale AppImage-/Steam-Evidenz](../experiments/packaging/validation-steam-client-borderless-odin-20261005.json)
· [Vorheriger Steam-HEVC-Lauf](../experiments/vaapi-iris/validation-steam-shortcut-hevc-odin-20261005.json)

## Architektur und Entscheidungen

- Electron/Chromium ARM64 lädt die originale NVIDIA-Webanwendung. Kein
  OpenNOW-Backend, eigener NVIDIA-Login oder vollständiger Chromium-Fork.
- Login-Profil: `~/.local/share/gfn-armada/chromium`; Konfiguration:
  `~/.config/gfn-armada/config.toml`; Diagnostik: `runtime.json` im State-Verzeichnis.
- Der gepatchte Iris-VA-API-Adapter verbindet Chromiums VA-API-Decoder mit
  Qualcomms **stateful Iris/V4L2**-Decoder. Mesa-GPU-Beschleunigung allein
  hätte diesen VPU-Pfad nicht hergestellt.
- Video: GFN → WebRTC → VaapiVideoDecoder → libva/Iris-Adapter → Qualcomm
  VPU → DMA-BUF/GPU-Kopie → ANGLE GL/Wayland. **Keine validierte Zero-Copy-Ausgabe.**
- Im getesteten Steam-Start läuft verschachteltes Gamescope innerhalb von
  Steams Prozessverfolgung. Sein SDL/X11-Ausgabefenster wird von Steam erkannt;
  Chromium verwendet darin Wayland. Diese zusätzliche Compositor-Stufe ist
  nicht hinsichtlich Latenz oder Energieverbrauch qualifiziert.
- Der experimentelle Decoder samt Patches, Quellen und Lizenzmaterial steckt
  im AppImage; keine systemweite Treiber- oder Kernelinstallation erforderlich.

## Quellen, Dank und lokale Treiberpatches

Besonderer Dank an **[phxinyang/qualcomm-iris-vaapi](https://github.com/phxinyang/qualcomm-iris-vaapi)**:
Der vorhandene Treiber ist die Grundlage, nicht eine Eigenentwicklung von GFN
Armada. Pin: `f587b14e6b22955c7250a45ff5f43588bbce2114`.

Die vier lokalen Patches ergänzen DRM_PRIME_2-Import, begrenzte H.264-Slice-
Diagnostik, die Erhaltung der tatsächlichen H.264-PPS-ID und eine gemeinsame
Exp-Golomb-Grenzprüfung gegen einen undefinierten 32-Bit-Shift. Alle Patches
und ihre Grenzen sind in der [README](../README.md#what-we-patched) erklärt.

Warum es anfangs nicht funktionierte:

1. Electron hatte den erforderlichen direkten Linux-V4L2-Pfad nicht eingebaut;
   es brauchte den externen VA-API-Adapter.
2. Chromiums automatische Render-Node-Suche übersah das SoC-Gerät. Der
   Launcher übergibt den vorhandenen Render-Node ausdrücklich.
3. X11/default GL verlangte einen nicht implementierten VA-ImageProcessor.
   Die gemeinsam getestete Kombination Wayland + ANGLE GL ermöglichte den Pfad.
4. Der Adapter erzeugte PPS 0, während echte GFN-Slices PPS 15 bzw. 16
   referenzierten. Der Fix übernimmt die PPS-ID aus dem Slice. Vorher: 1.475
   Submissions, null Completions; nachher erfolgreiche Iris-CAPTURE-Ausgabe.

Danke auch an aanze/geforcenow-arm64, ArmadaOS, die libva-v4l2/Bootlin-Linie,
strongtz, Electron, Chromium/WebRTC, Linux, Mesa, libva/libdrm, FFmpeg,
GStreamer, Gamescope und die weiteren Build-/Referenzprojekte. OpenNOW und
nextclient wurden als Referenzen untersucht, ihre Clientimplementierungen
werden nicht eingesetzt. Vollständige Zuordnung und Lizenzhinweise:
[README-Danksagung](../README.md#upstream-projects-and-thanks),
[THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md).

## Was getestet wurde

| Bereich | Nachweis und Einschränkung |
|---|---|
| H.264 | Originaler GFN-Stream: 14.484 erfolgreiche Iris-CAPTURE-Frames über etwa 234 s, korreliert mit Chromium-VA-API; GPU-Kopie. |
| HEVC | Originaler GFN-Stream: 7.850 Iris-GPU-Copy-Returns über etwa 131 s; anschließend Gamescope- und reguläre Steam-Tests. |
| AV1 | Originaler GFN-Stream: 16.639 Iris-Returns über etwa 278 s mit ausdrücklich aktivierten experimentellen Profilen. Nutzer beobachtet Flackern; visuelle Abnahme fehlgeschlagen. |
| Steam/AppImage | Finaler AppImage-Start unter Steams Reaper, korrekte Gamescope-AppID/Fokus, Wayland, 1920×1080-Inhaltsfläche; Nutzer bestätigt Darstellung. |
| Controller | Xbox-Controller-Erkennung und grundlegende Spiel-/UI-Bedienung beobachtet; keine vollständige Steam-Input-/Overlay-Testmatrix. |
| Builds/Tests | Finaler sauberer Code-Commit: 72/72 Linux-ARM64-Tests; AppImage-Smoke als UID 1000 einschließlich Treiberhash/dlopen, synthetischem Katalog und Steam-Backup/Restore. Lokaler Arbeitsbaum: 73 Tests, davon einer aus separaten, noch nicht veröffentlichten Bridge-Änderungen. |
| Katalog/Sync | Schema/Pagination und temporäre Steam-Dateien getestet; keine vollständige echte Konto-Bibliothek automatisch importiert und abgenommen. |

Alle Messungen gelten für die beobachteten Gerätesitzungen und Versionen,
nicht pauschal für beliebige NVIDIA-, Electron- oder ArmadaOS-Versionen.
[Codec-Erkenntnisse und Einzelbelege](codec-findings-2026-10-05.md).

## Steam starten und Spiele integrieren

Das AppImage selbst ist das Non-Steam-Ziel. Native Linux-Ausführung, **kein
Proton**. Startoptionen für den getesteten Odin-Pfad:

```text
GFN_ARMADA_GAMESCOPE=nested GFN_ARMADA_BROWSER_IDENTITY=windows %command% --appimage-extract-and-run launch
```

`codec = "hevc"` aktiviert die experimentelle WebRTC-HEVC-Präferenz;
H.264 bleibt als Fallback erhalten. Die Windows-Browseridentität ist ein
Kompatibilitätsexperiment, keine Decoder-Emulation. Ihre Notwendigkeit wurde
nicht isoliert nachgewiesen. Auflösung/FPS/Bitrate werden in der originalen
GFN-Oberfläche eingestellt; lokale Konfigurationswerte werden nicht als
erfundene NVIDIA-API-Parameter ausgegeben. Der getestete Stream ist 1080p/60.

Der Launcher verwendet echte Server-Codecangebote, keine erfundenen SDP-Codecs
oder Deep Links. `launch steam:<appid>` und entsprechende Epic/GOG/Xbox-Ziele
benötigen ein verifiziertes Mapping; unbekannte IDs schlagen sauber fehl.

`library` liest den GFN-Katalog und vorgemerkte, als besessen gemeldete
Store-Editionen. `sync` zeigt zunächst einen Plan; `sync --apply` benötigt
beendetes Steam und schreibt mit Backup. Manuell bestätigter Besitz wird
separat gekennzeichnet. Automatischer Sync bei jedem Clientstart, Artwork-
Downloads und eine vollständig abgenommene echte Bibliothek sind noch offen.
Der einzelne getestete Client-Shortcut wurde über Steams eigene UI angelegt,
mit vorherigem Backup; keine direkten Schreibzugriffe auf die laufende VDF.

[Steam-Startanleitung und Stolpersteine](steam-client-launch.md)
· [Katalog](catalog-import.md) · [Steam-Sync](steam-integration.md)

## Stolpersteine beim Steam-Test

Der erste direkte Wayland-Start lief im Hintergrund, während Steam seinen
Spinner zeigte. Eine manuell erzwungene Fokuszuordnung war nur eine Diagnose
und verursachte zeitweise Fokusverlust. Der funktionierende Pfad führt
Gamescope innerhalb von Steams Reaper/AppID-Verfolgung aus.

Ein geerbter Gamescope-WSI-Layer verursachte einen konkreten Vulkan-Swapchain-
Fehlerdialog. Im verschachtelten Modus wird er deaktiviert. Steam-Overlay-
Preloads werden für dessen Kindprozess entfernt, andere Preloads bleiben
bestehen; die Rolle des Overlays bei einem beobachteten Chromium-Startabsturz
wurde nicht vollständig isoliert. Der Launcher beendet sich jetzt mit seinem
Kindprozess, statt Steam ein scheinbar weiterlaufendes Spiel zu hinterlassen.

Steam wurde während der Fehlversuche unbedienbar. Der Webhelper-Neustart allein
reichte nicht; Neustart des vorhandenen Gaming-Mode-Dienstes stellte Steam
wieder her. Das frühere kleinere dekorierte Clientfenster wurde skaliert und
verzerrte die Ausgabe. Der finale Client startet rahmenlos mit nativer
1920×1080-Inhaltsfläche; der Nutzer hat die Korrektur bestätigt.

## Artefakt und Reproduktion

Getesteter Implementierungs-Commit: `8fb071d`; spätere Commits ergänzen
Dokumentation. AppImage-SHA256:

```text
ab6d0d9f42f6c30d09a78fbed43a5ab7af18c24490eceda7e55fdf8725fb1713
```

Entwicklung am Apple-Silicon-Mac; Zielbuild im Linux-ARM64-Container:

```sh
./scripts/bootstrap
npm test
./scripts/build-appimage
```

Electron 44.5.1 und Treiberquellen/Patches sind gepinnt. Der Workflow ist
wiederholbar; byteidentische oder komplett offline reproduzierbare Builds
sind nicht bewiesen. [Build-Dokumentation](build.md).

Die separate native Shadow-Bridge ist nicht der Default-Videopfad. Noch lokale
Bridge-/Queue-Änderungen sind nicht Bestandteil dieses sauberen AppImages oder
der hier veröffentlichten Implementierungs-Commits.

## Offen für andere Entwickler

- Langzeitstabilität, Fokus-/Suspend-/Reconnect-Verhalten und Login-Lebenszyklus.
- Steam-Overlay und passende Controller-/Overlay-Tastenbelegung.
- Echte authentifizierte Katalogübernahme und direkter Einzelspielstart für
  Steam/Epic/GOG/Xbox; gewünschter automatischer Sync mit kontrollierten Writes.
- Artwork, veraltete Shortcuts und vollständig getestete Steam-Input-Layouts.
- Saubere HEVC-Integration ohne experimentelle Identität/Präferenzhooks;
  NVIDIA-Eligibility kann sich ändern.
- AV1-Flackern/Hidden-Frame-Behandlung; AV1 bleibt experimentell.
- Zero-/Low-Copy, kontrollierte Latenz-, CPU- und Leistungsaufnahme-Messungen.
- Upstream-Meldung des Bitreader-Befunds: bisher nur Entwurf, nicht eingereicht.
- Lizenzwahl für den projektspezifischen Code und Prüfung vor Distribution.

Codec-Experimente wurden auf Wunsch des Nutzers für diesen Snapshot beendet.
Der nächste Schwerpunkt ist ein verlässlicher, schlanker GFN-Client mit
Bibliotheksintegration; die Ergebnisse stehen als Grundlage für andere bereit.
