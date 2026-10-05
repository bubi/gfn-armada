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
