#!/usr/bin/env node
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {paths,loadConfig}=require('./config.cjs');
const {resolveGame,readMappings}=require('./mapping.cjs');
const help=`gfn-armada launch [<steam|epic|gog|xbox|gfn>:<id>|<mapped name>]
gfn-armada login
gfn-armada library
gfn-armada map <steam|epic|gog|xbox>:<id> --name <name>
gfn-armada diagnostics
gfn-armada config
gfn-armada sync [--steam-user <userdata/id>] [--executable <AppImage>] [--apply] [--output <review.json>]
gfn-armada steam-users
gfn-armada steam-restore <backup>

sync reviews changes by default; --apply writes backed-up shortcuts with Steam stopped.
Only mapped games with bookmarked=true and owned=true are eligible for import.
Set GFN_ARMADA_LOG=debug for runtime diagnostics. Ctrl+Shift+D opens diagnostics.`;
function parse(args) {
  const [command='launch',...rest]=args;
  if (['help','--help','-h'].includes(command)) return {command:'help'};
  if (!['launch','login','library','diagnostics','config','sync','map','steam-users','steam-restore'].includes(command)) throw new Error('Unknown command');
  if(command==='steam-restore') {if(rest.length!==1)throw new Error('steam-restore requires a backup path');return {command,backup:rest[0]};}
  if(command==='map') {
    if(rest.length!==3 || !/^(steam|epic|gog|xbox):[A-Za-z0-9._-]{1,128}$/.test(rest[0]) || rest[1]!=='--name' || !rest[2] || /[\r\n\0]/.test(rest[2])) throw new Error('map requires a store game identifier --name <name>');
    const [store,storeGameId]=rest[0].split(':');require('./mapping.cjs').gameKey({store,storeGameId});
    return {command,target:rest[0],name:rest[2]};
  }
  if (command==='launch') {if(rest.length>1) throw new Error('launch accepts one target'); return {command,target:rest[0]}}
  if (command==='sync') {
    const result={command};
    const flags={'--output':'output','--steam-user':'steamUser','--executable':'executable'};
    for(let i=0;i<rest.length;i++){
      const flag=rest[i];
      if(flag==='--apply'){if(result.apply)throw new Error('Duplicate --apply');result.apply=true;continue;}
      if(!flags[flag]||!rest[i+1]||rest[i+1].startsWith('--')||result[flags[flag]])throw new Error('Invalid sync options');
      result[flags[flag]]=rest[++i];
    }
    if(result.apply&&result.output)throw new Error('--output is for review; cannot combine with --apply');
    return result;
  }
  if(rest.length) throw new Error(`${command} takes no arguments`);
  return {command};
}
function run(args=process.argv.slice(2)) {
  const req=parse(args);
  if(req.command==='help') return console.log(help);
  if(req.command==='diagnostics') return console.log(JSON.stringify(require('./diagnostics.cjs').diagnostics(),null,2));
  if(req.command==='steam-users') return console.log(JSON.stringify(require('../steam-integration/shortcuts.cjs').users(),null,2));
  if(req.command==='steam-restore') return console.log(JSON.stringify(require('../steam-integration/shortcuts.cjs').restore(path.resolve(req.backup)),null,2));
  const config=loadConfig();
  if(req.command==='config') return console.log(JSON.stringify({path:path.join(paths().config,'config.toml'),preferences:config,applied:['hardware_decode','fullscreen','compatibility_user_agent'],streamSettings:'Set codec/resolution/fps/bitrate in the GFN UI; local preferences are not transmitted.'},null,2));
  if(req.command==='sync') {
    if(!config.steam_integration) throw new Error('Steam integration disabled in config');
    let manifest;
    const packagedExecutable=process.env.GFN_ARMADA_APPIMAGE||process.env.APPIMAGE||(process.env.GFN_ARMADA_ELECTRON?path.join(path.dirname(process.env.GFN_ARMADA_ELECTRON),'gfn-armada'):null);
    if(req.steamUser||req.executable||req.apply||packagedExecutable){
      const steam=require('../steam-integration/shortcuts.cjs');
      const executable=req.executable?path.resolve(req.executable):packagedExecutable;
      const planned=steam.plan(readMappings(),{user:req.steamUser,executable});
      manifest=req.apply?steam.apply(planned):steam.publicPlan(planned);
    }else manifest=require('../steam-integration/manifest.cjs').manifest(readMappings());
    const json=JSON.stringify(manifest,null,2)+'\n';
    if(req.output) fs.writeFileSync(req.output,json,{flag:'wx',mode:0o600}); else console.log(json);
    return;
  }
  if(req.command!=='map') resolveGame(req.command==='login'?null:req.target);
  const executable=process.env.GFN_ARMADA_ELECTRON || require('electron');
  const decoder=require('./bundled-decoder.cjs').select({hardwareDecode:config.hardware_decode});
  const env=decoder.env;delete env.ELECTRON_RUN_AS_NODE;
  if(env.GFN_ARMADA_LOG==='debug')console.error(JSON.stringify({event:'bundled-decoder',...decoder.report}));
  const appRoot=path.resolve(__dirname,'..');
  const launchArgs=[req.command,...(req.target?[req.target]:[]),...(req.name?['--name',req.name]:[])];
  const backend=ozonePlatform(env);
  const platformArgs=backend?[`--ozone-platform=${backend}`]:[];
  const child=spawn(executable,[...platformArgs,...(process.env.GFN_ARMADA_ELECTRON?launchArgs:[appRoot,...launchArgs])],{stdio:'inherit',env});
  child.on('error',e=>{console.error(e.message);process.exitCode=1});
  child.on('exit',(code,signal)=>{
    if(signal||code) console.error(JSON.stringify({timestamp:new Date().toISOString(),event:'client-exit',code,signal}));
    process.exitCode=code ?? (signal?1:0);
  });
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
}
if(require.main===module) {try{run()}catch(e){console.error(`gfn-armada: ${e.message}`);process.exitCode=1}}
function clientArgs(argv,packaged) {
  return argv.slice(packaged?1:2).filter(arg=>!['--ozone-platform=wayland','--ozone-platform=x11'].includes(arg));
}
function ozonePlatform(env=process.env,platform=process.platform) {
  if(env.GFN_ARMADA_OZONE&&!['wayland','x11'].includes(env.GFN_ARMADA_OZONE)) throw new Error('GFN_ARMADA_OZONE must be wayland or x11');
  if(platform!=='linux') return null;
  return env.GFN_ARMADA_OZONE||(env.WAYLAND_DISPLAY?'wayland':null);
}
module.exports={parse,run,clientArgs,ozonePlatform};
