const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {steamOperation}=require('../steam-integration/live-runtime.cjs');
const {syncLive,workFor,launchKey}=require('../steam-integration/live-sync.cjs');
const vdf=require('../steam-integration/binary-vdf.cjs');
const spec={gameKey:'gfn:123',aliases:['gfn:123','steam:1'],name:'Synthetic (GFN · STEAM)',exe:'"/tmp/client"',startDir:'"/tmp"',launchOptions:'launch gfn:123'};
function runtime({delay=0,fail=false}={}){
  const rows=new Map(),overview=new Map();let calls=[],next=0x80000001;
  const listeners=new Map();
  const notify=id=>{for(const callback of listeners.get(id)||[])callback({...rows.get(id)})};
  const Apps={
    AddShortcut:async(name,exe)=>{const id=next++;rows.set(id,{unAppID:id,strDisplayName:'client',strShortcutExe:exe,strShortcutStartDir:'',strShortcutLaunchOptions:''});setTimeout(()=>overview.set(id,{}),delay);calls.push(['add',id]);return id},
    RegisterForAppDetails(id,callback){if(rows.has(id))callback({...rows.get(id)});const set=listeners.get(id)||new Set();listeners.set(id,set);set.add(callback);return {unregister:()=>set.delete(callback)}},
  };
  for(const [method,field] of Object.entries({SetShortcutName:'strDisplayName',SetShortcutExe:'strShortcutExe',SetShortcutStartDir:'strShortcutStartDir',SetShortcutLaunchOptions:'strShortcutLaunchOptions'}))Apps[method]=(id,value)=>{calls.push([method,id]);if(!fail){rows.get(id)[field]=value;notify(id)}};
  const context={SteamClient:{Apps},appStore:{m_mapApps:{keys:()=>overview.keys()},GetAppOverviewByAppID:id=>overview.get(id)},Map,Set,Number,Date,Promise,setTimeout,clearTimeout};
  return {rows,calls,overview,evaluate:expression=>vm.runInNewContext(expression,context),close(){},listeners};
}
test('live API waits for new overview, sets ignored AddShortcut fields and verifies real details',async()=>{
  const r=runtime({delay:150});const put=await r.evaluate(`(${steamOperation})(${JSON.stringify({kind:'put',spec,allowedOptions:[]})})`);
  assert.equal(put.status,'verified');assert.equal(put.created,true);assert.equal(r.rows.get(put.appid).strShortcutLaunchOptions,spec.launchOptions);
  assert.equal(r.calls.filter(c=>c[0]==='add').length,1);assert.equal([...r.listeners.values()].every(s=>s.size===0),true);
  const inventory=await r.evaluate(`(${steamOperation})(${JSON.stringify({kind:'inventory',exe:spec.exe})})`);assert.equal(workFor([spec],inventory).length,0);
  r.rows.get(put.appid).strShortcutLaunchOptions='foreign-command';
  const refused=await r.evaluate(`(${steamOperation})(${JSON.stringify({kind:'put',spec,appid:put.appid,allowedOptions:[spec.launchOptions]})})`);assert.equal(refused.status,'stale-shortcut');
});
test('existing IDs survive rename; foreign and duplicate entries cannot be changed',()=>{
  const row={appid:0x80000003,...spec,name:'old'};
  const work=workFor([spec],{status:'ready',rows:[row]});assert.equal(work[0].appid,row.appid);
  assert.equal(workFor([spec],{status:'ready',rows:[{...row,exe:'"/tmp/foreign"'}]})[0].appid,undefined);
  assert.throws(()=>workFor([spec],{status:'ready',rows:[row,{...row,appid:0x80000004}]}),/Duplicate/);
  assert.equal(launchKey('launch gfn:123; rm -rf /'),null);
  assert.equal(launchKey('GFN_ARMADA_GAMESCOPE=nested /usr/libexec/armada/armada-game-launch %command% --appimage-extract-and-run launch gfn:123'),'gfn:123');
});
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-live-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const user=path.join(root,'userdata/1'),executable=path.join(root,'client');fs.mkdirSync(path.join(user,'config'),{recursive:true});fs.writeFileSync(executable,'#!/bin/sh\n',{mode:0o755});
  const file=path.join(user,'config/shortcuts.vdf');fs.writeFileSync(file,vdf.encode([{type:0,key:'shortcuts',value:[]}]));
  const row={name:'Synthetic',gfnVariantId:'123',store:'steam',storeGameId:'1',mappingSource:'gfn-catalog',owned:true,bookmarked:true,launchURL:'https://play.geforcenow.com/mall/#/streamer?launchSource=GeForceNOW&cmsId=123'};
  return {root,file,row,options:{user,executable,state:path.join(root,'state')}};
}
test('live sync never writes VDF, uses live inventory rather than stale disk and backs up before adding',async t=>{
  const f=fixture(t),r=runtime(),original=fs.readFileSync(f.file);
  const first=await syncLive([f.row],{...f.options,connect:async()=>r});assert.equal(first.status,'synced');assert.equal(first.added,1);
  assert.deepEqual(fs.readFileSync(f.file),original);assert.deepEqual(fs.readFileSync(first.backup+'.vdf'),original);
  const second=await syncLive([f.row],{...f.options,connect:async()=>r});assert.equal(second.unchanged,1);assert.equal(r.calls.filter(c=>c[0]==='add').length,1);
  const renamed=await syncLive([{...f.row,name:'Renamed'}],{...f.options,connect:async()=>r});assert.equal(renamed.updated,1);assert.equal(r.rows.size,1);
});
test('unknown mutation outcome remains pending and cannot create duplicates on retry',async t=>{
  const f=fixture(t);let writes=0;
  const bridge={evaluate:async expression=>{if(expression.includes('"kind":"inventory"'))return {status:'ready',rows:[]};writes++;throw Error('connection lost after add')},close(){}};
  await assert.rejects(syncLive([f.row],{...f.options,connect:async()=>bridge}));
  const retry=await syncLive([f.row],{...f.options,connect:async()=>bridge});assert.equal(retry.status,'pending');assert.equal(writes,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.options.state,'steam-live-sync.json'))).status,'pending');
});

test('ignored Steam setters never produce a verified sync result',async()=>{
  const r=runtime({fail:true});
  const result=await r.evaluate(`(${steamOperation})(${JSON.stringify({kind:'put',spec,allowedOptions:[]})})`);
  assert.equal(result.status,'verification-failed');assert.equal(result.created,true);assert.equal(r.rows.size,1);
  assert.equal([...r.listeners.values()].every(s=>s.size===0),true);
});
