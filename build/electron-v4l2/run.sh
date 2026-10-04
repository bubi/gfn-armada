#!/usr/bin/env bash
# Only runs in an isolated source-builder container, never in the GFN runtime.
set -euo pipefail
stage="${1:?Expected sync, configure or build}"
variant="${2:?Expected h264 or hevc}"
case "$stage" in sync|configure|build) ;; *) exit 2;; esac
case "$variant" in h264|hevc) ;; *) exit 2;; esac
[ "$(uname -m)" = x86_64 ] || { echo 'Source builder requires Linux x86_64' >&2; exit 1; }
cd /checkout
# Refuse mixing two experiments in a shared patched checkout.
if [ -e .gfn-variant ] && [ "$(cat .gfn-variant)" != "$variant" ]; then
  echo 'Use a separate checkout for each codec variant' >&2; exit 1
fi
readarray -t revisions < <(python3 - <<'PY'
import json
s=json.load(open('/recipe/sources.json'))
print(s['electronCommit']); print(s['depotToolsCommit'])
PY
)
export PATH="/checkout/depot_tools:$PATH" DEPOT_TOOLS_UPDATE=0
if [ "$stage" = sync ]; then
  if [ ! -d depot_tools/.git ]; then
    git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git depot_tools
  fi
  git -C depot_tools checkout --detach "${revisions[1]}"
  [ -f .gclient ] || gclient config --name src/electron --unmanaged https://github.com/electron/electron
  # Electron DEPS hooks apply its own Chromium patches and fetch pinned tools.
  gclient sync --with_branch_heads --with_tags -r "src/electron@${revisions[0]}"
  printf '%s\n' "$variant" > .gfn-variant
  cp /builder-packages.txt builder-packages.txt
  exit 0
fi
[ -f .gfn-variant ] || { echo 'Run sync first' >&2; exit 1; }
[ "$(git -C src/electron rev-parse HEAD)" = "${revisions[0]}" ] || {
  echo 'Electron revision does not match sources.json' >&2; exit 1;
}
cd src
output="out/Gfn-v4l2-$variant"
python3 - <<'PY'
import json,pathlib
s=json.load(open('/recipe/sources.json'))
v=dict(line.split('=',1) for line in pathlib.Path('chrome/VERSION').read_text().splitlines())
assert '.'.join(v[k] for k in ('MAJOR','MINOR','BUILD','PATCH')) == s['chromiumVersion'], 'Chromium version mismatch'
PY
if [ "$stage" = configure ]; then
  # Verify recipe patches before applying. Already applied patches are accepted;
  # conflicts stop the experiment without forcing or resetting the checkout.
  python3 - <<'PY'
import hashlib,json,pathlib
s=json.load(open('/recipe/sources.json'))
for name,digest in s['patches'].items():
 assert hashlib.sha256((pathlib.Path('/recipe/patches')/name).read_bytes()).hexdigest()==digest, name
PY
  selected=(/recipe/patches/0002-*.patch)
  if [ "$variant" = hevc ]; then selected+=(/recipe/patches/0001-*.patch); fi
  for patch in "${selected[@]}"; do
    if git apply --reverse --check "$patch" 2>/dev/null; then
      echo "Already applied: $(basename "$patch")"
    else
      git apply --check "$patch"
      git apply "$patch"
    fi
  done
  python3 build/linux/sysroot_scripts/install-sysroot.py --arch=arm64
  mkdir -p "$output"
  cp "/recipe/$variant.gn" "$output/args.gn"
  export CHROMIUM_BUILDTOOLS_PATH="$PWD/buildtools"
  gn gen "$output" --fail-on-unused-args
  gn args "$output" --list --short > "$output/resolved-args.txt"
  git diff --binary > "$output/chromium-local.patch"
  cp /recipe/sources.json "$output/gfn-sources.json"
  gclient revinfo --actual > "$output/dependency-revisions.txt"
  exit 0
fi
[ -f "$output/build.ninja" ] || { echo 'Run configure first' >&2; exit 1; }
export CHROMIUM_BUILDTOOLS_PATH="$PWD/buildtools" NINJA_SUMMARIZE_BUILD=1
autoninja -C "$output" -j "${GFN_BUILD_JOBS:-4}" electron:electron_dist_zip
[ -f "$output/dist.zip" ] || { echo 'Expected dist.zip missing' >&2; exit 1; }
sha256sum "$output/dist.zip" > "$output/dist.zip.sha256"
echo "Built experimental $variant runtime: /checkout/src/$output/dist.zip"
echo 'Hardware decoding remains unverified until device tests pass.'
