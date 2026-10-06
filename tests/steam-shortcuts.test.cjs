const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const vdf=require('../steam-integration/binary-vdf.cjs');
const steam=require('../steam-integration/shortcuts.cjs');
const {readMappings,resolveGame,saveMapping}=require('../launcher/mapping.cjs');
const {parse}=require('../launcher/cli.cjs');
const url='https://play.geforcenow.com/mall/#/streamer?launchSource=GeForceNOW&cmsId=123';
const row={store:'steam',storeGameId:'1091500',name:'Synthetic game',launchURL:url,bookmarked:true,owned:true};
const stopped={isSteamRunning:()=>false};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-steam-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const user=path.join(root,'1234'),executable=path.join(root,'GFN Armada');fs.mkdirSync(path.join(user,'config'),{recursive:true});fs.writeFileSync(executable,'#!/bin/sh\nexit 0\n',{mode:0o755});
  return {root,user,executable,file:path.join(user,'config/shortcuts.vdf')};
}
function unmanaged(){return [{type:0,key:'shortcuts',value:[{type:0,key:'0',value:[
  {type:2,key:'appid',value:vdf.uint32(0x81234567)},{type:1,key:'appname',value:'Unrelated user game'},
  {type:1,key:'LaunchOptions',value:'custom options'},{type:3,key:'futureFloat',value:Buffer.from([0,0,192,127])},
  {type:0,key:'tags',value:[{type:1,key:'0',value:'My collection'}]}
]}]}];}
test('binary VDF preserves unknown scalar bytes and rejects truncation or unsupported types',()=>{
  const bytes=vdf.encode(unmanaged());assert.deepEqual(vdf.encode(vdf.decode(bytes)),bytes);
  assert.throws(()=>vdf.decode(bytes.subarray(0,bytes.length-1)),/Truncated/);
  assert.throws(()=>vdf.decode(Buffer.from([9,0,8])),/Unsupported/);
  assert.throws(()=>vdf.decode(Buffer.concat([bytes,Buffer.from([0])])),/Trailing/);
});
test('CRC32 has the standard independent check value',()=>assert.equal(steam.crc32('123456789'),0xcbf43926));
test('AppImage shortcuts use the runtime extract-and-run option without requiring FUSE',t=>{
  const f=fixture(t),header=Buffer.alloc(11);header.set([0x7f,0x45,0x4c,0x46]);header.set([0x41,0x49,2],8);fs.writeFileSync(f.executable,header);
  assert.equal(steam.plan([row],f).changes[0].launchOptions,'--appimage-extract-and-run launch steam:1091500');
});
test('Steam sync filters bookmark AND ownership, preserves unrelated shortcuts, and is idempotent',t=>{
  const f=fixture(t),original=vdf.encode(unmanaged());fs.writeFileSync(f.file,original);
  const p=steam.plan([row,{...row,storeGameId:'2',owned:false},{...row,storeGameId:'3',bookmarked:false},{...row,storeGameId:'4',owned:undefined}],f);
  assert.equal(p.changes.length,1);assert.equal(p.skipped.length,3);assert.deepEqual(fs.readFileSync(f.file),original);
  const result=steam.apply(p,stopped);assert.deepEqual(fs.readFileSync(result.backup),original);
  const tree=vdf.decode(fs.readFileSync(f.file));assert.deepEqual(tree[0].value[0],unmanaged()[0].value[0]);
  assert.equal(steam.plan([row],f).changed,false);
  const firstId=p.changes[0].shortcutAppId;
  const changed=steam.plan([{...row,name:'Renamed'}],f);assert.equal(changed.changes[0].shortcutAppId,firstId);
  assert.equal(changed.changes[0].action,'update');
  steam.restore(result.backup,stopped);assert.deepEqual(fs.readFileSync(f.file),original);
});
test('Steam-running and stale-plan guards leave the original file untouched',t=>{
  const f=fixture(t),original=vdf.encode(unmanaged());fs.writeFileSync(f.file,original);
  const p=steam.plan([row],f);
  assert.throws(()=>steam.apply(p,{isSteamRunning:()=>true}),/Close Steam/);
  let calls=0;assert.throws(()=>steam.apply(p,{isSteamRunning:()=>++calls>1}),/Steam started/);
  assert.deepEqual(fs.readFileSync(f.file),original);
  const updated=Buffer.from(original);updated[updated.length-1]=0;fs.writeFileSync(f.file,updated);
  assert.throws(()=>steam.apply(p,stopped),/changed after review/);assert.deepEqual(fs.readFileSync(f.file),updated);
});
test('catalog mapping migration preserves an existing shortcut AppID and stays stable without store URLs',t=>{
  const f=fixture(t),original=steam.apply(steam.plan([row],f),stopped);
  const appid=original.changes[0].shortcutAppId;
  const imported={...row,gfnVariantId:'123',mappingSource:'gfn-catalog'};
  const migration=steam.plan([imported],f);assert.equal(migration.changes[0].action,'update');assert.equal(migration.changes[0].shortcutAppId,appid);steam.apply(migration,stopped);
  const withoutId={...imported};delete withoutId.storeGameId;
  assert.equal(steam.plan([withoutId],f).changed,false);
  assert.throws(()=>steam.plan([row,imported],f),/Ambiguous|collision/);
});
test('restore refuses later user changes and restores absence of a previously missing file',t=>{
  const f=fixture(t);const result=steam.apply(steam.plan([row],f),stopped);
  steam.restore(result.backup,stopped);assert.equal(fs.existsSync(f.file),false);
  const next=steam.apply(steam.plan([row],f),stopped);fs.appendFileSync(f.file,Buffer.from([0]));const current=fs.readFileSync(f.file);
  assert.throws(()=>steam.restore(next.backup,stopped),/changed since sync/);assert.deepEqual(fs.readFileSync(f.file),current);
});
test('malformed Steam files fail before backups; executable quoting cannot inject options',t=>{
  const f=fixture(t);fs.writeFileSync(f.file,Buffer.from([9,0,8]));const before=fs.readdirSync(path.dirname(f.file));
  assert.throws(()=>steam.plan([row],f),/Unsupported/);assert.deepEqual(fs.readdirSync(path.dirname(f.file)),before);
  assert.throws(()=>steam.plan([row],{...f,executable:'/tmp/evil" --no-sandbox'}),/quotes/);
});
test('store-specific mappings keep editions distinct and reject ambiguous names',t=>{
  const f=fixture(t),file=path.join(f.root,'games.json');
  const rows=[row,{...row,store:'epic',storeGameId:'synthetic-epic'},{...row,store:'gog',storeGameId:'123'},{...row,store:'xbox',storeGameId:'9TESTPRODUCT'}];
  for(const r of rows)saveMapping(r,file);const mapped=readMappings(file);assert.equal(mapped.length,4);
  for(const r of rows)assert.equal(resolveGame(`${r.store}:${r.storeGameId}`,mapped).url,url);
  assert.throws(()=>resolveGame(row.name,mapped),/unique/);
  assert.equal(steam.plan(mapped,f).changes.length,4);
  assert.throws(()=>saveMapping({...row,owned:'yes'},file),/boolean/);
});
test('sync parsing distinguishes review/apply and refuses ambiguous output or flags',()=>{
  assert.deepEqual(parse(['sync','--steam-user','/tmp/1234','--apply']),{command:'sync',steamUser:'/tmp/1234',apply:true});
  for(const args of [['sync','--apply','--output','x'],['sync','--apply','--apply'],['sync','--steam-user'],['sync','--executable','--apply']])assert.throws(()=>parse(args));
  assert.equal(parse(['steam-restore','/tmp/backup']).backup,'/tmp/backup');
  assert.equal(parse(['map','epic:example','--name','Test']).target,'epic:example');
});

test('real Steam field spelling preserves client settings and stays idempotent after Steam rewrites',t=>{
  const f=fixture(t),header=Buffer.alloc(11);header.set([0x7f,0x45,0x4c,0x46]);header.set([0x41,0x49,2],8);fs.writeFileSync(f.executable,header);
  const original=unmanaged(),client=original[0].value[0].value;
  vdf.set(client,'AppName',1,'GFN Armada');vdf.set(client,'Exe',1,`"${f.executable}"`);
  vdf.set(client,'LaunchOptions',1,'GFN_ARMADA_GAMESCOPE=nested GFN_ARMADA_BROWSER_IDENTITY=windows %command% --appimage-extract-and-run launch');
  const bytes=vdf.encode(original);fs.writeFileSync(f.file,bytes);
  const p=steam.plan([row],f);
  assert.equal(p.changes[0].launchOptions,'GFN_ARMADA_GAMESCOPE=nested GFN_ARMADA_BROWSER_IDENTITY=windows %command% --appimage-extract-and-run launch steam:1091500');
  const applied=steam.apply(p,stopped),tree=vdf.decode(fs.readFileSync(f.file));
  assert.deepEqual(tree[0].value[0],original[0].value[0]);
  const game=tree[0].value[1].value;vdf.get(game,'appname').key='AppName';vdf.get(game,'exe').key='Exe';
  fs.writeFileSync(f.file,vdf.encode(tree));
  assert.equal(steam.plan([row],f).changed,false);
  const renamed=steam.plan([{...row,name:'Renamed'}],f);
  assert.equal(renamed.changes[0].shortcutAppId,applied.changes[0].shortcutAppId);
  assert.equal(vdf.get(vdf.decode(renamed.output)[0].value[1].value,'appname').key,'AppName');
});
test('client shortcut inheritance does not propagate arbitrary shell options or another executable',t=>{
  const f=fixture(t);
  for(const [exe,options] of [[f.executable,'GFN_ARMADA_GAMESCOPE=nested %command% launch; echo unsafe'],[f.executable,'GFN_ARMADA_GAMESCOPE=nested %command% --no-sandbox launch'],[f.executable+'-other','GFN_ARMADA_GAMESCOPE=nested %command% launch']]){
    const tree=unmanaged(),fields=tree[0].value[0].value;
    vdf.set(fields,'Exe',1,`"${exe}"`);vdf.set(fields,'LaunchOptions',1,options);fs.writeFileSync(f.file,vdf.encode(tree));
    assert.equal(steam.plan([row],f).changes[0].launchOptions,'launch steam:1091500');
  }
  assert.throws(()=>vdf.get([{key:'Exe'},{key:'exe'}],'exe'),/Duplicate Steam field/);
});
