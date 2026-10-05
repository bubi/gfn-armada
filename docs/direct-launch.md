# Direct Game Launch

GFN application identifiers are not Steam AppIDs. No mapping is guessed.
The inspected [gfn-electron main.js](https://github.com/hmlendea/gfn-electron/blob/10af7432ff3097a58973496a3f266e294582b483/scripts/main.js)
contains a route with `launchSource=GeForceNOW` and `cmsId` in the fragment
under `https://play.geforcenow.com/mall/`. This is upstream evidence, not a
stable official NVIDIA deep-link contract. Store selection, login, and
confirmation dialogs may still require user interaction.

Capture in the client:

```sh
gfn-armada map steam:1091500 --name "Cyberpunk 2077"
```

Start the desired title in GFN using the correct store. Ctrl+Shift+P captures
the current streamer URL, asks for confirmation of the explicit store
identifier/title pair, and saves only after confirmation. An existing mapping
is backed up before atomic replacement. Use `gfn-armada login` for initial
sign-in. Ctrl+Shift+I opens developer tools if needed. Do not save tokens or
session parameters. A suitable record is:

```json
[
  {
    "steamAppId": "1091500",
    "name": "Cyberpunk 2077",
    "launchURL": "ACTUAL_CAPTURED_GFN_STREAMER_URL_HERE"
  }
]
```

The placeholder is deliberately **not** executable. Save it under
`~/.config/gfn-armada/games.json`; the CLI accepts only the observed route on
the official origin and the two parameters above.

```sh
gfn-armada launch steam:1091500
gfn-armada sync --output shortcuts-review.json
```

Steam: add a Non-Steam Game, choose the absolute bundle wrapper as executable,
the bundle directory as start directory, and `launch steam:1091500` as launch
options. Set Steam Input to a gamepad layout. Close an already running client
before the Steam test: subsequent launches currently reuse the same instance;
Steam cannot reliably track the short-lived second launcher. Steam/FEX runs a
native ARM64 shell/Electron program here; the per-game path needs Gaming Mode
validation. For the subsequently tested client shortcut, see
[Steam client launch](steam-client-launch.md).

Unknown IDs produce a clear error. If the GFN route changes, open the main
client with `gfn-armada launch`, find the title manually in GFN, and update the
mapping. Unattended login or guaranteed one-click launch is not implemented.
Search through changing DOM structures has deliberately not been automated.

Mappings also support `epic:<id>`, `gog:<id>`, and `xbox:<id>`.
The packaged client can import real Steam shortcuts through guarded
`sync --apply`; backup and restore are implemented. Confirmed bookmark/ownership
values and a captured or catalog-derived launch route are required.
`gfn-armada library` can read these from the original NVIDIA session; the
authenticated device test remains outstanding. Artwork remains open.
Workflow: [catalog import](catalog-import.md) and [Steam integration](steam-integration.md).
