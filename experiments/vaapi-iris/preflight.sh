#!/usr/bin/env bash
# Read-only device survey. Changes nothing, installs nothing, starts no client.
# Answers whether the libva route is even available before anything is built.
set -uo pipefail
ok=0; miss=0
say() { printf '%-34s %s\n' "$1" "$2"; }
have() { command -v "$1" >/dev/null 2>&1; }
check() { if [ "$2" = yes ]; then ok=$((ok+1)); else miss=$((miss+1)); fi; say "$1" "$2"; }

echo "=== Device ==="
say "Architecture" "$(uname -m)"
say "Kernel" "$(uname -r)"
say "Distribution" "$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"
say "SoC" "$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo unknown)"

echo
echo "=== Iris decoder ==="
node=""
for n in /dev/video*; do
  [ -e "$n" ] || continue
  name=$(cat "/sys/class/video4linux/$(basename "$n")/name" 2>/dev/null)
  drv=$(basename "$(readlink -f "/sys/class/video4linux/$(basename "$n")/device/driver" 2>/dev/null)" 2>/dev/null)
  say "$n" "name=${name:-?} driver=${drv:-?}"
  case "$drv" in *iris*) node="$n";; esac
done
check "qcom-iris node found" "$([ -n "$node" ] && echo yes || echo no)"
if [ -n "$node" ] && have v4l2-ctl; then
  echo "--- OUTPUT formats (codecs accepted by firmware) ---"
  v4l2-ctl -d "$node" --list-formats-out 2>/dev/null | grep -E "\[|Pixel" | head -20
fi
check "v4l2-ctl available (runtime requirement)" "$(have v4l2-ctl && echo yes || echo no)"

echo
echo "=== libva: the key prerequisite ==="
# Chromium loads libva dynamically. Without it, this entire path is unavailable.
libva=$(ldconfig -p 2>/dev/null | grep -m1 "libva\.so\.2" | awk '{print $NF}')
check "libva.so.2 available" "$([ -n "$libva" ] && echo yes || echo no)"
[ -n "$libva" ] && say "  Path" "$libva"
for lib in libva-drm.so.2 libdrm.so.2 libEGL.so.1 libGLESv2.so.2 libgbm.so.1; do
  p=$(ldconfig -p 2>/dev/null | grep -m1 "$lib" | awk '{print $NF}')
  check "$lib" "$([ -n "$p" ] && echo yes || echo no)"
done
say "installed VA drivers" "$(ls /usr/lib64/dri/*_drv_video.so /usr/lib/dri/*_drv_video.so 2>/dev/null | xargs -n1 basename 2>/dev/null | paste -sd' ' - || echo none)"
if have vainfo; then
  echo "--- vainfo (expected: failure until a driver is installed) ---"
  vainfo 2>&1 | head -8
else
  say "vainfo" "unavailable (diagnostics only, not required)"
fi

echo
echo "=== Build environment ==="
check "podman" "$(have podman && echo yes || echo no)"
say "free space /var/home" "$(df -h --output=avail "$HOME" 2>/dev/null | tail -1 | tr -d ' ')"
say "RAM available" "$(free -h 2>/dev/null | awk '/^Mem:/{print $7}')"

echo
echo "=== Result ==="
say "met / missing" "$ok / $miss"
if [ -z "$libva" ]; then
  echo "libva is missing: VA-API is unavailable without an additional library."
  echo "Alternatives are a Chromium source build or the WebKit experiment."
elif [ -z "$node" ]; then
  echo "No Iris node found: building the driver would serve no purpose."
else
  echo "Prerequisites met. Next step: build-driver.sh"
fi
