const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {paths}=require('./config.cjs');
const {gameKey,readMappings,writeMappings,validatedURL}=require('./mapping.cjs');
// Selection fields and pagination verified against the original NVIDIA web
// app main.c2e839a18214e672.js and an unauthenticated read on 2026-10-05.
const QUERY=`query GfnArmadaLibrary($vpcId: String!, $locale: String!, $cursor: String!) {
  apps(vpcId: $vpcId, language: $locale, first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor totalCount }
    items { id title library { favorited }
      variants { id appStore storeUrl gfn { library { status selected playStatus } } }
    }
  }
}`;
function catalogURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&['games.geforce.com','apps.gxn.nvidia.com'].includes(u.hostname)&&u.port===''&&u.pathname==='/graphql'?u:null}catch{return null}}
function sessionContext(request){
  const url=catalogURL(request?.url);if(!url||request.method!=='GET')return null;
  let variables;try{variables=JSON.parse(url.searchParams.get('variables'))}catch{return null}
  if(typeof variables?.vpcId!=='string'||!variables.vpcId||variables.vpcId.length>128||typeof variables.locale!=='string'||!variables.locale||variables.locale.length>32)return null;
  const headers={};let authorization;
  for(const [key,value] of Object.entries(request.headers||{})){
    if(typeof value!=='string'||value.length>16384||/[\r\n]/.test(value))continue;
    const lower=key.toLowerCase();if(lower==='authorization')authorization=value;
    if(lower==='authorization'||lower.startsWith('nv-')||['origin','referer','user-agent'].includes(lower))headers[key]=value;
  }
  // Guest catalogue data is never imported as account ownership.
  if(!/^GFNJWT \S{10,16300}$/.test(authorization||''))return null;
  const huId=url.searchParams.get('huId');if(!huId||huId.length>256)return null;
  return {endpoint:url.origin+'/graphql',vpcId:variables.vpcId,locale:variables.locale,huId,headers,
    accountFingerprint:crypto.createHash('sha256').update(huId).digest('hex')};
}
function storeIdentifier(store,raw){
  let u;try{u=new URL(raw)}catch{return null}
  if(u.protocol!=='https:'||u.username||u.password)return null;
  let m;
  if(store==='steam'&&u.hostname==='store.steampowered.com'&&(m=/^\/app\/(\d+)(?:\/|$)/.exec(u.pathname)))return m[1];
  if(store==='epic'&&['store.epicgames.com','www.epicgames.com'].includes(u.hostname)&&(m=/\/(?:p|product)\/([A-Za-z0-9._-]{1,128})(?:\/|$)/.exec(u.pathname)))return m[1];
  if(store==='xbox'&&['www.xbox.com','xbox.com','apps.microsoft.com','www.microsoft.com'].includes(u.hostname)&&(m=/\/([A-Za-z0-9]{12})\/?$/.exec(u.pathname)))return m[1];
  // GOG product-page slugs are not numeric GOG IDs. Use the observed GFN
  // variant as a launch key when the response lacks a verified store ID.
  return null;
}
function normalizeApp(app){
  if(typeof app?.id!=='string'||!app.id||app.id.length>128||typeof app.title!=='string'||!app.title||app.title.length>512||/[\r\n\0]/.test(app.title)||!Array.isArray(app.variants)||app.variants.length>64)throw new Error('Unsupported catalog app schema');
  const rows=[],stores={STEAM:'steam',EPIC:'epic',GOG:'gog',XBOX:'xbox'};
  for(const variant of app.variants){
    const store=stores[variant.appStore];if(!store)continue;
    if(typeof variant.id!=='string'||!/^\d{1,20}$/.test(variant.id))throw new Error('Unsupported catalog variant identifier');
    const status=variant.gfn?.library?.status;
    const owned=['PLATFORM_SYNC','MANUAL'].includes(status)?true:status==='NOT_OWNED'?false:undefined;
    const storeGameId=storeIdentifier(store,variant.storeUrl);
    rows.push({store,...(storeGameId?{storeGameId,...(store==='steam'?{steamAppId:storeGameId}:{})}:{}),gfnAppId:app.id,gfnVariantId:variant.id,name:app.title,
      launchURL:validatedURL(`https://play.geforcenow.com/mall/#/streamer?launchSource=GeForceNOW&cmsId=${variant.id}`),
      ...(typeof app.library?.favorited==='boolean'?{bookmarked:app.library.favorited}:{}),...(owned!==undefined?{owned}:{}),
      ownershipSource:status==='PLATFORM_SYNC'?'gfn-platform-sync':status==='MANUAL'?'gfn-manual':status==='NOT_OWNED'?'gfn-not-owned':'unknown',
      mappingSource:'gfn-catalog',launchEvidence:'NVIDIA catalog variant ID; original web-client cmsId route',...(storeGameId?{storeIdSource:'nvidia-store-url'}:{})});
  }
  return rows;
}
async function readCatalog(context,fetch,{signal,onProgress=()=>{},maxPages=100}={}){
  const rows=[],appIds=new Set(),variantIds=new Set(),cursors=new Set();let cursor='';
  for(let page=0;page<maxPages;page++){
    const url=new URL(context.endpoint);if(!catalogURL(url.href))throw new Error('Unsupported catalog endpoint');
    url.searchParams.set('requestType','apps');url.searchParams.set('query',QUERY);
    url.searchParams.set('extensions',JSON.stringify({persistedQuery:{sha256Hash:crypto.createHash('sha256').update(QUERY).digest('hex')}}));
    url.searchParams.set('variables',JSON.stringify({vpcId:context.vpcId,locale:context.locale,cursor}));url.searchParams.set('huId',context.huId);
    const response=await fetch(url.href,{method:'GET',redirect:'error',cache:'no-store',signal,headers:{...context.headers,'Content-Type':'application/graphql','x-sw-cachebypass':'true'}});
    if(response.status!==200)throw new Error(`Catalog read failed (HTTP ${response.status})`);
    const text=await response.text();if(text.length>8*1024*1024)throw new Error('Catalog response too large');
    let payload;try{payload=JSON.parse(text)}catch{throw new Error('Invalid catalog response')}
    if(payload.errors?.length)throw new Error('Catalog API returned errors; previous mappings retained');
    const apps=payload.data?.apps,info=apps?.pageInfo;
    if(!Array.isArray(apps?.items)||apps.items.length>100||typeof info?.hasNextPage!=='boolean')throw new Error('Unsupported catalog pagination schema');
    for(const app of apps.items){if(appIds.has(app.id))throw new Error('Duplicate catalog app');appIds.add(app.id);for(const row of normalizeApp(app)){if(variantIds.has(row.gfnVariantId))throw new Error('Duplicate catalog variant');variantIds.add(row.gfnVariantId);rows.push(row);}}
    onProgress({pages:page+1,apps:appIds.size,variants:rows.length});
    if(!info.hasNextPage)return {schemaVersion:1,complete:true,accountFingerprint:context.accountFingerprint,fetchedAt:new Date().toISOString(),apps:appIds.size,rows};
    if(!apps.items.length||typeof info.endCursor!=='string'||!info.endCursor||info.endCursor.length>1024||cursors.has(info.endCursor))throw new Error('Catalog pagination did not advance');
    cursors.add(info.endCursor);cursor=info.endCursor;
  }
  throw new Error('Catalog page limit exceeded; previous mappings retained');
}
function importCatalog(snapshot,file=path.join(paths().config,'games.json')){
  if(snapshot.complete!==true||!Array.isArray(snapshot.rows))throw new Error('Only a complete account catalog can be imported');
  const old=readMappings(file),eligible=snapshot.rows.filter(r=>r.bookmarked===true&&r.owned===true),keys=new Set();
  for(const row of eligible){const key=gameKey(row);if(keys.has(key))throw new Error('Ambiguous catalog store mapping');keys.add(key);}
  const next=old.map(row=>{if(row.mappingSource!=='gfn-catalog')return row;const retired={...row,bookmarked:false,catalogRetired:true,ownershipSource:'unknown'};delete retired.owned;return retired;});
  for(const row of eligible){
    const matches=next.map((old,index)=>({old,index})).filter(({old})=>gameKey(old)===gameKey(row)||old.gfnVariantId===row.gfnVariantId||(row.storeGameId&&old.store===row.store&&(old.storeGameId||old.steamAppId)===row.storeGameId)||(row.store==='steam'&&row.steamAppId&&old.steamAppId===row.steamAppId));
    if(matches.length>1)throw new Error('Ambiguous existing mapping; no catalog mappings were written');
    const updated={...(matches[0]?.old||{}),...row,catalogRetired:false,catalogFetchedAt:snapshot.fetchedAt,catalogAccountFingerprint:snapshot.accountFingerprint};
    // Drop stale store keys if this response does not contain one.
    if(!row.storeGameId){delete updated.storeGameId;delete updated.steamAppId;}
    if(matches.length)next[matches[0].index]=updated;else next.push(updated);
  }
  writeMappings(next,file);
  return {imported:eligible.length,unknownOwnership:snapshot.rows.filter(r=>r.bookmarked===true&&r.owned===undefined).length,notOwned:snapshot.rows.filter(r=>r.bookmarked===true&&r.owned===false).length,manualOwnership:eligible.filter(r=>r.ownershipSource==='gfn-manual').length,apps:snapshot.apps,complete:true,steamFilesModified:false};
}
module.exports={QUERY,catalogURL,sessionContext,storeIdentifier,normalizeApp,readCatalog,importCatalog};
