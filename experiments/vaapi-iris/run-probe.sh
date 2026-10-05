#!/usr/bin/env bash
# Measures what the client advertises with the external libva driver loaded.
# No NVIDIA session, no login, no network request: this only reads capabilities.
# An advertised codec is not proof that NVIDIA negotiates it or that the VPU
# decodes it; that needs a real stream afterwards.
set -euo pipefail
recipe="$(cd "$(dirname "$0")" && pwd)"
root="${GFN_VAAPI_ROOT:?Set GFN_VAAPI_ROOT to the build directory}"
drivers="$root/dri"
test -f "$drivers/v4l2_drv_video.so" || { echo "Driver module missing in $drivers" >&2; exit 1; }

# The packaged client whose Electron is the acceptance target. Point this at the
# instance you want to measure; it is only read, never modified.
instance="${GFN_ARMADA_INSTANCE:?Set GFN_ARMADA_INSTANCE to a test instance}"
binary="$instance/runtime/gfn-armada-electron"
app="$instance/runtime/resources/app"
test -x "$binary" || { echo "Electron not found: $binary" >&2; exit 1; }
test -f "$app/tests/probe-webrtc-codecs.cjs" || { echo 'Probe missing in the instance' >&2; exit 1; }

export DISPLAY="${DISPLAY:-:0}" XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export LIBVA_DRIVERS_PATH="$drivers" LIBVA_DRIVER_NAME=v4l2
unset ELECTRON_RUN_AS_NODE

run() {
  local label="$1"; shift
  local package="$app/package.json" backup
  backup=$(mktemp)
  cp "$package" "$backup"
  python3 - "$package" <<'PY'
import json,sys,pathlib
p=pathlib.Path(sys.argv[1]);d=json.loads(p.read_text())
d["main"]="tests/probe-webrtc-codecs.cjs";p.write_text(json.dumps(d))
PY
  echo "=== $label ==="
  env "$@" "$binary" --ozone-platform=x11 2>/dev/null | grep '^{' | tail -1 | python3 -c '
import sys,json
o=json.loads(sys.stdin.read() or "{}")
if not o: print(" no output"); raise SystemExit
print(" receive      :", ", ".join(o.get("receiveCodecs",[])))
print(" h265Receive  :", o.get("h265Receive"), "| av1Receive:", o.get("av1Receive"))
print(" mediaCaps    :", json.dumps(o.get("mediaCapabilities")))
print(" video_decode :", o.get("gpuFeatures",{}).get("video_decode"))
print(" libvaDriver  :", o.get("libvaDriverName"), "| switches:", " ".join(o.get("switches",[])))
' || true
  cp "$backup" "$package"; rm -f "$backup"
}

# Baseline first: the same binary without the driver, so any difference is
# attributable to the driver rather than to the switches.
run "Baseline without libva driver" LIBVA_DRIVER_NAME= LIBVA_DRIVERS_PATH= GFN_ARMADA_PROBE_H265=1
run "with Iris libva driver"      GFN_ARMADA_PROBE_VAAPI=1 GFN_ARMADA_PROBE_H265=1

cat <<'EOF'

Interpretation:
  video/H265 in "receive" and mediaCaps hevc.supported=true
    -> the GPU decoder factory advertises HEVC; GFN can negotiate H.265.
  h264 powerEfficient changes to true
    -> Hardware-decode capability for the currently negotiated codec.
  Unchanged from the baseline
    -> check driver loading, vainfo and LIBVA_DRIVERS_PATH.

Then test a real stream; there the relevant evidence is
decoderImplementation from getStats(), not this list.
EOF
