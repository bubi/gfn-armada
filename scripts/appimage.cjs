// Executed in Linux ARM64, after the ordinary portable bundle build.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function run(){
  if(process.platform!=='linux'||process.arch!=='arm64') throw new Error('Build AppImage inside Linux ARM64; use scripts/build-appimage on macOS');
  const sources=require('../build/appimage-sources.json');
  const tools=path.join(root,'.artifacts/appimage-tools');fs.mkdirSync(tools,{recursive:true});
  const binaries={};
  for(const [name,spec] of Object.entries(sources).filter(([,v])=>v.url)) {
    const file=path.join(tools,name);
    if(!fs.existsSync(file)) {
      const response=await fetch(spec.url,{signal:AbortSignal.timeout(120000)});
      if(!response.ok) throw new Error(`AppImage ${name} download: ${response.status}`);
      const bytes=Buffer.from(await response.arrayBuffer());
      if(hash(bytes)!==spec.sha256) throw new Error(`AppImage ${name} checksum mismatch; do not silently update pinned inputs`);
      fs.writeFileSync(file,bytes,{mode:0o755});
    }
    if(hash(fs.readFileSync(file))!==spec.sha256) throw new Error(`AppImage ${name} cache checksum mismatch`);
    binaries[name]=file;
  }
  const bundle=path.join(root,'dist/gfn-armada-linux-arm64');
  if(!fs.existsSync(path.join(bundle,'gfn-armada-electron'))) throw new Error('Portable bundle missing; build it first');
  const appdir=path.join(root,'dist/gfn-armada.AppDir');
  fs.rmSync(appdir,{recursive:true,force:true});
  fs.mkdirSync(path.join(appdir,'usr/lib'),{recursive:true});
  fs.cpSync(bundle,path.join(appdir,'usr/lib/gfn-armada'),{recursive:true});
  fs.mkdirSync(path.join(appdir,'usr/bin'),{recursive:true});
  fs.symlinkSync('../lib/gfn-armada/gfn-armada',path.join(appdir,'usr/bin/gfn-armada'));
  fs.writeFileSync(path.join(appdir,'AppRun'),`#!/bin/sh
set -eu
base="\${APPDIR:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}"
export GFN_ARMADA_APPIMAGE="\${APPIMAGE:-}"
exec "$base/usr/lib/gfn-armada/gfn-armada" "$@"
`,{mode:0o755});
  fs.writeFileSync(path.join(appdir,'gfn-armada.desktop'),'[Desktop Entry]\nType=Application\nName=GFN Armada\nExec=gfn-armada\nIcon=gfn-armada\nCategories=Game;\nTerminal=false\n');
  fs.copyFileSync(path.join(root,'assets/gfn-armada.svg'),path.join(appdir,'gfn-armada.svg'));
  const name=`gfn-armada-${require('../package.json').version}-aarch64.AppImage`;
  const output=path.join(root,'dist',name);
  const result=spawnSync(binaries.tool,['--appimage-extract-and-run','--runtime-file',binaries.runtime,'--no-appstream',appdir,output],{
    stdio:'inherit',env:{...process.env,ARCH:'aarch64',VERSION:require('../package.json').version,SOURCE_DATE_EPOCH:'1791158400'}});
  if(result.error) throw result.error;
  if(result.status!==0) throw new Error(`AppImage builder exited ${result.status}`);
  fs.chmodSync(output,0o755);
  fs.writeFileSync(output+'.sha256',`${hash(fs.readFileSync(output))}  ${name}\n`);
  console.log(output);
}
run().catch(e=>{console.error(e.message);process.exitCode=1});
