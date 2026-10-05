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
- Launch options for the tested nested mode: `GFN_ARMADA_GAMESCOPE=nested GFN_ARMADA_BROWSER_IDENTITY=windows %command% --appimage-extract-and-run launch`
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

## Odin Gaming Mode focus workaround

On the 2026-10-05 Odin test, direct native Wayland launch from the real Steam
shortcut left Steam's loading interface in front. The client was alive and
loaded GFN, but Gamescope remained focused on Steam (AppID 769). That is a
failed visible launch, not evidence of a working Steam integration.

The tested alternative runs a nested Gamescope **inside** Steam's tracked
launch process. Its SDL/X11 output gives Steam a tracked game window, while
Chromium continues to use native Wayland inside the nested compositor.
The user confirmed the GFN UI was visible and controller navigation worked.
The first test still showed window decorations and a scaled smaller client
area; the subsequent client change starts fullscreen launches borderless at
the primary display size. The user subsequently confirmed correct display without the disturbing frame or distortion in the final AppImage.

For the AppImage itself as the Steam target, use:

```text
GFN_ARMADA_GAMESCOPE=nested GFN_ARMADA_BROWSER_IDENTITY=windows %command% --appimage-extract-and-run launch
```

The launcher calls `/usr/bin/gamescope` with a 1920×1080 game/output area,
`--expose-wayland`, and fullscreen. It remains under Steam's reaper, disables
the inherited Gamescope Vulkan WSI layer for the nested process and removes
only `gameoverlayrenderer.so` preload entries. Other preload hooks are kept.
The WSI layer caused a confirmed swapchain error dialog in the earlier test.
A Chromium zygote crash and stranded launcher were also observed; the role
of Steam's injected overlay has not been isolated. The launcher now exits
when its child closes, with a regression test for retained Node handles.

This mode is explicit and requires an existing Linux Steam launch. It adds
a compositor stage; no zero-copy or latency improvement is claimed.
Direct native Wayland remains the ordinary desktop default. The temporary
device shell wrapper used to validate the approach is replaced by the
AppImage launcher implementation. No forced root focus properties are used.
Steam overlay, focus stability during gameplay, actual HEVC selection and
1080p stream dimensions require direct measurement, not inference from display size.

The final AppImage startup from commit `8fb071d` is now measured: Steam reaper
→ AppImage/launcher → nested Gamescope → Chromium; Gamescope focused AppID
4274819213 and Chromium reported a 1920×1080 content area. Window outer bounds
include compositor extents, so content bounds are the relevant geometry.
HEVC preference and the bundled Iris adapter were selected. The user confirmed
correct display without disturbing frame/distortion. The final running stream
also reports H.265 / VaapiVideoDecoder / 1920×1080 at 60 FPS, with the GPU
process holding `/dev/video0`; no driver completion trace was captured. [Startup evidence](../experiments/packaging/validation-steam-client-borderless-odin-20261005.json).
The preceding tracked-wrapper stream is [recorded separately](../experiments/vaapi-iris/validation-steam-shortcut-hevc-odin-20261005.json):
H.265, 1920×1080/60, 10,299 native decoded frames, 7 drops, VaapiVideoDecoder,
with `/dev/video0` open in the GPU process. It contains no driver completion
trace and does not establish improved latency or zero-copy presentation.

During failed launch experiments Steam's UI became unresponsive. Restarting
only its webhelper did not recover it; restarting the existing
`gamescope-session-plus@steam.service` restored the Gaming Mode session.
Do not run unrestricted source enumeration/evaluation in Steam's UI context;
use bounded, specific API calls. The recovery preserved the GFN profile and
the shortcut, and no device reboot or Steam database rewrite was needed.
