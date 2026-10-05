const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {parse}=require('../launcher/cli.cjs');
const {loadConfig,paths}=require('../launcher/config.cjs');
const {validatedURL,resolveGame,readMappings,HOME,saveMapping}=require('../launcher/mapping.cjs');
const {manifest}=require('../steam-integration/manifest.cjs');
// Synthetic identifier only; this is not a production GFN mapping.
const row={steamAppId:'1091500',name:'Synthetic test game',launchURL:'https://play.geforcenow.com/mall/#/streamer?launchSource=GeForceNOW&cmsId=123'};
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-armada-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir}
test('launcher parses supported commands',()=>{
 assert.deepEqual(parse(['launch','steam:1091500']),{command:'launch',target:'steam:1091500'});
 for(const cmd of ['login','diagnostics','config']) assert.equal(parse([cmd]).command,cmd);
 assert.equal(parse([]).command,'launch');
 assert.equal(parse(['sync','--output','file.json']).output,'file.json');
});
test('launcher rejects unsupported parameters',()=>{
 for(const args of [['bad'],['login','x'],['launch','a','b'],['sync','--bad'],['diagnostics','--yes']]) assert.throws(()=>parse(args));
});
test('missing game never resolves to an invented link',()=>assert.throws(()=>resolveGame('steam:1091500',[]),/No unique verified mapping/));
test('mapped Steam ID and case-insensitive name resolve exactly',()=>{
 assert.equal(resolveGame('steam:1091500',[row]).url,row.launchURL);
 assert.equal(resolveGame('synthetic TEST game',[row]).game,row.name);
 assert.equal(resolveGame(null,[]).url,HOME);
});
test('ambiguous mapping fails',()=>assert.throws(()=>resolveGame(row.name,[row,row])));
test('launch origin and route are constrained',()=>{
 for(const u of ['https://evil.example/','javascript:alert(1)','https://play.geforcenow.com.evil.example/mall/#/streamer?cmsId=123','https://user:pass@play.geforcenow.com/mall/#/streamer?cmsId=123',row.launchURL+'&token=secret',row.launchURL+'&cmsId=456',row.launchURL.replace('cmsId=123','cmsId=x')]) assert.throws(()=>validatedURL(u));
});
test('mapping reader validates duplicate IDs and types',t=>{
 const file=path.join(temp(t),'games.json');
 fs.writeFileSync(file,JSON.stringify([row]));assert.equal(readMappings(file).length,1);
 fs.writeFileSync(file,JSON.stringify([row,row]));assert.throws(()=>readMappings(file),/Duplicate/);
 fs.writeFileSync(file,JSON.stringify([{...row,name:'bad\nname'}]));assert.throws(()=>readMappings(file));
});
test('config uses defaults and does not coerce invalid types',t=>{
 const file=path.join(temp(t),'config.toml');assert.equal(loadConfig(file).codec,'auto');
 fs.writeFileSync(file,'hardware_decode = false\nfps = 60\ncodec = "hevc"\n');assert.equal(loadConfig(file).hardware_decode,false);
 fs.writeFileSync(file,'fps = "120"\n');assert.throws(()=>loadConfig(file));
 fs.writeFileSync(file,'made_up_nvidia_option = true\n');assert.throws(()=>loadConfig(file),/Unknown/);
});
test('XDG paths are separated',()=>{
 const dirs=paths({XDG_CONFIG_HOME:'/tmp/c',XDG_DATA_HOME:'/tmp/d',XDG_STATE_HOME:'/tmp/s'});
 assert.equal(dirs.config,'/tmp/c/gfn-armada');assert.equal(dirs.data,'/tmp/d/gfn-armada');assert.equal(dirs.state,'/tmp/s/gfn-armada');
});
test('sync only emits structured launch metadata',()=>{
 const m=manifest([row]);assert.equal(m.steamFilesModified,false);
 assert.deepEqual(m.shortcuts[0].arguments,['launch','steam:1091500']);
 assert.equal(m.shortcuts[0].artwork,null);
});

test('mapping capture validates input and backs up existing mappings',t=>{
 const file=path.join(temp(t),'games.json');
 saveMapping(row,file);const original=fs.readFileSync(file,'utf8');
 saveMapping({...row,name:'Updated'},file);
 assert.equal(readMappings(file)[0].name,'Updated');
 const backup=fs.readdirSync(path.dirname(file)).find(x=>x.startsWith('games.json.backup-'));
 assert.equal(fs.readFileSync(path.join(path.dirname(file),backup),'utf8'),original);
 assert.throws(()=>saveMapping({...row,launchURL:'https://evil.example/'},file));
 assert.equal(readMappings(file)[0].name,'Updated');
});
test('map command requires an explicit Steam ID and title',()=>{
 assert.deepEqual(parse(['map','steam:1091500','--name','Cyberpunk 2077']),{command:'map',target:'steam:1091500',name:'Cyberpunk 2077'});
 assert.throws(()=>parse(['map','steam:1091500']));
});

test('portable CLI invokes packaged runtime without an application-directory argument',t=>{
 const {spawnSync}=require('node:child_process');
 const dir=temp(t);const fake=path.join(dir,'fake-runtime');
 fs.writeFileSync(fake,'#!/bin/sh\nprintf "%s\n" "$@"\nif [ -n "${ELECTRON_RUN_AS_NODE:-}" ]; then exit 9; fi\n',{mode:0o755});
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../launcher/cli.cjs'),'login'],{encoding:'utf8',env:{...process.env,XDG_CONFIG_HOME:dir,GFN_ARMADA_ELECTRON:fake,ELECTRON_RUN_AS_NODE:'1'}});
 assert.equal(result.status,0);assert.equal(result.stdout.trim(),process.platform==='linux'&&process.env.WAYLAND_DISPLAY?'--ozone-platform=wayland\nlogin':'login');
});
test('Wayland runtime argument preserves packaged and development launch targets',()=>{
 const {clientArgs}=require('../launcher/cli.cjs');
 for(const [argv,packaged] of [
  [['runtime','--ozone-platform=wayland','launch','steam:1091500'],true],
  [['runtime','app','--ozone-platform=wayland','launch','steam:1091500'],false]
 ]) assert.deepEqual(parse(clientArgs(argv,packaged)),{command:'launch',target:'steam:1091500'});
 assert.throws(()=>parse(clientArgs(['runtime','--unsupported','login'],true)));
});
test('XWayland comparison overrides Wayland without accepting arbitrary runtime flags',()=>{
 const {ozonePlatform,clientArgs}=require('../launcher/cli.cjs');
 assert.equal(ozonePlatform({WAYLAND_DISPLAY:'wayland-0'},'linux'),'wayland');
 assert.equal(ozonePlatform({WAYLAND_DISPLAY:'wayland-0',GFN_ARMADA_OZONE:'x11'},'linux'),'x11');
 assert.equal(ozonePlatform({},'darwin'),null);
 assert.throws(()=>ozonePlatform({GFN_ARMADA_OZONE:'--no-sandbox'},'linux'));
 assert.deepEqual(parse(clientArgs(['runtime','--ozone-platform=x11','login'],true)),{command:'login'});
});
test('CLI sync never overwrites an existing review manifest',t=>{
 const {spawnSync}=require('node:child_process');
 const dir=temp(t);const file=path.join(dir,'manifest.json');fs.writeFileSync(file,'keep me');
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../launcher/cli.cjs'),'sync','--output',file],{encoding:'utf8',env:{...process.env,XDG_CONFIG_HOME:dir}});
 assert.equal(result.status,1);assert.equal(fs.readFileSync(file,'utf8'),'keep me');
});
