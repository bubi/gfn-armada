// Serialized into Steam's own local library context, never into the GFN page.
async function steamOperation(input){
  const apps=globalThis.SteamClient?.Apps,store=globalThis.appStore;
  const required=['AddShortcut','SetShortcutName','SetShortcutExe','SetShortcutStartDir','SetShortcutLaunchOptions','RegisterForAppDetails'];
  if(!apps||required.some(k=>typeof apps[k]!=='function')||typeof store?.m_mapApps?.keys!=='function'||typeof store.GetAppOverviewByAppID!=='function')return {status:'unavailable'};
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const ids=()=>[...store.m_mapApps.keys()].map(Number).filter(id=>Number.isInteger(id)&&id>=0x80000000&&id<=0xffffffff);
  function details(id,accept=()=>true){
    return new Promise(resolve=>{
      let handle,done=false,timer;
      const finish=value=>{if(done)return;done=true;clearTimeout(timer);handle?.unregister?.();resolve(value)};
      timer=setTimeout(()=>finish(null),2500);
      try{handle=apps.RegisterForAppDetails(id,value=>{if(value&&Number(value.unAppID)===id&&accept(value))finish(value)});if(done)handle?.unregister?.();}
      catch{finish(null);}
    });
  }
  const fields=(id,d)=>({appid:id,name:d.strDisplayName,exe:d.strShortcutExe,startDir:d.strShortcutStartDir,launchOptions:d.strShortcutLaunchOptions});
  if(input.kind==='inventory'){
    const all=ids();if(all.length>512)return {status:'too-many-shortcuts'};
    const rows=[];let offset=0,failed=false;
    await Promise.all(Array.from({length:Math.min(8,all.length)},async()=>{
      while(offset<all.length){const id=all[offset++],d=await details(id);if(!d){failed=true;continue;}
        // Only return this exact GFN executable. Other account/game data stays in Steam.
        if(d.strShortcutExe===input.exe)rows.push(fields(id,d));
      }
    }));
    return failed?{status:'inventory-incomplete'}:{status:'ready',rows};
  }
  if(input.kind!=='put')return {status:'invalid-operation'};
  const spec=input.spec;let id=input.appid,created=false;
  try{
    if(id){
      const d=await details(id);
      if(!d||d.strShortcutExe!==spec.exe||!input.allowedOptions.includes(d.strShortcutLaunchOptions))return {status:'stale-shortcut'};
    }else{
      const before=new Set(ids());
      const value=Number(await apps.AddShortcut(spec.name,spec.exe,'',''));
      if(!Number.isInteger(value)||value===0||value< -0x80000000||value>0xffffffff)return {status:'add-failed'};
      id=value>>>0;
      if(id<0x80000000||before.has(id))return {status:'unexpected-appid'};
      created=true;
      const end=Date.now()+4000;
      while(!store.GetAppOverviewByAppID(id)&&Date.now()<end)await sleep(100);
      if(!store.GetAppOverviewByAppID(id))return {status:'overview-timeout',appid:id,created};
    }
    apps.SetShortcutName(id,spec.name);
    apps.SetShortcutExe(id,spec.exe);
    apps.SetShortcutStartDir(id,spec.startDir);
    apps.SetShortcutLaunchOptions(id,spec.launchOptions);
    const verified=await details(id,d=>d.strDisplayName===spec.name&&d.strShortcutExe===spec.exe&&d.strShortcutStartDir===spec.startDir&&d.strShortcutLaunchOptions===spec.launchOptions);
    return {status:verified?'verified':'verification-failed',appid:id,created};
  }catch{return {status:'failed',...(id?{appid:id}:{}),created};}
}
module.exports={steamOperation};
