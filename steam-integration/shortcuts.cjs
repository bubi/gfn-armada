const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const vdf=require('./binary-vdf.cjs');
const {gameKey,validatedURL}=require('../launcher/mapping.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const TAG='gfn-armada:';
function crc32(text){let crc=0xffffffff;for(const byte of Buffer.from(text)){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function users(home=os.homedir()){
  const found=new Set();
  for(const relative of ['.local/share/Steam/userdata','.steam/root/userdata','.steam/steam/userdata','.var/app/com.valvesoftware.Steam/.local/share/Steam/userdata']){
    const root=path.join(home,relative);if(!fs.existsSync(root))continue;
    for(const name of fs.readdirSync(root))if(/^[1-9]\d*$/.test(name)&&fs.statSync(path.join(root,name)).isDirectory())found.add(fs.realpathSync(path.join(root,name)));
  }
  return [...found].sort();
}
function steamRunning(){
  if(process.platform==='linux'){
    // FEX may use its interpreter as comm; inspect argument basenames too.
    for(const pid of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){
      try{
        if(fs.statSync(`/proc/${pid}`).uid!==process.getuid())continue;
        const args=fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0');
        if(args.some(arg=>/^(steam|steamwebhelper|steam\.exe)$/.test(path.basename(arg))))return true;
      }catch(e){if(e.code!=='ENOENT'&&e.code!=='ESRCH')throw new Error('Cannot confirm that Steam is stopped');}
    }
    return false;
  }
  const r=spawnSync('pgrep',['-x','steam|steam_osx|steamwebhelper|Steam'],{encoding:'utf8'});
  if(r.error||![0,1].includes(r.status))throw new Error('Cannot confirm that Steam is stopped');
  return r.status===0;
}
function selectedUser(user){
  if(user){const resolved=fs.realpathSync(user);if(!fs.statSync(resolved).isDirectory())throw new Error('Steam user must be a directory');return resolved;}
  const choices=users();if(choices.length!==1)throw new Error(`Select a Steam user with --steam-user; found ${choices.length}`);return choices[0];
}
function readFile(file){
  if(!fs.existsSync(file))return null;
  if(fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile())throw new Error('Steam shortcuts file must be a regular file');
  if(fs.statSync(file).size>16*1024*1024)throw new Error('Steam shortcuts file too large');
  return fs.readFileSync(file);
}
function identifier(rows){const tags=vdf.get(rows,'tags');if(!tags)return null;if(tags.type!==0)throw new Error('Invalid Steam shortcut tags');const ids=tags.value.filter(r=>r.type===1&&r.value.startsWith(TAG)).map(r=>r.value.slice(TAG.length));if(ids.length>1)throw new Error('Ambiguous managed Steam shortcut');return ids[0]||null;}
function appImage(file){
  const fd=fs.openSync(file,'r'),header=Buffer.alloc(11);
  try{return fs.readSync(fd,header,0,header.length,0)===header.length&&header.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46]))&&header.subarray(8,11).equals(Buffer.from([0x41,0x49,2]));}
  finally{fs.closeSync(fd);}
}
function clientLaunchPrefix(shortcuts,executable){
  const prefixes=new Set();
  // Reuse only known compatibility settings from a client-only shortcut for
  // this exact executable. Allow the exact ArmadaOS launcher wrapper; never copy arbitrary commands.
  const pattern=/^((?:GFN_ARMADA_(?:GAMESCOPE=nested|BROWSER_IDENTITY=(?:windows|macos|chromeos|linux)|HEVC_EXPERIMENT=[01])\s+)*)(\/usr\/libexec\/armada\/armada-game-launch\s+)?%command%\s+(?:--appimage-extract-and-run\s+)?launch\s*$/;
  for(const entry of shortcuts){
    const exe=vdf.get(entry.value,'exe'),options=vdf.get(entry.value,'LaunchOptions');
    if(exe?.type!==1||exe.value!==`"${executable}"`||options?.type!==1)continue;
    const match=pattern.exec(options.value);if(!match)continue;
    const assignments=match[1].trim().split(/\s+/).filter(Boolean);
    if(new Set(assignments.map(x=>x.split('=')[0])).size!==assignments.length)throw new Error('Duplicate client compatibility setting');
    const wrapper=match[2]?'/usr/libexec/armada/armada-game-launch ':'';
    if(assignments.length||wrapper)prefixes.add((assignments.length?assignments.join(' ')+' ':'')+wrapper+'%command% ');
  }
  if(prefixes.size>1)throw new Error('Conflicting GFN client launch settings; reconcile client shortcuts before sync');
  return [...prefixes][0]||'';
}
function launchKey(options){
  if(typeof options!=='string')return null;
  const pattern=/^(?:(?:GFN_ARMADA_(?:GAMESCOPE=nested|BROWSER_IDENTITY=(?:windows|macos|chromeos|linux)|HEVC_EXPERIMENT=[01])\s+)*(?:\/usr\/libexec\/armada\/armada-game-launch\s+)?%command%\s+)?(?:--appimage-extract-and-run\s+)?launch ((?:gfn|steam|epic|gog|xbox):[A-Za-z0-9._-]{1,128})\s*$/;
  return pattern.exec(options)?.[1]||null;
}
function plan(rows,{user,executable}={}){
  if(!executable||!path.isAbsolute(executable)||/[\r\n\0"]/.test(executable))throw new Error('Steam requires an absolute executable path without quotes');
  fs.accessSync(executable,fs.constants.X_OK);
  const directory=selectedUser(user),file=path.join(directory,'config/shortcuts.vdf');
  const original=readFile(file),tree=original?vdf.decode(original):[{type:0,key:'shortcuts',value:[]}];
  const collection=vdf.get(tree,'shortcuts');if(!collection||collection.type!==0)throw new Error('Invalid Steam shortcuts root');
  const shortcuts=collection.value,managed=new Map(),appids=new Set(),indices=new Set();
  const runtimeOptions=appImage(executable)?'--appimage-extract-and-run ':'';
  for(const entry of shortcuts){
    if(entry.type!==0||!/^\d+$/.test(entry.key))throw new Error('Invalid Steam shortcut entry');
    const index=Number(entry.key);if(!Number.isSafeInteger(index)||index>100000||indices.has(index))throw new Error('Invalid or duplicate Steam shortcut index');indices.add(index);
    const tagged=identifier(entry.value),exe=vdf.get(entry.value,'exe'),options=vdf.get(entry.value,'LaunchOptions');
    const id=tagged||(exe?.type===1&&exe.value===`"${executable}"`?launchKey(options?.value):null);if(id){if(managed.has(id))throw new Error('Duplicate managed shortcut');managed.set(id,entry.value);}
    const appid=vdf.get(entry.value,'appid');if(appid){if(appid.type!==2)throw new Error('Invalid Steam AppID field');const n=appid.value.readUInt32LE();if(appids.has(n))throw new Error('Duplicate Steam shortcut AppID');appids.add(n);}
    if(id&&!appid)throw new Error('Managed shortcut missing AppID');
  }
  const prefix=clientLaunchPrefix(shortcuts,executable);
  const changes=[],skipped=[];let index=shortcuts.reduce((n,e)=>Math.max(n,Number(e.key)+1),0);
  const keys=new Set(),usedFields=new Set();
  for(const row of rows){
    const key=gameKey(row);validatedURL(row.launchURL);if(keys.has(key))throw new Error('Duplicate game mapping');keys.add(key);
    if(typeof row.name!=='string'||!row.name||/[\r\n\0]/.test(row.name))throw new Error('Invalid game name');
    for(const flag of ['bookmarked','owned'])if(row[flag]!==undefined&&typeof row[flag]!=='boolean')throw new Error(`${flag} must be boolean`);
    if(row.bookmarked!==true||row.owned!==true){skipped.push({gameKey:key,reason:'bookmark-and-ownership-not-both-confirmed'});continue;}
    const name=`${row.name} (GFN · ${(row.store||key.split(':')[0]).toUpperCase()})`;
    const exe=`"${executable}"`,launch=`${prefix}${runtimeOptions}launch ${key}`;
    const alias=row.storeGameId?`${row.store}:${row.storeGameId}`:row.steamAppId?`steam:${row.steamAppId}`:null;
    if(managed.has(key)&&alias&&managed.has(alias)&&managed.get(key)!==managed.get(alias))throw new Error('Ambiguous existing catalog shortcut');
    let fields=managed.get(key)||(alias?managed.get(alias):null);const existing=Boolean(fields);
    if(fields){if(usedFields.has(fields))throw new Error('Ambiguous catalog shortcut alias');usedFields.add(fields);}
    if(!fields){
      fields=[];const appid=(crc32(exe+name)|0x80000000)>>>0;
      if(appids.has(appid))throw new Error('Steam shortcut AppID collision');appids.add(appid);
      vdf.set(fields,'appid',2,vdf.uint32(appid));
      for(const [field,value] of Object.entries({IsHidden:0,AllowDesktopConfig:1,AllowOverlay:1,OpenVR:0,Devkit:0,DevkitOverrideAppID:0,LastPlayTime:0}))vdf.set(fields,field,2,vdf.uint32(value));
      for(const field of ['icon','ShortcutPath','DevkitGameID','FlatpakAppID'])vdf.set(fields,field,1,'');
      vdf.set(fields,'tags',0,[{type:1,key:'0',value:TAG+key},{type:1,key:'1',value:'GeForce NOW'}]);
      shortcuts.push({type:0,key:String(index++),value:fields});
    }
    const before=vdf.encode(fields);
    if(existing){
      let tags=vdf.get(fields,'tags');if(!tags){vdf.set(fields,'tags',0,[]);tags=vdf.get(fields,'tags');}
      if(tags.type!==0)throw new Error('Invalid Steam shortcut tags');
      const tag=tags.value.find(r=>r.type===1&&r.value.startsWith(TAG));
      if(tag){if(row.mappingSource==='gfn-catalog')tag.value=TAG+key;}
      else {const index=tags.value.reduce((n,r)=>/^\d+$/.test(r.key)?Math.max(n,Number(r.key)+1):n,0);tags.value.push({type:1,key:String(index),value:TAG+key});}
    }
    vdf.set(fields,'appname',1,name);vdf.set(fields,'exe',1,exe);vdf.set(fields,'StartDir',1,`"${path.dirname(executable)}"`);vdf.set(fields,'LaunchOptions',1,launch);
    if(!existing||!before.equals(vdf.encode(fields)))changes.push({action:existing?'update':'add',gameKey:key,name,launchOptions:launch,shortcutAppId:vdf.get(fields,'appid').value.readUInt32LE()});
  }
  const output=vdf.encode(tree);
  return {file,original,output,changes,skipped,changed:changes.length>0};
}
function publicPlan(p){return {mode:'review-only',steamFilesModified:false,file:p.file,changes:p.changes,skipped:p.skipped,removals:[],note:'Ownership/bookmark flags are imported assertions, not independently verified account data. Unselected or unknown games are retained.'};}
function replace(file,bytes){
  const tmp=file+'.tmp-'+crypto.randomUUID();let fd;
  try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(tmp,file);}finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
function apply(p,{isSteamRunning=steamRunning}={}){
  if(isSteamRunning())throw new Error('Close Steam before applying shortcuts');
  if(!p.changed)return {...publicPlan(p),mode:'apply',steamFilesModified:false};
  fs.mkdirSync(path.dirname(p.file),{recursive:true,mode:0o700});
  const lock=p.file+'.gfn-armada.lock';const fd=fs.openSync(lock,'wx',0o600);
  try{
    const current=readFile(p.file);if((current===null)!==(p.original===null)||(current&&!current.equals(p.original)))throw new Error('Steam shortcuts changed after review; retry');
    const backup=p.file+'.gfn-armada-backup-'+Date.now()+'-'+crypto.randomUUID();
    fs.writeFileSync(backup,p.original||Buffer.alloc(0),{flag:'wx',mode:0o600});
    fs.writeFileSync(backup+'.json',JSON.stringify({schemaVersion:1,file:p.file,originalExists:p.original!==null,beforeSha256:hash(p.original||Buffer.alloc(0)),afterSha256:hash(p.output)},null,2)+'\n',{flag:'wx',mode:0o600});
    if(isSteamRunning())throw new Error('Steam started during sync; no shortcuts were written');
    replace(p.file,p.output);
    return {...publicPlan(p),mode:'apply',steamFilesModified:true,backup};
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function restore(backup,{isSteamRunning=steamRunning}={}){
  if(isSteamRunning())throw new Error('Close Steam before restoring shortcuts');
  const metadata=JSON.parse(fs.readFileSync(backup+'.json','utf8'));
  if(metadata.schemaVersion!==1||typeof metadata.originalExists!=='boolean'||!path.isAbsolute(metadata.file)||!backup.startsWith(metadata.file+'.gfn-armada-backup-'))throw new Error('Invalid Steam backup metadata');
  const bytes=readFile(backup);if(!bytes||hash(bytes)!==metadata.beforeSha256)throw new Error('Steam backup checksum mismatch');
  const lock=metadata.file+'.gfn-armada.lock',fd=fs.openSync(lock,'wx',0o600);
  try{
    const current=readFile(metadata.file);if(!current||hash(current)!==metadata.afterSha256)throw new Error('Steam shortcuts changed since sync; automatic restore refused');
    if(isSteamRunning())throw new Error('Steam started during restore');
    if(metadata.originalExists)replace(metadata.file,bytes);else fs.unlinkSync(metadata.file);
    return {restored:true,file:metadata.file};
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
module.exports={plan,publicPlan,apply,restore,users,steamRunning,crc32,launchKey,clientLaunchPrefix,appImage};
