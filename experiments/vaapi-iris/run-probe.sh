#!/usr/bin/env bash
# Measures what the client advertises with the external libva driver loaded.
# No NVIDIA session, no login, no network request: this only reads capabilities.
# An advertised codec is not proof that NVIDIA negotiates it or that the VPU
# decodes it; that needs a real stream afterwards.
set -euo pipefail
recipe="$(cd "$(dirname "$0")" && pwd)"
root="${GFN_VAAPI_ROOT:?GFN_VAAPI_ROOT auf das Build-Verzeichnis setzen}"
drivers="$root/dri"
test -f "$drivers/v4l2_drv_video.so" || { echo "Treibermodul fehlt in $drivers" >&2; exit 1; }

# The packaged client whose Electron is the acceptance target. Point this at the
# instance you want to measure; it is only read, never modified.
instance="${GFN_ARMADA_INSTANCE:?GFN_ARMADA_INSTANCE auf eine Testinstanz setzen}"
binary="$instance/runtime/gfn-armada-electron"
app="$instance/runtime/resources/app"
test -x "$binary" || { echo "Electron nicht gefunden: $binary" >&2; exit 1; }
test -f "$app/tests/probe-webrtc-codecs.cjs" || { echo 'Probe fehlt in der Instanz' >&2; exit 1; }

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
if not o: print(" keine Ausgabe"); raise SystemExit
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
run "Referenz ohne libva-Treiber" LIBVA_DRIVER_NAME= LIBVA_DRIVERS_PATH= GFN_ARMADA_PROBE_H265=1
run "mit Iris-libva-Treiber"      GFN_ARMADA_PROBE_VAAPI=1 GFN_ARMADA_PROBE_H265=1

cat <<'EOF'

Bewertung:
  video/H265 in "receive" und mediaCaps hevc.supported=true
    -> die GPU-Decoderfabrik meldet HEVC, GFN kann H.265 verhandeln.
  h264 powerEfficient springt auf true
    -> Hardware-Decode für den heute verhandelten Codec.
  Unveraendert gegenueber der Referenz
    -> der Treiber wurde nicht geladen; vainfo und LIBVA_DRIVERS_PATH prüfen.

Erst danach ein echter Stream, und dort zaehlt ausschliesslich
decoderImplementation aus getStats(), nicht diese Liste.
EOF
