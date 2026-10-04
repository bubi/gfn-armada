// Separate Electron process. Native decoder FDs never enter the GFN process.
const {app,BrowserWindow,ipcMain,session,sharedTexture}=require('electron');
const {Worker}=require('node:worker_threads');
const path=require('node:path');
const {Socket}=require('node:net');
const {encode,Reader}=require('./helper-wire.cjs');
const profile=process.env.GFN_ARMADA_HELPER_PROFILE,addon=process.env.GFN_ARMADA_NATIVE_BRIDGE;
if(!profile||!path.isAbsolute(profile)||!addon||!path.isAbsolute(addon)) throw new Error('Helper paths required');
app.setPath('userData',profile);app.setPath('sessionData',profile);
const input=new Socket({fd:3,readable:true,writable:false}),output=new Socket({fd:4,readable:false,writable:true});
let worker,window,stopping=false,finished=false,closeTimer,exitTimer,sequence=0,inflightBytes=0,decoded=0,draws=0,released=0,lastFrameAt=null;
const leases=new Set(),pending=new Map();
let colorSpace=null;
const snapshot=()=>({decoded,draws,released,outstanding:leases.size,lastFrameAt,colorSpace});
function send(message){if(!finished) output.write(encode(message));}
function closeWindow(){clearTimeout(closeTimer);if(window&&!window.isDestroyed()) window.destroy();}
function finish(){
  if(finished) return;clearTimeout(exitTimer);closeWindow();
  send({kind:'closed',...snapshot()});finished=true;input.destroy();
  output.end(()=>app.exit(0));
}
function stop(){
  if(stopping) return;stopping=true;
  for(const id of pending.keys()) send({kind:'ack',sequence:id,accepted:false});pending.clear();inflightBytes=0;
  if(leases.size) closeTimer=setTimeout(closeWindow,1000);else closeWindow();
  if(worker) worker.postMessage({kind:'stop'});else finish();
  exitTimer=setTimeout(()=>app.exit(1),2500);
}
function fail(reason){send({kind:'failed',reason:String(reason).slice(0,300)});stop();}
output.on('error',()=>app.exit(1));input.on('error',()=>stop());input.on('end',()=>stop());
const reader=new Reader((message,bytes)=>{
  if(message.kind==='stop'){stop();return;}
  if(stopping) return;
  if(message.kind==='inspect'){
    if(process.env.GFN_ARMADA_HELPER_LOCAL_TEST!=='1'||!Number.isSafeInteger(message.id)||bytes.length) throw new Error('Inspection unavailable');
    window.webContents.executeJavaScript(`(()=>{
      const c=document.querySelector('canvas'),ctx=c.getContext('2d'),colors=[];
      for(let i=0;i<6;i++) colors.push([...ctx.getImageData(Math.floor((i+.5)*c.width/6),Math.floor(c.height/2),1,1).data].slice(0,3).map(n=>Math.round(n/32)).join(','));
      return {width:c.width,height:c.height,distinctColors:new Set(colors).size,validationReadback:true};
    })()`).then(value=>send({kind:'pixels',id:message.id,value})).catch(()=>fail('helper-inspection-failed'));return;
  }
  if(message.kind!=='push'||!worker||message.sequence!==sequence+1||typeof message.key!=='boolean'||
    !Number.isFinite(message.timestampUs)||message.timestampUs<0||message.timestampUs>9007199254740||
    bytes.length<4||bytes.length>2097152||bytes[0]!==0||bytes[1]!==0||!(bytes[2]===1||(bytes[2]===0&&bytes[3]===1))) throw new Error('Invalid helper packet');
  if(pending.size>=8||inflightBytes+bytes.length>4194304) throw new Error('Helper compressed queue overflow');
  sequence++;pending.set(sequence,bytes.length);inflightBytes+=bytes.length;
  worker.postMessage({kind:'push',sequence,bytes,timestampUs:message.timestampUs,key:message.key});
});
input.on('data',chunk=>{try{reader.feed(chunk);}catch(error){fail(error.message);}});
app.on('window-all-closed',()=>{});
app.on('before-quit',()=>stop());
// The supervisor owns the temporary profile and removes it after child exit.
// Do not delete Chromium's profile synchronously while its processes exit.
app.whenReady().then(async()=>{
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('file://')}));
  window=new BrowserWindow({show:false,width:960,height:600,title:'gfn-armada — isolated native H264 shadow',webPreferences:{
    sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,preload:path.join(__dirname,'shadow-preload.cjs')
  }});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',e=>e.preventDefault());
  window.webContents.on('render-process-gone',()=>fail('helper-renderer-gone'));
  window.on('closed',()=>stop());
  const ready=new Promise(resolve=>ipcMain.once('native-shadow-ready',event=>{if(event.sender===window.webContents) resolve();}));
  ipcMain.on('native-shadow-draw',(event,data)=>{
    if(event.sender===window.webContents&&Number.isSafeInteger(data?.frames)){draws=data.frames;}
  });
  await window.loadFile(path.join(__dirname,'shadow.html'));await ready;
  window.showInactive();
  await app.getGPUInfo('complete');
  for(let n=0;n<50&&!stopping&&app.getGPUFeatureStatus().gpu_compositing!=='enabled';n++) await new Promise(resolve=>setTimeout(resolve,100));
  if(stopping) return;
  if(app.getGPUFeatureStatus().gpu_compositing!=='enabled') throw new Error('Helper GPU compositing unavailable');
  worker=new Worker(path.join(__dirname,'native-decoder-worker.cjs'),{workerData:{addon}});
  worker.on('error',()=>fail('helper-native-worker-failed'));
  worker.on('exit',()=>{if(!stopping) fail('helper-native-worker-exited');});
  worker.on('message',async message=>{
    if(message.kind==='ready'){send({kind:'ready'});}
    else if(message.kind==='ack'){
      if(pending.has(message.sequence)){inflightBytes-=pending.get(message.sequence);pending.delete(message.sequence);send(message);}
    }else if(message.kind==='failed') fail(message.reason);
    else if(message.kind==='closed') finish();
    else if(message.kind==='opened') send({kind:'opened',device:message.device});
    else if(message.kind==='frame'){
      leases.add(message.leaseId);let imported;
      const release=()=>{if(leases.delete(message.leaseId)){worker.postMessage({kind:'release',id:message.leaseId});released++;if(stopping&&!leases.size) closeWindow();}};
      if(stopping){release();return;}
      try{
        const c=message.textureInfo.colorSpace;
        colorSpace={matrix:c.matrix,primaries:c.primaries,transfer:c.transfer,range:c.range};
        imported=sharedTexture.importSharedTexture({textureInfo:message.textureInfo,allReferencesReleased:release});
        await sharedTexture.sendSharedTexture({frame:window.webContents.mainFrame,importedSharedTexture:imported});
        decoded++;lastFrameAt=new Date().toISOString();
        if(decoded%30===0) send({kind:'stats',...snapshot()});
      }catch{if(!imported) release();fail('helper-texture-transfer-failed');}
      finally{imported?.release();}
    }
  });
  // Small control snapshots contain counters only, never FDs or pixels.
  const stats=setInterval(()=>{if(!finished) send({kind:'stats',...snapshot()});},100);
  app.once('quit',()=>clearInterval(stats));
}).catch(error=>fail(error.message));
