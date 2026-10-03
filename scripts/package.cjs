const {packager}=require('@electron/packager');
const fs=require('node:fs');
const path=require('node:path');
async function run(){
  const output=await packager({dir:path.resolve(__dirname,'..'),out:'dist',name:'gfn-armada',platform:'linux',arch:'arm64',electronVersion:require('../package.json').devDependencies.electron,overwrite:true,asar:false,prune:true,
    download:{checksums:require('electron/checksums.json')},
    ignore:[/^\/(dist|tests|build|scripts|\.git|\.artifacts)(\/|$)/]});
  const bundle=output[0];
  fs.renameSync(path.join(bundle,'gfn-armada'),path.join(bundle,'gfn-armada-electron'));
  fs.writeFileSync(path.join(bundle,'gfn-armada'),`#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export GFN_ARMADA_ELECTRON="$base/gfn-armada-electron"
exec env ELECTRON_RUN_AS_NODE=1 "$base/gfn-armada-electron" "$base/resources/app/launcher/cli.cjs" "$@"
`,{mode:0o755});
  fs.copyFileSync(path.join(__dirname,'../package-lock.json'),path.join(bundle,'build-package-lock.json'));
  console.log(bundle);
}
run().catch(e=>{console.error(e);process.exitCode=1});
