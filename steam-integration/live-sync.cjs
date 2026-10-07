const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const vdf=require('./binary-vdf.cjs'),shortcuts=require('./shortcuts.cjs');
const {gameKey}=require('../launcher/mapping.cjs');
const {steamOperation}=require('./live-runtime.cjs');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function specsFor(rows,plan){
  const wanted=new Map(rows.filter(r=>r.owned===true&&r.bookmarked===true).map(r=>[gameKey(r),r]));
  const entries=vdf.get(vdf.decode(plan.output),'shortcuts').value;
  return entries.flatMap(entry=>{
    const fields=entry.value,tags=vdf.get(fields,'tags');
    const tag=tags?.value?.find(t=>t.type===1&&t.value.startsWith('gfn-armada:'));
    const key=tag?.value.slice('gfn-armada:'.length),row=wanted.get(key);if(!row)return [];
    const aliases=[key];if(row.storeGameId)aliases.push(`${row.store}:${row.storeGameId}`);else if(row.steamAppId)aliases.push(`steam:${row.steamAppId}`);
    return [{gameKey:key,aliases,name:vdf.get(fields,'appname').value,exe:vdf.get(fields,'exe').value,startDir:vdf.get(fields,'StartDir').value,launchOptions:vdf.get(fields,'LaunchOptions').value}];
  });
}
const {launchKey}=shortcuts;
function workFor(specs,inventory){
  if(inventory.status!=='ready'||!Array.isArray(inventory.rows))throw new Error('Steam live inventory unavailable');
  const used=new Set(),operations=[];
  for(const spec of specs){
    const matches=inventory.rows.filter(row=>row.exe===spec.exe&&spec.aliases.includes(launchKey(row.launchOptions)));
    if(matches.length>1)throw new Error('Duplicate live GFN game shortcuts; automatic sync stopped');
    const current=matches[0];
    if(current){
      if(!Number.isInteger(current.appid)||current.appid<0x80000000||current.appid>0xffffffff||used.has(current.appid))throw new Error('Ambiguous Steam shortcut AppID');
      used.add(current.appid);
      if(['name','exe','startDir','launchOptions'].every(k=>current[k]===spec[k]))continue;
    }
    operations.push({spec,appid:current?.appid,allowedOptions:current?[current.launchOptions]:[]});
  }
  return operations;
}
function writeJSON(file,value){
  const tmp=file+'.tmp-'+crypto.randomUUID();
  try{fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file)}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
async function syncLive(rows,{executable,state,user,signal,connect=require('./cef.cjs').connect,onProgress=()=>{}}={}){
  if(!state||!path.isAbsolute(state))throw new Error('Live sync requires a local state directory');
  fs.mkdirSync(state,{recursive:true,mode:0o700});
  const lock=path.join(state,'steam-live-sync.lock'),journal=path.join(state,'steam-live-sync.json');
  // Fail closed on interrupted work; never blindly repeat an AddShortcut call.
  if(fs.existsSync(lock))return {status:'pending',reason:'another-or-interrupted-sync'};
  const fd=fs.openSync(lock,'wx',0o600);let bridge,uncertain=false;
  try{
    const planned=shortcuts.plan(rows,{executable,user});let specs=specsFor(rows,planned);
    if(!specs.length)return {status:'synced',added:0,updated:0,unchanged:0};
    const previous=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal,'utf8')):null;
    if(previous?.status==='pending'||previous?.status==='partial')return {status:'pending',reason:'previous-sync-needs-review'};
    signal?.throwIfAborted();bridge=await connect({signal});
    const evaluate=input=>bridge.evaluate(`(${steamOperation.toString()})(${JSON.stringify(input)})`);
    const inventory=await evaluate({kind:'inventory',exe:`"${executable}"`});
    if(inventory.status==='ready'&&Array.isArray(inventory.rows)){
      const templates=inventory.rows.map(r=>({value:[{type:1,key:'exe',value:r.exe},{type:1,key:'LaunchOptions',value:r.launchOptions}]}));
      const prefix=shortcuts.clientLaunchPrefix(templates,executable);
      specs=specs.map(spec=>({...spec,launchOptions:`${prefix}${shortcuts.appImage(executable)?'--appimage-extract-and-run ':''}launch ${spec.gameKey}`}));
    }
    const operations=workFor(specs,inventory);
    if(!operations.length)return {status:'synced',added:0,updated:0,unchanged:specs.length};
    signal?.throwIfAborted();
    const backup=path.join(state,'steam-live-backup-'+Date.now()+'-'+crypto.randomUUID());
    if(planned.original)fs.writeFileSync(backup+'.vdf',planned.original,{flag:'wx',mode:0o600});
    fs.writeFileSync(backup+'.json',JSON.stringify({schemaVersion:1,mode:'steam-api',file:planned.file,originalExists:planned.original!==null,beforeSha256:digest(planned.original||Buffer.alloc(0)),liveBefore:inventory.rows,desired:specs},null,2)+'\n',{flag:'wx',mode:0o600});
    const record={schemaVersion:1,status:'pending',backup,completed:[],pending:null};
    writeJSON(journal,record);let added=0,updated=0;
    for(const operation of operations){
      signal?.throwIfAborted();
      record.pending={gameKey:operation.spec.gameKey,appid:operation.appid||null};writeJSON(journal,record);
      uncertain=true;
      const result=await evaluate({kind:'put',...operation});
      record.pending={...record.pending,result};writeJSON(journal,record);
      if(result?.status!=='verified'){record.status='partial';writeJSON(journal,record);return {status:'partial',added,updated,reason:'steam-did-not-confirm',backup};}
      uncertain=false;
      record.completed.push({gameKey:operation.spec.gameKey,appid:result.appid,created:result.created});record.pending=null;writeJSON(journal,record);
      if(result.created)added++;else updated++;
      onProgress({status:'syncing-steam',added,updated,total:operations.length});
    }
    record.status='complete';writeJSON(journal,record);
    return {status:'synced',added,updated,unchanged:specs.length-operations.length,backup};
  }finally{
    bridge?.close();fs.closeSync(fd);
    // An unknown mutation outcome needs review. Keep the lock/journal as evidence.
    if(!uncertain)fs.unlinkSync(lock);
  }
}
module.exports={syncLive,specsFor,workFor,launchKey};
