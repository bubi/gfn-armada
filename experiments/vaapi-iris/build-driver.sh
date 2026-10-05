#!/usr/bin/env bash
# Builds the Iris libva driver in a throwaway Fedora container and drops the
# module into a user directory. The host image is not modified, no package is
# layered with rpm-ostree, and nothing is installed system-wide: the module is
# later selected through LIBVA_DRIVERS_PATH. Remove the directory to undo.
set -euo pipefail
recipe="$(cd "$(dirname "$0")" && pwd)"
root="${GFN_VAAPI_ROOT:-$HOME/.local/share/gfn-armada-tests/vaapi-iris-$(date +%Y%m%d)}"
commit=$(python3 -c "import json;print(json.load(open('$recipe/sources.json'))['commit'])")
upstream=$(python3 -c "import json;print(json.load(open('$recipe/sources.json'))['upstream'])")
image=fedora:44

[ "$(uname -m)" = aarch64 ] || { echo 'This driver is only useful on aarch64' >&2; exit 1; }
command -v podman >/dev/null || { echo 'podman is required' >&2; exit 1; }

mkdir -p "$root"
cd "$root"

if [ ! -d src/.git ]; then
  echo "== Fetch sources pinned to $commit =="
  git clone --no-checkout "$upstream" src
fi
git -C src fetch --all --tags --quiet
git -C src checkout --detach --quiet "$commit"
[ "$(git -C src rev-parse HEAD)" = "$commit" ] || { echo 'Commit mismatch' >&2; exit 1; }

# Record exactly what was built, in the project's usual style.
tracked=$(cd src && git ls-files -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')
echo "== Source tree SHA256: $tracked =="

echo "== Build in container ($image), host image remains unchanged =="
podman run --rm \
  -v "$root/src:/src:z" -v "$root:/out:z" \
  -w /src "$image" bash -euxc '
    dnf -y install --setopt=install_weak_deps=False \
      meson ninja-build gcc-c++ pkgconfig python3 \
      libva-devel libdrm-devel mesa-libEGL-devel mesa-libGLES-devel mesa-libgbm-devel >/dev/null
    meson setup build --buildtype=release --prefix=/usr -Dlibdir=lib64
    ninja -C build
    install -D build/src/v4l2_drv_video.so /out/dri/v4l2_drv_video.so
  '

test -f "$root/dri/v4l2_drv_video.so" || { echo 'Module was not produced' >&2; exit 1; }
sha256sum "$root/dri/v4l2_drv_video.so" | tee "$root/driver.sha256"

python3 - "$root" "$commit" "$tracked" <<'PY'
import json,pathlib,sys,subprocess
root,commit,tracked=pathlib.Path(sys.argv[1]),sys.argv[2],sys.argv[3]
mod=root/"dri/v4l2_drv_video.so"
(root/"build-info.json").write_text(json.dumps({
 "commit":commit,"trackedSha256":tracked,
 "module":str(mod),"moduleBytes":mod.stat().st_size,
 "kernel":subprocess.run(["uname","-r"],capture_output=True,text=True).stdout.strip(),
 "hostImageModified":False,"installedSystemWide":False,
 "libvaDriverName":"v4l2","libvaDriversPath":str(root/"dri"),
 "note":"Built in a throwaway Fedora container; loaded via LIBVA_DRIVERS_PATH only."
},indent=1)+"\n")
print(json.dumps({"built":True,"module":str(mod)}))
PY

cat <<EOF

Done. The module is at $root/dri/v4l2_drv_video.so
Nothing was installed system-wide. To remove: rm -rf "$root"

Next step:
  GFN_VAAPI_ROOT="$root" $recipe/run-probe.sh
EOF
