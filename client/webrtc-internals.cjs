// Native Chromium stats avoid the hardware-capability filter in page getStats.
// Keep raw WebUI records inside the trusted chrome:// page; export no SDP/URLs.
function nativeStatsEnabled(command,env=process.env) {
  return command!=='library'&&env.GFN_ARMADA_MEDIA_DIAGNOSTICS!=='0';
}
function videoReports(reports,previous=new Map()) {
  if(!Array.isArray(reports)) return [];
  const map=new Map(reports.filter(p=>Array.isArray(p)&&p.length===2));
  const result=[];
  const seen=new Set();
  for(const [id,s] of map) {
    if(!s||s.type!=='inbound-rtp'||s.kind!=='video') continue;
    const codec=map.get(s.codecId);
    const text=v=>typeof v==='string'&&v.length<=128?v:'unknown';
    const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
    const frames=number(s.framesDecoded),decodeTime=number(s.totalDecodeTime),timestamp=number(s.timestamp);
    const mime=text(codec?.mimeType),width=number(s.frameWidth),height=number(s.frameHeight);
    const old=previous.get(id);
    const comparable=old&&old.codec===mime&&old.width===width&&old.height===height&&
      timestamp!==null&&old.timestamp!==null&&timestamp>old.timestamp&&
      frames!==null&&old.frames!==null&&frames>old.frames&&
      decodeTime!==null&&old.decodeTime!==null&&decodeTime>=old.decodeTime;
    const average=(total,count)=>total!==null&&count>0?1000*total/count:null;
    result.push({codec:mime,decoder:text(s.decoderImplementation),
      powerEfficientDecoder:typeof s.powerEfficientDecoder==='boolean'?s.powerEfficientDecoder:null,
      framesDecoded:frames,framesDropped:number(s.framesDropped),
      totalDecodeTime:decodeTime,statsTimestamp:timestamp,
      frameWidth:width,frameHeight:height,framesPerSecond:number(s.framesPerSecond),
      meanDecodeMs:average(decodeTime,frames),
      intervalMeanDecodeMs:comparable?average(decodeTime-old.decodeTime,frames-old.frames):null,
      intervalFramesDecoded:comparable?frames-old.frames:null,
      intervalMs:comparable?timestamp-old.timestamp:null,
      meanJitterBufferMs:average(number(s.jitterBufferDelay),number(s.jitterBufferEmittedCount))});
    // Keep identifiers only inside chrome://webrtc-internals, never in output.
    seen.add(id);previous.set(id,{codec:mime,width,height,frames,decodeTime,timestamp});
    if(result.length===8) break;
  }
  for(const id of previous.keys())if(!seen.has(id))previous.delete(id);
  return result;
}
function softwareDecodeStatus(data) {
  if(data?.status!=='sampled'||!Array.isArray(data.streams)) return 'unknown';
  const active=data.streams.filter(s=>s.framesDecoded>0);
  // FFmpeg's software WebRTC decoder is known. Platform names or an efficiency
  // hint alone do not prove Qualcomm hardware, so never infer "yes" here.
  return active.length&&active.every(s=>s.decoder==='FFmpeg')?'no':'unknown';
}
async function installObserver(allowedOrigin,filter) {
  const {addWebUiListener}=await import('chrome://resources/js/cr.js');
  const {peerConnectionDataStore}=await import('chrome://webrtc-internals/dump_creator.js');
  window.__gfnArmadaNativeStats={status:'waiting',streams:[]};
  const latest=new Map();
  const history=new Map();
  addWebUiListener('add-standard-stats',data=>{
    const id=data.rid+'-'+data.lid;
    const record=peerConnectionDataStore[id]?.toJSON();
    try{if(new URL(record?.url).origin!==allowedOrigin) return}catch{return}
    if(!history.has(id))history.set(id,new Map());
    latest.set(id,{timestamp:Date.now(),streams:filter(data.reports,history.get(id))});
    const now=Date.now();
    const streams=[];
    for(const [key,value] of latest) {
      if(now-value.timestamp>15000){latest.delete(key);history.delete(key);continue}
      streams.push(...value.streams);
    }
    window.__gfnArmadaNativeStats={status:'sampled',timestamp:now,streams:streams.slice(0,8)};
  });
}
function attachWebRTCInternals(BrowserWindow,report,allowedOrigin='https://play.geforcenow.com') {
  const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,
    nodeIntegration:false,backgroundThrottling:false}});
  let timer,disposed=false,busy=false;
  const dispose=()=>{disposed=true;clearInterval(timer);if(!window.isDestroyed()) window.destroy()};
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',e=>e.preventDefault());
  window.loadURL('chrome://webrtc-internals').then(async()=>{
    if(disposed) return;
    await window.webContents.executeJavaScript(`(${installObserver.toString()})(${JSON.stringify(allowedOrigin)},${videoReports.toString()})`);
    if(disposed) return;
    report({status:'waiting',streams:[]});
    timer=setInterval(async()=>{
      if(disposed||busy) return;
      busy=true;
      try{
        const data=await window.webContents.executeJavaScript('window.__gfnArmadaNativeStats');
        if(!disposed&&data) report(data.timestamp&&Date.now()-data.timestamp>15000?
          {status:'stale',streams:[]}:data);
      }catch{if(!disposed) report({status:'unavailable',streams:[]})}
      finally{busy=false}
    },5000);
    timer.unref();
  }).catch(()=>{if(!disposed) report({status:'unavailable',streams:[]});dispose()});
  return dispose;
}
module.exports={nativeStatsEnabled,videoReports,softwareDecodeStatus,installObserver,attachWebRTCInternals};
