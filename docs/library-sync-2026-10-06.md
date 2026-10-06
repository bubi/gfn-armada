# Authenticated library sync on Odin — 2026-10-06

The original signed-in NVIDIA web application imported the real account library
on the Odin 2 Portal. Complete pagination read 6,094 catalog applications across
61 pages. Six bookmarked, owned Steam editions were eligible; one used GFN's
manually confirmed ownership status. Eleven bookmarked but unowned editions
were excluded. Unknown ownership count was zero. No tokens, cookies, raw account
responses, or game names are included in the published evidence.

## Corrections found during the test

Steam's actual binary KeyValues file used `AppName` and `Exe`. Our field lookup
was case-sensitive. It now handles case-insensitive field names while retaining
their original spelling, and refuses duplicate fields differing only by case.
Regression tests simulate Steam rewriting generated field names and verify
idempotence and retained AppIDs after a rename.

The original generated game shortcuts omitted the working client shortcut's
Gamescope and browser identity settings. Sync now inherits a small allowlist of
compatibility assignments from a client-only shortcut pointing to the exact
same executable. On this Odin the resulting launch options are:

```text
GFN_ARMADA_GAMESCOPE=nested GFN_ARMADA_BROWSER_IDENTITY=windows %command% --appimage-extract-and-run launch gfn:<catalog-variant-id>
```

Arbitrary shell commands, extra arguments, or settings from another executable
are not inherited. Conflicting templates are rejected. With no matching client
shortcut, sync does not invent Gamescope settings. The persisted client config
still controls the experimental HEVC preference; sync does not configure the
remote stream's resolution or frame rate.

## Device validation

The authenticated importer ran from the existing `v0.1.0-poc` AppImage. To test
the correction independently of unrelated decoder development, we extracted
that exact AppImage and replaced only `binary-vdf.cjs` and `shortcuts.cjs` in an
isolated CLI. Generated shortcuts target the permanent installed AppImage.

- Review left Steam files unchanged. Applying while Steam was running refused
  the write.
- With the user's permission, Steam was stopped for the write. A checksum-backed
  backup was created, six game shortcuts were added, and the original client
  shortcut was preserved.
- A second apply produced no changes and did not rewrite the file.
- Restore reproduced the original file byte for byte. A final apply retained
  the six games; Steam was restarted successfully.
- A bounded read of Steam's Big Picture DOM found two visible imported GFN game
  labels after restart. The VDF contains six managed games and seven total
  shortcuts. This does not establish that all six games have been launched.
- Nineteen targeted catalog/Steam tests passed on the development Mac.

See [sanitized evidence](../experiments/packaging/validation-library-sync-odin-20261006.json).
The published `v0.1.0-poc` download predates these two sync corrections.

## Remaining limits

Epic, GOG, and Xbox filtering/mapping have automated coverage but no real-account
device import in this test. Per-game launch, store sign-in dialogs, and Steam
Input need a separate end-to-end check. Artwork downloads, automatic controller
layouts, removal of deselected games, and periodic reconciliation remain open.
`library` imports mappings; `sync` reviews; `sync --apply` writes only while Steam
is closed. Ordinary client startup does not silently modify Steam files.
