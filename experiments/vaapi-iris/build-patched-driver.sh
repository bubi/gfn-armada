#!/usr/bin/env bash
# New isolated ARM64 build; never replaces an existing driver or host package.
set -euo pipefail
recipe="$(cd "$(dirname "$0")" && pwd)"
root="${GFN_VAAPI_ROOT:?Set GFN_VAAPI_ROOT to a new absolute test directory}"
[[ "$root" = /* && ! -e "$root" ]] || { echo 'A new absolute build directory is required' >&2; exit 1; }
[[ "$(uname -m)" = aarch64 ]] || { echo 'Run inside Linux aarch64' >&2; exit 1; }
command -v podman >/dev/null
commit=$(python3 - "$recipe/sources.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))['commit'])
PY
)
mkdir -p "$root"
git clone --no-checkout https://github.com/phxinyang/qualcomm-iris-vaapi "$root/src"
git -C "$root/src" checkout --detach "$commit"
for patch in "$recipe"/patches/000{1,2,3}-*.patch; do
  git -C "$root/src" apply --check "$patch"
  git -C "$root/src" apply "$patch"
done
sha256sum "$recipe"/patches/000{1,2,3}-*.patch > "$root/patches.sha256"
podman run --rm -v "$root/src:/src:z" -v "$root:/out:z" -w /src registry.fedoraproject.org/fedora:44 bash -ec '
  dnf -y --setopt=fedora.metalink= \
    --setopt=fedora.baseurl=https://dl.fedoraproject.org/pub/fedora/linux/releases/44/Everything/aarch64/os/ \
    --setopt=timeout=10 --setopt=retries=2 install --setopt=install_weak_deps=False \
    meson ninja-build gcc-c++ pkgconfig python3 libva-devel libdrm-devel \
    mesa-libEGL-devel mesa-libGLES-devel mesa-libgbm-devel > /out/build-dependencies.log 2>&1
  rpm -qa | sort > /out/build-packages.txt
  meson setup build --buildtype=release --prefix=/usr -Dlibdir=lib64
  ninja -C build
  meson test -C build --print-errorlogs
  install -D build/src/v4l2_drv_video.so /out/dri/v4l2_drv_video.so
' | tee "$root/build.log"
printf '%s\n' "$commit" > "$root/source-commit.txt"
sha256sum "$root/dri/v4l2_drv_video.so" | tee "$root/driver.sha256"
# Run only with LIBVA_DRIVERS_PATH=$root/dri; this script never starts GFN.
