const {test}=require('node:test'),assert=require('node:assert/strict');
const {environment,preferences}=require('../launcher/gaming-mode.cjs');
const {command}=require('../launcher/gaming-mode.cjs');
const env={GAMESCOPE_WAYLAND_DISPLAY:'gamescope-0',XDG_RUNTIME_DIR:'/run/user/1000',DISPLAY:':1',SteamAppId:'123'};
test('Steam Gamescope socket selects native Wayland and retains Steam process environment',()=>{
 let probed;const result=environment({env,platform:'linux',io:{statSync:p=>(probed=p,{isSocket:()=>true})}});
 assert.equal(probed,'/run/user/1000/gamescope-0');assert.equal(result.WAYLAND_DISPLAY,'gamescope-0');assert.equal(result.SteamAppId,'123');assert.equal(result.DISPLAY,':1');assert.equal(env.WAYLAND_DISPLAY,undefined);
});
test('nested compositor stays inside Steam launch identity and preserves client arguments',()=>{
 const input={...env,WAYLAND_DISPLAY:'gamescope-0',GFN_ARMADA_GAMESCOPE:'nested',LD_PRELOAD:'/steam/steamrtarm64/gameoverlayrenderer.so:/custom/libMangoHud.so'};
 const r=command({executable:'/app/electron',args:['--ozone-platform=wayland','launch','steam:1091500'],env:input,platform:'linux',io:{accessSync:p=>assert.equal(p,'/usr/bin/gamescope')}});
 assert.equal(r.executable,'/usr/bin/gamescope');assert.deepEqual(r.args.slice(-4),['/app/electron','--ozone-platform=wayland','launch','steam:1091500']);
 assert.equal(r.env.WAYLAND_DISPLAY,undefined);assert.equal(r.env.GAMESCOPE_WAYLAND_DISPLAY,'gamescope-0');assert.equal(r.env.SteamAppId,'123');
 assert.equal(r.env.ENABLE_GAMESCOPE_WSI,'0');assert.equal(r.env.SDL_VIDEODRIVER,'x11');assert.equal(r.env.LD_PRELOAD,'/custom/libMangoHud.so');assert.equal(input.WAYLAND_DISPLAY,'gamescope-0');
});
test('nested compositor refuses non-Steam or conflicting backend and leaves normal launches intact',()=>{
 const input={executable:'/app/electron',args:['launch'],env:{},platform:'linux'};
 assert.deepEqual(command(input),{executable:input.executable,args:input.args,env:input.env});
 for(const e of [{GFN_ARMADA_GAMESCOPE:'nested'},{...env,GFN_ARMADA_GAMESCOPE:'nested',GFN_ARMADA_OZONE:'x11'}])assert.throws(()=>command({...input,env:e}));
});
test('launcher exits with client even if another handle would keep Node alive',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-launch-lifecycle-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const fixture=path.join(root,'client');fs.writeFileSync(fixture,'#!/bin/sh\nexit 7\n',{mode:0o755});
 const cli=path.resolve(__dirname,'../launcher/cli.cjs');
 const result=spawnSync(process.execPath,['-e',`setInterval(()=>{},10000);require(${JSON.stringify(cli)}).run(['launch']);`],{env:{...process.env,XDG_CONFIG_HOME:root,XDG_DATA_HOME:root,XDG_STATE_HOME:root,GFN_ARMADA_ELECTRON:fixture,GFN_ARMADA_GAMESCOPE:'',GFN_ARMADA_OZONE:'',WAYLAND_DISPLAY:''},timeout:3000,encoding:'utf8'});
 assert.equal(result.error,undefined);assert.equal(result.status,7,result.stderr);
});
test('Gaming Mode respects existing display/explicit X11 and rejects missing or invalid sockets',()=>{
 for(const input of [{...env,WAYLAND_DISPLAY:'wayland-1'},{...env,GFN_ARMADA_OZONE:'x11'},{...env,GAMESCOPE_WAYLAND_DISPLAY:'../socket'}])assert.deepEqual(environment({env:input,platform:'linux',io:{statSync:()=>{throw Error('must not probe')}}}),input);
 assert.equal(environment({env,platform:'linux',io:{statSync:()=>({isSocket:()=>false})}}).WAYLAND_DISPLAY,undefined);
 assert.equal(environment({env,platform:'darwin'}).WAYLAND_DISPLAY,undefined);
});
test('HEVC config enables only opt-in codec preference and preserves explicit overrides',()=>{
 assert.equal(preferences({}, {codec:'hevc'}).GFN_ARMADA_HEVC_EXPERIMENT,'1');
 assert.equal(preferences({GFN_ARMADA_HEVC_EXPERIMENT:'0'}, {codec:'hevc'}).GFN_ARMADA_HEVC_EXPERIMENT,'0');
 assert.equal(preferences({GFN_ARMADA_AV1_EXPERIMENT:'1'}, {codec:'hevc'}).GFN_ARMADA_HEVC_EXPERIMENT,undefined);
 assert.deepEqual(preferences({}, {codec:'auto'}),{});
});
