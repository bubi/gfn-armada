const {attachCatalogImport}=require('./catalog-import.cjs');
const {syncLive}=require('../steam-integration/live-sync.cjs');
const {readMappings}=require('../launcher/mapping.cjs');
function shouldImport(request,config){
  return request.command==='library'||(config.steam_integration===true&&['launch','login'].includes(request.command)&&!request.target);
}
function attachLibrarySync(contents,{request,config,fetch,file,state,executable,report=()=>{},attach=attachCatalogImport,sync=syncLive,mappings=()=>readMappings(file)}={}){
  if(!shouldImport(request,config))return ()=>{};
  const controller=new AbortController();let closed=false,imported=false;
  const dispose=attach(contents,{fetch,file,onProgress:data=>{if(!closed)report({phase:'catalog',...data})},
    onError:()=>{if(!closed)report({phase:'catalog',status:'failed',reason:'library-import-unavailable'})},
    onComplete:result=>{
      if(closed||imported)return;imported=true;
      report({phase:'catalog',status:'imported',...result});
      if(!config.steam_integration){report({phase:'steam',status:'disabled'});return;}
      if(!executable){report({phase:'steam',status:'pending',reason:'permanent-executable-required'});return;}
      report({phase:'steam',status:'connecting'});
      Promise.resolve().then(()=>{controller.signal.throwIfAborted();return sync(mappings(),{state,executable,signal:controller.signal,onProgress:data=>{if(!closed)report({phase:'steam',...data})}})}).then(result=>{
        if(!closed)report({phase:'steam',...result});
      }).catch(()=>{if(!closed)report({phase:'steam',status:'pending',reason:'live-steam-sync-unavailable'});});
    }
  });
  return ()=>{if(closed)return;closed=true;controller.abort();dispose();};
}
module.exports={shouldImport,attachLibrarySync};
