const {Worker}=require('node:worker_threads');
const path=require('node:path');
const {installEncodedTap}=require('./encoded-tap.cjs');
const {packet,rtpDelta}=require('./encoded-packet.cjs');
function attachNativeShadow({app,BrowserWindow,ipcMain,sharedTexture,source,addon,report,localTest=false}) {
  if(process.platform!=='linux' || process.arch!=='arm64' || !path.isAbsolute(addon)) throw new Error('Native shadow requires Linux ARM64 and an absolute addon path');
  let worker,window,stopped=false,generation,sequence=0,inflight=0,previous,pts=0,decoded=0,draws=0,released=0,lastFrameAt=null;
  const leases=new Set(),acknowledgements=new Map();
  const trusted=event=>{
    try{return event.sender===source && event.senderFrame===source.mainFrame &&
      (new URL(event.senderFrame.url).origin==='https://play.geforcenow.com');}catch{return false;}
  };
  const evidence=(status,reason)=>report({status,reason,timestamp:new Date().toISOString(),lastFrameAt,mode:'parallel-shadow',codec:'H264',
    encodedFrames:sequence,decodedTransfers:decoded,rendererDraws:draws,releasedSamples:released,outstanding:leases.size,
    originalBrowserDecodeEnabled:true,hardwareDecoderActive:'unknown'});
  function stop(reason='stopped') {
    if(stopped) return; stopped=true;
    for(const resolve of acknowledgements.values()) resolve(false);acknowledgements.clear();
    if(window&&!window.isDestroyed()) window.destroy();
    worker?.postMessage({kind:'stop'});evidence('stopped',reason);
  }
  async function start() {
    window=new BrowserWindow({width:960,height:600,title:'gfn-armada — native H264 shadow',webPreferences:{
      sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,preload:path.join(__dirname,'shadow-preload.cjs')
    }});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',e=>e.preventDefault());
    window.on('closed',()=>stop('shadow-window-closed'));
    const ready=new Promise(resolve=>{
      const handler=event=>{if(event.sender===window.webContents){ipcMain.removeListener('native-shadow-ready',handler);resolve();}};
      ipcMain.on('native-shadow-ready',handler);
      window.once('closed',()=>ipcMain.removeListener('native-shadow-ready',handler));
    });
    await window.loadFile(path.join(__dirname,'shadow.html'));await ready;
    await app.getGPUInfo('complete');
    for(let n=0;n<50 && !stopped;n++){
      if(app.getGPUFeatureStatus().gpu_compositing==='enabled') break;
      await new Promise(r=>setTimeout(r,100));
    }
    if(stopped) throw new Error('Shadow stopped during startup');
    if(app.getGPUFeatureStatus().gpu_compositing!=='enabled') throw new Error('Shadow GPU compositing unavailable');
    worker=new Worker(path.join(__dirname,'native-decoder-worker.cjs'),{workerData:{addon}});
    worker.on('error',()=>stop('native-worker-failed'));
    worker.on('exit',code=>{if(!stopped) stop(code?'native-worker-exited':'native-worker-closed')});
    worker.on('message',async message=>{
      if(message.kind==='ack'){
        acknowledgements.get(message.sequence)?.(message.accepted);acknowledgements.delete(message.sequence);
      } else if(message.kind==='failed') {report({status:'native-error',reason:message.reason});stop('native-decoder-failed');}
      else if(message.kind==='closed'){evidence('closed');}
      else if(message.kind==='opened') report({status:'native-opened',codec:'H264',device:message.device,hardwareDecoderActive:'unknown'});
      else if(message.kind==='frame') {
        leases.add(message.leaseId);
        let imported;
        const release=()=>{if(leases.delete(message.leaseId)){worker.postMessage({kind:'release',id:message.leaseId});released++;}};
        if(stopped){release();return;}
        try{
          imported=sharedTexture.importSharedTexture({textureInfo:message.textureInfo,allReferencesReleased:release});
          await sharedTexture.sendSharedTexture({frame:window.webContents.mainFrame,importedSharedTexture:imported});
          decoded++;lastFrameAt=new Date().toISOString();if(decoded%30===0) evidence('transferring');
        }catch{if(!imported) release();stop('texture-transfer-failed');}
        finally{imported?.release();}
      }
    });
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{cleanup();reject(new Error('Native worker readiness timeout'));},5000);
      const onReady=message=>{if(message.kind==='ready'){cleanup();resolve();}};
      const onError=()=>{cleanup();reject(new Error('Native addon unavailable'));};
      const cleanup=()=>{clearTimeout(timeout);worker.removeListener('message',onReady);worker.removeListener('error',onError);};
      worker.on('message',onReady);worker.once('error',onError);
    });
  }
  let starting;
  ipcMain.handle('native-shadow-bootstrap',async event=>{
    if(!trusted(event) || stopped) return null;
    starting ||= start();await starting;
    return !stopped?`(${installEncodedTap.toString()})()`:null;
  });
  ipcMain.handle('native-shadow-packet',async(event,data)=>{
    if(!trusted(event) || stopped) return false;
    if(inflight>=4){stop('ipc-queue-overflow');return false;}
    try{
      const p=packet(data,sequence+1);
      if(generation && p.generation!==generation) throw new Error('Receiver generation changed');
      if(!generation){if(!p.key) throw new Error('Initial keyframe required');generation=p.generation;}
      sequence++;inflight++;
      starting ||= start();await starting;if(stopped) return false;
      if(previous!==undefined) pts+=rtpDelta(previous,p.timestamp);previous=p.timestamp;
      return await new Promise(resolve=>{
        acknowledgements.set(p.sequence,resolve);
        worker.postMessage({kind:'push',sequence:p.sequence,bytes:p.bytes,timestampUs:pts,key:p.key});
      });
    }catch{stop('invalid-packet-or-startup-failed');return false;}
    finally{inflight=Math.max(0,inflight-1);}
  });
  const onDraw=(event,data)=>{
    if(window&&!window.isDestroyed() && event.sender===window.webContents && Number.isSafeInteger(data?.frames)) draws=data.frames;
  };
  const onStatus=(event,reason)=>{
    if(trusted(event) && ['negotiated-codec-not-h264','encoded-transform-unavailable','worker-unavailable-or-csp-blocked'].includes(reason)){stop(reason);return;}
    if(trusted(event) && ['hook-installed','attached-encoded-shadow','negotiated-h264','encoded-frame-observed','waiting-inband-parameter-sets','negotiated-codec-not-h264','existing-transform-preserved','encoded-transform-unavailable','worker-unavailable-or-csp-blocked','keyframe-request-unavailable'].includes(reason)) report({status:reason,hardwareDecoderActive:'unknown'});
    else if(trusted(event)) stop('encoded-tap-ended-or-overloaded');
  };
  ipcMain.on('native-shadow-draw',onDraw);ipcMain.on('native-shadow-status',onStatus);
  let initialNavigation=true;
  const navigation=(_e,_url,inPlace,isMain)=>{
    if(isMain&&!inPlace){if(initialNavigation) initialNavigation=false;else stop('source-navigation');}
  };
  // Registered after initial load begins by caller; preload installs independently.
  source.on('render-process-gone',()=>stop('source-renderer-gone'));
  source.on('did-start-navigation',navigation);source.once('destroyed',()=>stop('source-destroyed'));
  return {prepare:()=>{starting ||= start();return starting;},stop,snapshot:()=>({sequence,decoded,draws,released,outstanding:leases.size,stopped}),inspectTestOutput:async()=>{
    if(!localTest) throw new Error('Pixel readback is restricted to the local test');
    return window.webContents.executeJavaScript(`(()=>{
      const c=document.querySelector('canvas'),ctx=c.getContext('2d'),colors=[];
      for(let i=0;i<6;i++) colors.push([...ctx.getImageData(Math.floor((i+.5)*c.width/6),Math.floor(c.height/2),1,1).data].slice(0,3).map(n=>Math.round(n/32)).join(','));
      return {width:c.width,height:c.height,distinctColors:new Set(colors).size,validationReadback:true};
    })()`);
  },dispose:()=>{
    stop('disposed');ipcMain.removeHandler('native-shadow-bootstrap');ipcMain.removeHandler('native-shadow-packet');
    ipcMain.removeListener('native-shadow-draw',onDraw);ipcMain.removeListener('native-shadow-status',onStatus);
    source.removeListener('did-start-navigation',navigation);
  }};
}
module.exports={attachNativeShadow};
