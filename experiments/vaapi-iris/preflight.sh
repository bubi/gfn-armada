#!/usr/bin/env bash
# Read-only device survey. Changes nothing, installs nothing, starts no client.
# Answers whether the libva route is even available before anything is built.
set -uo pipefail
ok=0; miss=0
say() { printf '%-34s %s\n' "$1" "$2"; }
have() { command -v "$1" >/dev/null 2>&1; }
check() { if [ "$2" = yes ]; then ok=$((ok+1)); else miss=$((miss+1)); fi; say "$1" "$2"; }

echo "=== Gerät ==="
say "Architektur" "$(uname -m)"
say "Kernel" "$(uname -r)"
say "Distribution" "$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"
say "SoC" "$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo unbekannt)"

echo
echo "=== Iris-Decoder ==="
node=""
for n in /dev/video*; do
  [ -e "$n" ] || continue
  name=$(cat "/sys/class/video4linux/$(basename "$n")/name" 2>/dev/null)
  drv=$(basename "$(readlink -f "/sys/class/video4linux/$(basename "$n")/device/driver" 2>/dev/null)" 2>/dev/null)
  say "$n" "name=${name:-?} driver=${drv:-?}"
  case "$drv" in *iris*) node="$n";; esac
done
check "qcom-iris-Knoten gefunden" "$([ -n "$node" ] && echo yes || echo no)"
if [ -n "$node" ] && have v4l2-ctl; then
  echo "--- OUTPUT-Formate (welche Codecs die Firmware annimmt) ---"
  v4l2-ctl -d "$node" --list-formats-out 2>/dev/null | grep -E "\[|Pixel" | head -20
fi
check "v4l2-ctl vorhanden (Laufzeitanforderung)" "$(have v4l2-ctl && echo yes || echo no)"

echo
echo "=== libva: der entscheidende Punkt ==="
# Chromium lädt libva dynamisch. Fehlt sie, ist der ganze Weg zu.
libva=$(ldconfig -p 2>/dev/null | grep -m1 "libva\.so\.2" | awk '{print $NF}')
check "libva.so.2 vorhanden" "$([ -n "$libva" ] && echo yes || echo no)"
[ -n "$libva" ] && say "  Pfad" "$libva"
for lib in libva-drm.so.2 libdrm.so.2 libEGL.so.1 libGLESv2.so.2 libgbm.so.1; do
  p=$(ldconfig -p 2>/dev/null | grep -m1 "$lib" | awk '{print $NF}')
  check "$lib" "$([ -n "$p" ] && echo yes || echo no)"
done
say "vorhandene VA-Treiber" "$(ls /usr/lib64/dri/*_drv_video.so /usr/lib/dri/*_drv_video.so 2>/dev/null | xargs -n1 basename 2>/dev/null | paste -sd' ' - || echo keine)"
if have vainfo; then
  echo "--- vainfo (erwartet: Fehler, solange kein Treiber installiert ist) ---"
  vainfo 2>&1 | head -8
else
  say "vainfo" "nicht vorhanden (nur Diagnose, nicht erforderlich)"
fi

echo
echo "=== Bauumgebung ==="
check "podman" "$(have podman && echo yes || echo no)"
say "freier Platz /var/home" "$(df -h --output=avail "$HOME" 2>/dev/null | tail -1 | tr -d ' ')"
say "RAM verfügbar" "$(free -h 2>/dev/null | awk '/^Mem:/{print $7}')"

echo
echo "=== Ergebnis ==="
say "erfüllt / fehlend" "$ok / $miss"
if [ -z "$libva" ]; then
  echo "libva fehlt: der VA-API-Weg ist ohne zusätzliche Bibliothek nicht nutzbar."
  echo "Dann bleibt nur der Chromium-Sourcebuild oder der WebKit-Versuch."
elif [ -z "$node" ]; then
  echo "Kein Iris-Knoten gefunden: Treiberbau wäre zwecklos."
else
  echo "Voraussetzungen erfüllt. Nächster Schritt: build-driver.sh"
fi
