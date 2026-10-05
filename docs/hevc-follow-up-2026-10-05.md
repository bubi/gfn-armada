# HEVC follow-up — 2026-10-05

## First original GFN HEVC hardware stream verified

The opt-in negotiation experiment succeeded on 2026-10-05. The
[live evidence](../experiments/packaging/validation-hevc-live-odin-20261005.json)
records native Chromium `video/H265`, `ExternalDecoder (VaapiVideoDecoder)`,
7,638 decoded browser frames and 7,850 Iris `publish=copy-gpu` returns over a
130.73-second trace span. The client GPU process holds `/dev/video0`, named
`qcom-iris-decoder`; driver session openings explicitly name HEVC. GPU sandbox
remains enabled. No matches for the six listed decoder/ioctl error indicators.

The real server offer includes H.264, AV1 and H.265; the WebRTC preference hook
runs and the answer places H.265 first. **No `request-preferred` event was
observed:** success does not prove the CloudMatch body hook ran or was needed.
No original SDK eligibility flag was changed. Windows identity was also active;
its independent necessity has not been tested. Do not infer that the original
UI now exposes HEVC, or make the option default on this evidence alone.

Native dimensions change from 1920×1080 to 1680×1050 at 60 FPS. Iris coded buffer
sizes are 1920×1088 and 1696×1056. Snapshot mean decode time is 3.73 ms, with
67 browser drops and 54 driver drop publications; counts have different scopes.
This is a short live hardware-path validation, not a fixed-resolution comparison,
end-to-end latency measurement, pixel correctness check or long-term test.
Output remains GPU-copy, not validated zero-copy. Gamescope/AV1 remain untested.

The following sections retain the investigation sequence and earlier limitations;
the earlier statements of no GFN HEVC stream describe the pre-experiment state.

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

The [Windows identity AppImage](../experiments/packaging/validation-browser-identity-odin-20261005.json) passed **62/62** clean-source tests on both macOS and Linux ARM64 and the existing ARM64 container smoke. It was started on Odin after native statistics showed no active stream. The actual GFN page reported matching emulated UA, navigator platform and hint platform, with no shim failure; native statistics await a stream, Iris selected and GPU sandbox enabled. GFN’s internal platform classification remains unknown. The user subsequently reports that H.265 is still unavailable in the UI despite matching emulated identity. Emulation is user-authorized, opt-in and can be removed by omitting the environment variable.

## OpenNOW comparison

The [pinned native and legacy Electron source comparison](opennow-evaluation.md#hevc-verhandlung-vergleich-vom-2026-10-05) finds an important distinction: legacy Electron OpenNOW owns CloudMatch codec selection and WebRTC signaling; current Qt OpenNOW selects the codec via native NVST/RTSP. Neither is merely the original website with another User-Agent. No codec forcing or OpenNOW runtime was introduced by this research.

## Narrow negotiation experiment

`GFN_ARMADA_HEVC_EXPERIMENT=1` enables a synchronous main-world preload hook.
It changes only string-body POST `/v2/session` on HTTPS NVIDIA grid/GFN domains,
with the observed `sessionRequestData`, `GSStreamerType=WebRTC`, existing numeric
codec field, 1920×1080/60 monitor settings and 8-bit 4:2:0 SDR. It sets the existing
CloudMatch codec field to 2. Fetch Request-only bodies and other request shapes
are left untouched; skipped/missing coverage must not be reported as success.
Resume and login requests are not modified. It does not change service headers,
platform metadata, NVIDIA eligibility flags or decoder capabilities.

For a real remote offer containing H.265, it orders real receiver capabilities
H.265 first and H.264 second before createAnswer, retaining other codecs and
auxiliary entries. It never adds payloads to SDP or changes HEVC level/tier.
The original web UI may continue to say Unsupported. Server request rejection
is possible; omit the environment variable to return to the validated H.264 path.
No automatic session retry is implemented. A codec request or an answer containing
H.265 is not proof of an active HEVC stream; require native stats and Iris evidence.

Runtime `hevcExperiment.events` records a bounded allowlist of event names,
codec names and numeric preferences, without request bodies, URLs or raw SDP.
Main treats page observations as untrusted. Existing Chromium stats remain the
independent active-codec observation. Worker-originated requests are not hooked.
Three unit tests cover request scope/preservation, capability/profile exclusions,
XHR and offer-dependent preferences. A real sandboxed Electron synthetic-origin
smoke confirms installation, existing identity and absence of page Node access.

## Separate AV1 experiment

After the verified HEVC stream, the user requested an AV1 test.
`GFN_ARMADA_AV1_EXPERIMENT=1` selects AV1 in the same opt-in hook, taking
precedence over the HEVC experiment flag. Real receiver capabilities are ordered
AV1, HEVC, H.264, then other/auxiliary codecs; the matched CloudMatch field uses
3. No fabricated SDP payloads. Runtime `hevcExperiment.preferred` distinguishes
AV1 from HEVC for compatibility with the existing diagnostic channel.

The pinned Iris adapter does not normally advertise AV1. Its upstream
[README](https://github.com/phxinyang/qualcomm-iris-vaapi/blob/f587b14e6b22955c7250a45ff5f43588bbce2114/README.md)
documents VA timeouts for hidden AV1 frames, which produce no CAPTURE buffer.
A device qualification run explicitly sets `V4L2_VA_EXPERIMENTAL_PROFILES=1`;
this is never set by the ordinary launcher. This upstream opt-in exposes an
implemented but unqualified profile, not a validated capability. The old probe
reported AV1 decodable but not power-efficient. Success, software fallback and
VA/V4L2 failure must therefore be distinguished in live statistics/traces.
Retain the verified HEVC AppImage for recovery; AV1 has no success claim yet.


## First original GFN AV1 hardware stream verified

The subsequent [AV1 live test](../experiments/packaging/validation-av1-live-odin-20261005.json)
records `video/AV1`, `ExternalDecoder (VaapiVideoDecoder)`, 16,452 browser-decoded
frames and 16,639 Iris `publish=copy-gpu` returns over a 278.163-second trace.
The GFN overlay also says AV1. Iris session opens identify FourCC `AV01` at
1920×1080 and 1680×1050; the client GPU process holds `qcom-iris-decoder`.
The sandbox remains enabled. No inspected decoder/ioctl error markers or
actual sync timeout events; the reported Iris timeout counters are zero.
An initial broad timeout-word search matched configuration/counter fields,
not an actual timeout, and was corrected before recording the final result.

The offer includes H.264/AV1/H.265, and the AV1 WebRTC preference hook runs;
again no CloudMatch request rewrite was observed. The isolated earlier AV1
`powerEfficient=false` probe used the default, non-advertised AV1 driver profile.
This live run explicitly enables upstream experimental profiles and reports
`powerEfficientDecoder=true` alongside actual VPU frame returns. Do not treat
that change as proof that the default client supports hardware AV1.

Native decode mean is 2.76 ms at the last snapshot (1080p/60), with 50 browser
drops and 45 driver-drop returns across differing counter scopes. Resolution
changed during the run. These figures cannot establish AV1 superiority over
HEVC/H.264 or end-to-end latency. Long-term stability, hidden-frame coverage,
pixel accuracy, zero-copy and Gamescope remain open. No decoder/source patch
was needed for this AV1 trial; existing adapter opt-in and codec preference
were sufficient for the observed stream. Keep AV1 experimental.


### AV1 visual limitation reported by user

The user reports intermittent picture flicker in the AV1 run. Hardware frames
are established, but visual acceptance fails; do not describe AV1 as reliably
playable. Later trace counters are 16,890 GPU-copy publications and 45 drops,
without actual sync-timeout markers. The observer subsequently reports stale
statistics; that alone does not establish whether the stream or client crashed.

Three AV01 session opens reflect 1920×1080 → 1680×1050 → 1920×1080. These switches
are candidates for discontinuities, not a proven explanation for flicker.
The pinned translator defers each AV1 picture until its successor and reconstructs
reference refresh information; vaEndPicture resolves the previously held surface.
Incorrect reference/surface association or presentation is another candidate,
requiring a fixed-resolution reproducer and comparison of VPU output before
presentation. No speculative decoder patch or automatic restart applied.
Retain HEVC as the better-supported fallback; AV1 remains a diagnostic option.


## Gamescope HEVC output and research conclusion

The [Gamescope live run](../experiments/packaging/validation-gamescope-hevc-live-odin-20261005.json)
records native H.265 / VA-API at 1920×1080/60, 8,540 browser-decoded frames,
6 browser drops, mean decode 2.93 ms, 8,631 Iris GPU-copy publications and one
driver drop over ~144 seconds. Inspected decoder/ioctl/sync-timeout markers
are zero. User confirms GFN and MangoHud visible and working game after startup;
focus oscillated and picture froze before game launch. This used a temporary
scope/root-focus diagnostic, not a Steam library launch. Do not ship that
workaround as normal integration. Original focus is backed up and restoration
on client exit configured.

At the user's request, codec experimentation is concluded here. The
[consolidated handover](codec-findings-2026-10-05.md) is intended for others to
implement a correct, qualified codec path. Next project work concerns the client
and reliable Steam/Gamescope launch association.
