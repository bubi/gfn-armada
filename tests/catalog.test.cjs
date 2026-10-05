const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const catalog=require('../launcher/catalog.cjs');
const {readMappings,resolveGame,gameKey,saveMapping}=require('../launcher/mapping.cjs');
const {parse}=require('../launcher/cli.cjs');
const {attachCatalogImport}=require('../client/catalog-import.cjs');
const auth='GFNJWT synthetic-test-credential-not-a-real-token';
function request(){const u=new URL('https://games.geforce.com/graphql');u.searchParams.set('variables',JSON.stringify({vpcId:'test-vpc',locale:'en_US'}));u.searchParams.set('huId','synthetic-account');return {url:u.href,method:'GET',headers:{Authorization:auth,'NV-CLIENT-TYPE':'BROWSER',Cookie:'must-not-copy'}};}
function app(id='1',status='PLATFORM_SYNC',favorited=true,store='STEAM'){return {id:'synthetic-'+id,title:'Synthetic '+id,library:{favorited},variants:[{id,appStore:store,storeUrl:store==='STEAM'?'https://store.steampowered.com/app/'+id:undefined,gfn:{library:{status}}}]};}
function response(items,next=false,cursor=null){return {status:200,text:async()=>JSON.stringify({data:{apps:{items,pageInfo:{hasNextPage:next,endCursor:cursor}}}})};}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-catalog-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,file:path.join(root,'games.json')};}
test('library command and authenticated catalog context reject guests and foreign destinations',()=>{
  assert.deepEqual(parse(['library']),{command:'library'});assert.throws(()=>parse(['library','--token','secret']));
  const c=catalog.sessionContext(request());assert.equal(c.headers.Authorization,auth);assert.equal(c.headers.Cookie,undefined);assert.notEqual(c.accountFingerprint,'synthetic-account');
  for(const changed of [{headers:{}},{url:request().url.replace('games.geforce.com','evil.example')},{method:'POST'},{url:request().url.replace('https:','http:')}])assert.equal(catalog.sessionContext({...request(),...changed}),null);
});
test('live public NVIDIA fixture confirms IDs and stores without falsely claiming account ownership',()=>{
  const apps=require('./fixtures/gfn-public-apps.json').data.apps.items,rows=apps.flatMap(catalog.normalizeApp);
  assert.equal(rows[0].steamAppId,'2064650');assert.equal(rows[0].gfnVariantId,'102279111');assert.equal(rows[1].store,'epic');
  assert.equal(rows.every(r=>r.owned===false&&r.bookmarked===false),true);
});
test('per-store ownership, favorites and missing fields remain separate; GOG slugs never become numeric IDs',()=>{
  const a=app();a.variants.push({...app('2','NOT_OWNED',true,'EPIC').variants[0]},{...app('3','MANUAL',true,'GOG').variants[0],storeUrl:'https://www.gog.com/en/game/synthetic'},{...app('4','FUTURE_VALUE',true,'XBOX').variants[0]});
  const rows=catalog.normalizeApp(a);assert.deepEqual(rows.map(r=>r.owned),[true,false,true,undefined]);assert.equal(rows[2].storeGameId,undefined);assert.equal(gameKey(rows[2]),'gfn:3');
  assert.equal(rows[2].ownershipSource,'gfn-manual');assert.equal(catalog.storeIdentifier('steam','https://evil.example/app/1'),null);
  assert.throws(()=>catalog.normalizeApp({...a,title:'bad\nname'}));
});
test('catalog pagination finishes before import and sends only read queries to the original endpoint',async t=>{
  const f=fixture(t),calls=[];const snapshot=await catalog.readCatalog(catalog.sessionContext(request()),async(url,options)=>{calls.push({url,options});return calls.length===1?response([app('1')],true,'next'):response([app('2','MANUAL',true,'GOG'),app('3','NOT_OWNED'),app('4','FUTURE_VALUE'),app('5','PLATFORM_SYNC',false)]);});
  assert.equal(fs.existsSync(f.file),false);assert.equal(snapshot.complete,true);
  for(const call of calls){assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'error');assert.equal(call.options.headers.Cookie,undefined);assert.doesNotMatch(new URL(call.url).searchParams.get('query'),/mutation/i);}
  assert.equal(JSON.parse(new URL(calls[1].url).searchParams.get('variables')).cursor,'next');
  const result=catalog.importCatalog(snapshot,f.file);assert.equal(result.imported,2);assert.equal(result.manualOwnership,1);assert.equal(result.unknownOwnership,1);assert.equal(result.notOwned,1);
  const rows=readMappings(f.file);assert.equal(resolveGame('steam:1',rows).game,'Synthetic 1');assert.equal(resolveGame('gfn:2',rows).game,'Synthetic 2');
  const persisted=fs.readFileSync(f.file,'utf8');assert.doesNotMatch(persisted,/synthetic-test-credential|synthetic-account|Authorization|Cookie/);
  catalog.importCatalog({...snapshot,rows:[]},f.file);assert.equal(readMappings(f.file).every(r=>r.catalogRetired===true&&r.owned===undefined),true);
  assert.equal(fs.readdirSync(f.root).some(x=>x.includes('.backup-')),true);
});
test('HTTP errors, GraphQL errors and stalled pagination never replace prior mappings',async t=>{
  const f=fixture(t);fs.writeFileSync(f.file,'[]\n');const original=fs.readFileSync(f.file);
  for(const fetch of [async()=>({status:401}),async()=>({status:200,text:async()=>'{"errors":[{"message":"private error"}]}' }),async()=>response([app()],true,'same')])await assert.rejects(catalog.readCatalog(catalog.sessionContext(request()),fetch));
  assert.deepEqual(fs.readFileSync(f.file),original);assert.throws(()=>catalog.importCatalog({complete:false,rows:[]},f.file));
});
test('manual recapture merges into a catalog mapping without changing its stable shortcut key',t=>{
  const f=fixture(t),rows=catalog.normalizeApp(app());catalog.importCatalog({complete:true,rows,apps:1},f.file);
  saveMapping({store:'steam',storeGameId:'1',steamAppId:'1',gfnVariantId:'1',name:'Recaptured',captureSource:'manual-webclient',launchURL:rows[0].launchURL},f.file);
  const saved=readMappings(f.file);assert.equal(saved.length,1);assert.equal(gameKey(saved[0]),'gfn:1');assert.equal(saved[0].owned,true);assert.equal(saved[0].captureSource,'manual-webclient');
});
test('CDP account import handles out-of-order extra headers, never imports a guest, and detaches on dispose',async t=>{
  const f=fixture(t),debuggerApi=new EventEmitter();debuggerApi.isAttached=()=>true;debuggerApi.sendCommand=async()=>{};
  const contents={debugger:debuggerApi};let completed,fetches=0;
  const dispose=attachCatalogImport(contents,{file:f.file,fetch:async()=>{fetches++;return response([app()])},onComplete:r=>completed=r});t.after(dispose);
  debuggerApi.emit('message',null,'Network.requestWillBeSent',{requestId:'guest',request:{...request(),headers:{}}});assert.equal(fetches,0);
  debuggerApi.emit('message',null,'Network.requestWillBeSentExtraInfo',{requestId:'auth',headers:request().headers});
  debuggerApi.emit('message',null,'Network.requestWillBeSent',{requestId:'auth',request:{...request(),headers:{}}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(completed.imported,1);assert.equal(fetches,1);
  dispose();assert.equal(debuggerApi.listenerCount('message'),0);
});
