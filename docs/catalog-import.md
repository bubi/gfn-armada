# GFN catalog and library import

Snapshot 2026-10-05. The client retains the original NVIDIA web application.
The new `gfn-armada library` command reads its catalog using the existing
signed-in session and creates validated local mappings for `sync`.

## Current source workflow (2026-10-07)

Normal client startup now imports in the background and reconciles shortcuts
through running Steam. Direct game launch skips this work. No completion dialog
or Steam restart is part of the normal source workflow. See
[startup sync and its real-device validation limits](startup-library-sync.md).
The previously published/installed AppImages still use the manual workflow
below; no replacement package was built for this change.

## Earlier packaged workflow on Odin

Close an already running GFN client first. Then:

```sh
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run library
```

GFN loads with the persistent profile. Sign in normally if required.
Once the web application makes an authenticated catalog request, the importer
uses its actual endpoint, VPC, and language. It then reads every catalog page
using a read-only GraphQL query. Only after complete success does it create a
backup and update `~/.config/gfn-armada/games.json`. The dialog reports imported
store editions, unknown ownership, and manually confirmed ownership. Closing
without a completed import makes the CLI exit with an error status.
Do not open DevTools during import: its debugger can detach observation.

Steam is unchanged by this step. Afterwards:

```sh
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run sync
# Quit Steam completely, then:
./gfn-armada-0.1.0-aarch64.AppImage --appimage-extract-and-run sync --apply
```

Then start Steam. Put the AppImage in its permanent location beforehand.
Account selection and restore are documented in [Steam integration](steam-integration.md).
Steam is not stopped automatically.

## What is imported

- `app.library.favorited === true`: bookmarked in GFN.
- `variant.gfn.library.status === PLATFORM_SYNC`: GFN reports ownership from store sync.
- `MANUAL`: ownership manually confirmed in GFN; separately marked `gfn-manual`.
- `NOT_OWNED`: do not import. Missing/unknown values remain unknown.

The filter applies **per store edition**. Owning a Steam title does not make
an unowned Epic edition eligible. Supported store names are NVIDIA's actual
values `STEAM`, `EPIC`, `GOG`, and `XBOX`. Other stores are skipped.

Each imported variant receives the stable key `gfn:<variantId>`. This ID comes
from the catalog. The original web application uses the same variant ID as
`cmsId` for its streamer and desktop shortcut. This is an observed web-client
path, not a guaranteed long-term API contract. Store dialogs, sign-in, and
availability can still interrupt launch.

A Steam AppID unambiguously parsed from NVIDIA's store URL is also saved as
an alias: `launch steam:<appid>` remains possible. Epic slugs and Xbox product
identifiers are read only from matching store domains. GOG page slugs are not
presented as numeric GOG IDs; `gfn:<variantId>` works as a local key without
inventing a store mapping.

Import preserves manually maintained metadata when merging. Previously
imported catalog mappings that are no longer selected are marked deferred;
ownership becomes unknown. Sync does not remove existing Steam shortcuts.
When migrating an earlier manually imported shortcut, its AppID is retained
so artwork and Steam Input configuration are not lost.

## Session and error handling

The importer uses Chromium's debugger to observe only requests to
`https://games.geforce.com/graphql` or `https://apps.gxn.nvidia.com/graphql`.
Guest requests are not imported as an account library. The existing `GFNJWT`
is used briefly in memory for read requests without new authentication,
hardcoding, logging, or storage in mappings. Cookies and raw response data
are not exported either. A SHA256 fingerprint of the already hashed account
context identifies local provenance; it contains no login key.

API redirects are rejected. HTTP/GraphQL errors, changed schemas, duplicate
or ambiguous IDs, and non-advancing cursors abort import. No partial library
is written. Limits: 100 pages of at most 100 games each, 180 seconds total,
and 8 MiB per response. Loss of debugger observation or closing the window
aborts the active import. No ownership/favorite mutations are sent to NVIDIA.

## Sources and validation

Primary source checked: [NVIDIA web client](https://play.geforcenow.com/mall/main.c2e839a18214e672.js),
loaded on 2026-10-05. Query definitions include `apps`, `pageInfo`,
`library.favorited`, `variants.id`, `appStore`, `storeUrl`, and library status.
Desktop-shortcut code passes the selected variant ID as `cmsId`.
This implementation does not adopt another client's streaming architecture.

The implemented query was checked live without sign-in against the official
NVIDIA endpoint: schema/pagination succeeded, four public guest games, no
eligible imports. Store definitions were also fetched directly. Tests cover
auth boundaries, store separation, unknown ownership, pagination/errors,
secret data, atomic import, and shortcut migration. The AppImage test exercises
the packaged parser with synthetic account data through the actual Steam VDF
writer and restore.

**Update 2026-10-06:** complete authenticated Odin import succeeded: 6,094
catalog applications across 61 pages, six eligible Steam editions, including
one manually confirmed ownership. Eleven bookmarked unowned editions were
excluded. Real Steam apply, idempotence, backup and byte-exact restore passed.
See [device test and sync corrections](library-sync-2026-10-06.md). Other stores
and per-game launch remain unvalidated on this account. Artwork downloads and
automatic periodic reconciliation remain open. NVIDIA has not documented this
catalog API as a stable public library API; schema changes must be checked.

NVIDIA separately documents official game-detail links:
[GFN SDK Deep Linking](https://github.com/NVIDIAGameWorks/GeForceNOW-SDK/blob/master/doc/GfnSdk-Deep-Linking.md).
These open game details and do not replace the observed variant launch.
