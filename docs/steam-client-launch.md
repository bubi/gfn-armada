# Launch the GFN client as a Non-Steam Game

The launcher recognizes an existing Linux Gamescope socket from
`GAMESCOPE_WAYLAND_DISPLAY` when no Wayland display is already specified.
It requires an actual socket in `XDG_RUNTIME_DIR`, preserves Steam's launch
identity/process hierarchy and respects an explicit X11 preference. It never
starts another compositor or writes Gamescope focus properties.

With `codec = "hevc"` in `~/.config/gfn-armada/config.toml`, normal client
launch enables the experimentally verified WebRTC HEVC preference. Explicit
`GFN_ARMADA_HEVC_EXPERIMENT=0` or an AV1 experiment overrides this default.
This is a client negotiation preference, not a NVIDIA UI setting. H.264 is
retained; inspect active statistics rather than assuming HEVC was selected.
Resolution/FPS/bitrate config values are still not sent as invented NVIDIA
parameters; set them through the actual GFN UI.

Add the AppImage as a Non-Steam Game in Steam, named `GFN Armada`:

- Target: absolute AppImage path, quoted if needed.
- Start directory: containing directory.
- Launch options: `GFN_ARMADA_BROWSER_IDENTITY=windows %command% --appimage-extract-and-run launch`
- Compatibility: use native execution, not Proton. This is Linux ARM64.
- Steam Game Resolution: `1920x1080`, with override for the internal display
  enabled. Odin's panel is physically portrait 1080×1920 and Gamescope rotates
  it into the landscape client area. This controls the local application area,
  not NVIDIA's stream resolution.
- In the original GFN UI: Custom / 1920×1080 / 60 FPS / 8-bit YUV 4:2:0 for the
  first verified setup. Adaptive NVIDIA behavior can still change stream size;
  confirm actual inbound dimensions in native stats.

A real Steam launch is necessary for Steam's game lifecycle, Steam Input and
Gamescope focus association. Direct SSH execution with a manually forced focus
is only a diagnostic. `runtime.json` records display bounds/scale and window
bounds alongside native stream dimensions so local and remote resolution can
be distinguished. Gamepad/Steam overlay behavior requires a user test.

On the development Odin, a Non-Steam entry can be created through the already
running Steam UI's own AddShortcut API, after backing up shortcuts.vdf. This
uses a pre-existing localhost-only Steam debugging interface over SSH; the
client does not enable or ship that interface. The ordinary VDF sync implementation
still requires Steam to be closed and makes checksummed backups. Never modify
live shortcuts.vdf behind Steam's back.
