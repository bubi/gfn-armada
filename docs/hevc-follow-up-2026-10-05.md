# HEVC follow-up — 2026-10-05

## What we know

- The current original GFN session negotiates **H.264**; the user reports no H.265 option in its settings.
- The same runtime reports `video/H265` in browser receive capabilities. Earlier runs without the working VA-API configuration did not. Advertising a codec is not proof of successful WebRTC negotiation or decoded pictures.
- Local synthetic HEVC was decoded with GStreamer/Iris, separately from Chromium. The adapter contains HEVC Main/Main10 translation; neither fact establishes a working original GFN HEVC stream.
- The working launcher requests `WebRtcAllowH265Receive` alongside VA-API flags. Setting local `codec = "hevc"` does not set a NVIDIA preference.
- NVIDIA’s [codec selection documentation](https://nvidia.custhelp.com/app/answers/detail/a_id/5824), updated 2026-05-18 and checked 2026-10-05, says codec availability depends on device, OS, browser, stream settings and server availability. Its table specifies **8-bit color quality for H.265 on browsers**. This is a concrete eligibility check, not proof that our Linux ARM64 wrapper is supported.

## Next measurements

1. Run the rebuilt client with native Chromium statistics enabled. Establish active codec, decoder implementation, resolution/FPS, drops and decode timings for H.264 first. Keep the GPU sandbox enabled and the shadow bridge off.
2. Check the original GFN UI’s color quality is 8-bit, and record its resolution/FPS/HDR settings and codec availability. Change settings through NVIDIA’s actual UI only; preserve the observed working setup for a fallback.
3. If H.265 becomes available, start a new session and require all three observations: native `video/H265`, a native platform decoder, and successful Iris CAPTURE completions for an HEVC session. Inspect errors/copies separately.
4. If it remains absent, inspect only sanitized capability/profile and codec-policy results to distinguish rejected browser decoder profiles from NVIDIA eligibility. Do not infer a universal Linux ban or implement speculative server parameters.

No HEVC negotiation forcing, NVIDIA parameter invention, Chromium fork or new codec patch has been implemented in this follow-up. No GFN HEVC success is claimed. The current statistics AppImage is prepared on-device; switching requires ending the user’s active game connection.

## Device and original-client source findings

The user’s photographs confirm **1920×1080, 60 FPS, 8-bit YUV 4:2:0**. H.265 and AV1 are explicitly grouped under **Unsupported**, rather than merely absent. Account-visible photographs are not redistributed.

The separate [same-runtime capability probe](../experiments/packaging/validation-hevc-capabilities-odin-20261005.json) reports H.265 receive support and `supported=true`, `powerEfficient=true`, `smooth=true` for `MediaCapabilities.decodingInfo` with `type=webrtc`, 1920×1080/60 and 31,104,000 bit/s. These values match the query shape/default dimensions and bitrate calculation inspected in GFN’s public SDK. This probe does not use a GFN account, submit HEVC payloads or reproduce its runtime cache. Its legacy GPU-profile list was empty; that field is not a reliable HEVC-negotiation proof.

The original public SDK in [vendor.bd4cfdbaa17b8f28.js](https://play.geforcenow.com/mall/vendor.bd4cfdbaa17b8f28.js) (SHA256 `03c086a94f9fb815852d47ade25b18a60bab4881095ce7d957869c94552e61ca`) contains a separate H.265 eligibility predicate:

- Prefer an explicit SDK override or remote `enableH265Support` configuration; otherwise its default platform branch includes selected TV/headset/platform targets, **not ordinary Linux browsers**.
- Apply resolution/FPS rules and check WebRTC receive capabilities.
- Require the WebRTC MediaCapabilities power-efficiency result, with certain TV exceptions.

Thus H.265 in `RTCRtpReceiver.getCapabilities` alone cannot make the UI select it. The default platform branch is consistent with this Linux client’s observed Unsupported state, but the active session’s remote flags, SDK overrides and cached results were not read: **the exact active rejection branch is not yet proven**. No eligibility flags, platform identity or server codec preferences were modified. The next useful observation is the original client’s actual eligibility inputs, rather than another speculative decoder flag.

The new [native-statistics live test](../experiments/packaging/validation-native-stats-live-odin-20261005.json) identifies the active H.264 decoder as `ExternalDecoder (VaapiVideoDecoder)` alongside successful Iris CAPTURE traces. Native dimensions changed from an earlier 1920×1080 sample to 1680×1050 in the later snapshot; averages from those samples are not a fixed-resolution benchmark.

## Explicit user-authorized identity experiment

The user requested User-Agent/platform emulation. `GFN_ARMADA_BROWSER_IDENTITY` now accepts `windows`, `macos`, `chromeos` or `linux`; absent means unchanged default. Session UA and official GFN main-world navigator identity are aligned, including low/high entropy hints. Existing matching HTTP hints are replaced on `play.geforcenow.com`; other origins and workers are not given complete hint emulation. CPU architecture hints remain actual, GPU/WebRTC/MediaCapabilities remain untouched. This does not override NVIDIA’s `enableH265Support`, its GPU allowlist or server policy.

The preload uses Electron’s experimental synchronous [contextBridge.executeInMainWorld](https://www.electronjs.org/docs/latest/api/context-bridge) to apply page identity before website scripts. A real sandboxed Electron synthetic-origin test verifies first-script Windows identity, hints and no exposed Node API. The client records page match/failure observations; a requested mode alone is not proof that the site recognized that platform. The active game is left intact until the prepared test client is authorized to replace it.
