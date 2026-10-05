# Steam integration, snapshot 2026-10-05

For the later successful client shortcut and nested Gamescope mode, see
[Steam client launch](steam-client-launch.md). The account/per-game importer
below remains a separate validation target.

## Implemented

The Linux ARM64 client keeps the original NVIDIA web application. Steam
launches the native AppImage; Proton is unnecessary. Ordinary launch does not
start another Gamescope. Display, audio, and Steam Input settings are inherited
from the calling Gaming Mode. With `WAYLAND_DISPLAY` present, the launcher uses
Wayland. At this historical stage, process tracking, overlay, and controller
behavior for this package still required an Odin test.

Mappings support `steam:<appid>`, `epic:<id>`, `gog:<id>`, and `xbox:<id>`.
These IDs are local mapping keys, not a claimed NVIDIA API. Store editions of
the same title remain separate. A captured GFN route does not guarantee store
selection: start the correct edition when capturing and check it again during
direct launch. Store dialogs may still appear.

The VDF importer considers only entries with **both** `bookmarked: true` and
`owned: true`. Missing values mean unknown and are skipped. It creates or
updates its own Non-Steam shortcuts, retains their AppID when renamed, and
preserves unrelated shortcuts. Unknown or deselected games are not currently
deleted.

## Prepare the library

`gfn-armada library` now reads the catalog through the existing NVIDIA session.
Favorites and ownership are imported per store edition; manually confirmed
ownership is marked accordingly. The schema and public catalog were checked
live; authenticated Odin import remains untested. See [catalog import](catalog-import.md).
The following steps remain a manual alternative; ownership values are user supplied.

```sh
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run login
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run map steam:1091500 --name "Cyberpunk 2077"
```

Open the matching stream in GFN, press Ctrl+Shift+P, inspect and confirm the
route. Add `"owned": true` and `"bookmarked": true` to the saved entry only
when ownership and bookmark status are confirmed. For Epic/GOG/Xbox use the
verified store identifier instead of a Steam AppID. Do not guess NVIDIA IDs or
store identifiers. See [direct launch](direct-launch.md).

## Review and apply the import

First copy the AppImage to a stable location, for example
`~/.local/share/gfn-armada/bin/`, and make it executable. Moving it later
requires another sync so Steam launches the correct absolute path.

```sh
chmod +x ./gfn-armada-0.1.0-aarch64.AppImage
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run steam-users
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run sync --steam-user /home/armada/.local/share/Steam/userdata/YOUR_ID
# Quit Steam completely; Steam running in Gaming Mode also counts.
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run sync --steam-user /home/armada/.local/share/Steam/userdata/YOUR_ID --apply
```

Use the actual account path reported by `steam-users`. A single discovered
account is selected without `--steam-user`; multiple accounts require selection.
In the packaged client, `sync` reviews planned changes by default. Only
`--apply` writes. A development invocation without a package path still exports
mapping metadata only; `--executable /absolute/path/to/AppImage` enables a
concrete VDF plan.

An AppImage shortcut automatically uses
`--appimage-extract-and-run launch <store>:<id>`. FUSE is not required, but
temporary extraction adds startup time and requires free space. The transient
extraction path is never saved as the Steam target. Then start Steam and select
a gamepad layout for the shortcut. Import permits Steam Input/overlay but does
not automatically configure a layout or overlay shortcut. Close a separately
running GFN client before launching so Steam can track the game instance.

## Protection and restore

Before every write, the importer checks that Steam is stopped. It also checks
that source data is unchanged, locks concurrent writes of its own, creates a
unique backup with SHA256 metadata, and replaces the file atomically.
Unsupported or damaged VDF files are left untouched. Steam itself does not use
this lock; do not start Steam during sync.

The `--apply` JSON output contains the exact backup path:

```sh
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run steam-restore /ABSOLUTE/PATH/shortcuts.vdf.gfn-armada-backup-TIME-ID
```

Restore refuses to overwrite a file changed by Steam in the meantime. Backups
are retained. Tests did not modify real Steam files on the development Mac.

## Outstanding at the importer snapshot

1. Test original GFN catalog import with the signed-in Odin account:
   completeness, favorites, exact store edition, and direct launch. Missing
   ownership remains unknown; no passwords/tokens in mappings.
2. Import Grid/Cover/Hero/Logo from verified metadata with backup and preservation
   of user artwork. The current importer downloads no artwork.
3. Validate per-game AppImage launch, process exit, Steam Input, overlay access,
   and presentation under ArmadaOS/Gamescope. Later client-only launch evidence
   is documented separately.
4. At this earlier stage, the newly bundled Iris driver needed device validation.
   Its source commit and four patches matched the experiment; H.264 evidence
   came from the separately built module. See [AppImage decoder](appimage-decoder.md)
   and [current summary](project-summary-2026-10-05.md) for subsequent results.

Format reference for the conservative binary KeyValues reader:
[ValvePython/vdf](https://github.com/ValvePython/vdf/blob/master/vdf/__init__.py).
