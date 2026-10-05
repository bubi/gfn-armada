const {sessionContext,readCatalog,importCatalog,catalogURL}=require('../launcher/catalog.cjs');
function attachCatalogImport(contents,{fetch,onProgress=()=>{},onComplete=()=>{},onError=()=>{},file}={}){
  const controller=new AbortController();let busy=false,done=false;
  const debuggerApi=contents.debugger;
  const pending=new Map(),extra=new Map();
  onProgress({status:'waiting-for-gfn-login'});
  function attempt(request){
    if(busy||done||controller.signal.aborted)return;
    const context=sessionContext(request);if(!context)return;
    busy=true;onProgress({status:'reading'});
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]);
    readCatalog(context,fetch,{signal,onProgress}).then(snapshot=>{
      if(controller.signal.aborted)return;
      const result=importCatalog(snapshot,file);done=true;onComplete(result);
    }).catch(()=>{if(!controller.signal.aborted){done=true;onError({status:'failed',message:'GFN library read failed. Existing mappings retained. Sign in and retry library; no Steam files were changed.'});}}).finally(()=>{context.headers={};pending.clear();extra.clear();});
  }
  function message(_event,method,params){
    if(done||busy)return;
    if(method==='Network.requestWillBeSent'&&catalogURL(params.request?.url)){
      if(pending.size>128)pending.clear();pending.set(params.requestId,params.request);attempt({...params.request,headers:{...params.request.headers,...extra.get(params.requestId)}});
    }else if(method==='Network.requestWillBeSentExtraInfo'){
      const request=pending.get(params.requestId);if(request)attempt({...request,headers:{...request.headers,...params.headers}});
      else if(Object.entries(params.headers||{}).some(([key,value])=>key.toLowerCase()==='authorization'&&typeof value==='string'&&value.startsWith('GFNJWT '))){if(extra.size>128)extra.clear();extra.set(params.requestId,params.headers);}
    }
  }
  function detached(){if(!done&&!controller.signal.aborted){controller.abort();pending.clear();extra.clear();onError({status:'detached',message:'Catalog observation stopped. Close the client and retry library without opening DevTools.'});}}
  try{if(!debuggerApi.isAttached())debuggerApi.attach('1.3');debuggerApi.on('message',message);debuggerApi.on('detach',detached);debuggerApi.sendCommand('Network.enable').catch(()=>onError({status:'unavailable',message:'Catalog observation unavailable'}));}
  catch{onError({status:'unavailable',message:'Catalog observation unavailable'});}
  return ()=>{controller.abort();pending.clear();extra.clear();debuggerApi.removeListener('message',message);debuggerApi.removeListener('detach',detached);};
}
module.exports={attachCatalogImport};
