const test=require('node:test'),assert=require('node:assert/strict');
const {shouldImport,attachLibrarySync}=require('../client/library-sync.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('normal launch/login import automatically; direct game launch and map never sync',()=>{
  for(const command of ['launch','login','library'])assert.equal(shouldImport({command},{steam_integration:true}),true);
  for(const target of ['gfn:123','steam:1091500','Game name'])assert.equal(shouldImport({command:'launch',target},{steam_integration:true}),false);
  assert.equal(shouldImport({command:'map'},{steam_integration:true}),false);
  assert.equal(shouldImport({command:'launch'},{steam_integration:false}),false);
  assert.equal(shouldImport({command:'library'},{steam_integration:false}),true);
});
test('Steam sync waits for complete authenticated import and never blocks startup',async()=>{
  let hooks,called=0,disposed=0;const reports=[];
  const dispose=attachLibrarySync({}, {request:{command:'launch'},config:{steam_integration:true},state:'/tmp/test-state',executable:'/tmp/client',
    attach:(_contents,options)=>{hooks=options;return ()=>disposed++},mappings:()=>[{synthetic:true}],
    sync:async(rows)=>{called++;assert.deepEqual(rows,[{synthetic:true}]);return {status:'synced',added:1,updated:0}},report:r=>reports.push(r)});
  assert.equal(called,0);hooks.onComplete({imported:1});hooks.onComplete({imported:1});assert.equal(called,0);await tick();
  assert.equal(called,1);assert.equal(reports.at(-1).status,'synced');dispose();assert.equal(disposed,1);
});
test('cancel before import or during queued sync cannot start a Steam write',async()=>{
  for(const queued of [false,true]){
    let hooks,calls=0;const dispose=attachLibrarySync({}, {request:{command:'launch'},config:{steam_integration:true},state:'/tmp/s',executable:'/tmp/e',attach:(_,o)=>{hooks=o;return ()=>{}},sync:async()=>calls++,mappings:()=>[]});
    if(queued)hooks.onComplete({imported:0});dispose();if(!queued)hooks.onComplete({imported:0});await tick();assert.equal(calls,0);
  }
});
test('missing Steam interface is pending; disabled integration can still explicitly import',async()=>{
  let hooks;const reports=[];attachLibrarySync({}, {request:{command:'launch'},config:{steam_integration:true},executable:'/tmp/e',attach:(_,o)=>{hooks=o;return ()=>{}},mappings:()=>[],sync:async()=>{throw Error('private backend detail')},report:r=>reports.push(r)});
  hooks.onComplete({imported:0});await tick();assert.equal(reports.at(-1).status,'pending');assert.doesNotMatch(JSON.stringify(reports),/private backend/);
  let calls=0;attachLibrarySync({}, {request:{command:'library'},config:{steam_integration:false},attach:(_,o)=>{hooks=o;return ()=>{}},sync:async()=>calls++,report:r=>reports.push(r)});hooks.onComplete({imported:0});await tick();assert.equal(calls,0);assert.equal(reports.at(-1).status,'disabled');
});
