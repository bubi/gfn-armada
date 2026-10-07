# Background library sync on client startup

Source implementation `d18046b`, 2026-10-07. No new AppImage was built or installed for
this change. The published release and the Odin's previously installed package
still use the older manual workflow.

## Intended everyday use

Open **GFN Armada** from Steam. With `steam_integration = true` (the default),
ordinary `launch` without a game target and `login` read the complete library
through the original signed-in NVIDIA web application. The GFN window opens
normally; import runs in the background without a completion dialog or closing
Steam. After successful import, bookmarked and owned editions are reconciled
with the running Steam client. Steam's own shortcut API should make new entries
visible without restarting Steam.

`launch steam:<appid>`, `launch gfn:<variant-id>`, and other mapped game targets
skip both catalog import and Steam sync. A direct game request forwarded to an
already running client cancels that client's background import/sync. No periodic
refresh occurs during a game. `map` also skips automatic sync.

`library` remains an explicit refresh command and uses the same live workflow.
Setting `steam_integration = false` disables automatic import/Steam updates;
explicit `library` can still refresh local mappings without changing Steam.
The previous `sync` review and `sync --apply` commands remain available as an
offline fallback. The latter still requires Steam to be closed.

## How running Steam is updated

`steam-integration/cef.cjs` connects exclusively to the existing local Steam
CEF debugger at `127.0.0.1:8080`. It selects Steam's library context and uses a
bounded CDP request channel. It does not enable debugging, restart Steam, install
a plugin, or open a server. Armada's inspected bootstrap source creates Steam's
`.cef-enable-remote-debugging` marker for its existing Decky integration. Other
systems may not expose this interface.

`live-runtime.cjs` runs in that Steam context. It reads live shortcut overviews
and subscribes to app details. Only details for the exact GFN executable leave
Steam. The adapter matches a verified GFN launch key and executable; it refuses
ambiguous duplicates. Existing entries retain their actual Steam AppID. New
ones use the AppID returned by `SteamClient.Apps.AddShortcut`, then wait for an
overview before setting name, executable, working directory and launch options.
Each operation is accepted only after Steam's app details reflect all desired
fields. No shortcut is removed and no controller layout is changed.

The latest live client-only shortcut supplies the allowlisted Gamescope/browser
settings and the exact Armada launcher wrapper. `shortcuts.vdf` is never edited
by this live path. Steam owns persistence and UI notification. A stale disk VDF
cannot cause the live path to create another copy of an existing entry. The
offline importer also recognizes these API-created entries without private tags
so that a later offline sync can adopt them while retaining AppIDs.

## Backups and uncertain results

Before mutations, the adapter creates private backups under
`~/.local/state/gfn-armada/steam-live-backup-*`: the current VDF snapshot, its
checksum, and the relevant live shortcut fields. A live API backup is **not**
the offline `steam-restore` format: a disk snapshot can lag Steam's memory and
must not overwrite newer Steam changes blindly.

`steam-live-sync.json` journals mutations and assigned IDs; a lock prevents
concurrent operations. If Steam disconnects after an add or does not confirm
setters, the result stays `partial`/`pending`. A subsequent startup refuses to
repeat ambiguous adds. Inspect the journal and live Steam state before clearing
an interrupted lock/journal; automatic recovery of uncertain operations remains
open. A process killed even before its first mutation can leave a stale lock.

If the library context, APIs, unique Steam account directory, or permanent
launcher path are unavailable, Steam stays untouched. The imported local library
is retained and `runtime.json` reports a pending Steam sync. There is no fallback
that edits Steam's file while it runs and no automatic Steam restart.

## Validation and provenance

[Sanitized validation record](../experiments/packaging/validation-startup-live-sync-20261007.json).

- **88 unit tests** pass in an isolated source tree excluding unrelated pending
  decoder experiments. New tests cover direct-launch exclusion, import-before-
  sync ordering, cancellation, live inventory/idempotence, retained AppIDs,
  delayed overview registration, ignored setters, lost replies, loopback-only
  transport, and adoption by the offline importer.
- A hidden **real Electron 44.5.1 / macOS ARM64** smoke test runs the complete
  startup importer and CDP transport against synthetic local GFN/Steam pages.
  HTTPS is intercepted locally; no real token or NVIDIA request is used. It
  verifies authenticated synthetic import, a visible simulated Steam shortcut,
  repeat without duplicate, and unchanged VDF. Run:
  `./node_modules/.bin/electron tests/smoke-live-library.cjs`.
- **Not yet verified on the real Odin:** Steam library context compatibility,
  live add/update visibility, persistence across a later Steam restart, and
  normal Gaming Mode startup. SSH timed out during this implementation. The
  earlier real-account offline sync evidence remains valid but does not prove
  this new live adapter.

This is independently generated PoC code using inspected interfaces. Thanks to
[armada-os/armada](https://github.com/armada-os/armada/blob/43c0cca880cefbb963d5fdc1554816ffd0a5691f/decky/armada-store/src/lib/shortcuts.ts)
for the target OS's shortcut API usage, and its
[app-details subscription](https://github.com/armada-os/armada/blob/43c0cca880cefbb963d5fdc1554816ffd0a5691f/decky/armada-control/src/lib/steamCompat.ts).
[SteamDeckHomebrew/decky-frontend-lib](https://github.com/SteamDeckHomebrew/decky-frontend-lib/blob/main/src/globals/steam-client/App.ts)
provides community-maintained interface definitions. These are internal Steam
interfaces, not a supported Valve library-management API. We also inspected
[MoonDeck's shortcut-name verification](https://github.com/FrogTheFrog/moondeck/blob/main/src/steam-utils/setShortcutName.ts);
no streaming architecture or runtime code was adopted from another GFN client.
