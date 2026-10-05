// Diagnostic entry point, not a product path. It exists because Chromium
// initialises logging before the app's JavaScript runs, so --vmodule only
// takes effect from argv; the launcher deliberately rejects arbitrary runtime
// flags, and this entry ignores argv so the switches can be passed directly.
//
// It opens one real GFN stream with the production preload and session
// partition and reports the decoder through the client's own chrome://
// WebRTC stats module, which is the mechanism already proven in the client.
// It changes no configuration and writes nothing outside its report.
const {app,BrowserWindow,session}=require('electron');
const path=require('node:path');
const {paths}=require('../launcher/config.cjs');
const {allowed}=require('../client/navigation.cjs');
const {attachWebRTCInternals,softwareDecodeStatus}=require('../client/webrtc-internals.cjs');
const url=process.env.GFN_ARMADA_PROBE_URL;
const seconds=Math.min(Math.max(Number(process.env.GFN_ARMADA_PROBE_SECONDS||120),10),600);
if(!url||!allowed(url)) {console.log(JSON.stringify({probe:'vaapi-stream',error:'GFN_ARMADA_PROBE_URL must be an allowed GFN URL'}));app.exit(1);}
else {
const root=paths();
app.setName('gfn-armada');
app.setPath('userData',path.join(root.data,'chromium'));
app.setPath('sessionData',path.join(root.data,'chromium'));
let window,dispose,done=false;
const samples=[];
function finish(extra={}){
  if(done) return;done=true;
  try{dispose?.();}catch{}
  const decoders=[...new Set(samples.flatMap(s=>s.streams.map(x=>x.decoder)).filter(Boolean))];
  const last=samples[samples.length-1]?.streams?.[0]||{};
  console.log(JSON.stringify({probe:'vaapi-stream',seconds,samples:samples.length,
    decodersSeen:decoders,
    hardware:decoders.length>0&&!decoders.some(d=>/FFmpeg|fallback|unknown/i.test(d)),
    lastCodec:last.codec??null,lastPowerEfficient:last.powerEfficientDecoder??null,
    framesDecoded:last.framesDecoded??null,framesDropped:last.framesDropped??null,
    softwareDecodeStatus:samples.length?softwareDecodeStatus(samples[samples.length-1]):'unknown',
    ...extra,
    note:'decoderImplementation is Chromium\'s own report; an advertised codec is not proof of hardware decode.'}));
  window?.destroy();app.exit(extra.error?1:0);
}
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  const ses=session.fromPartition('persist:gfn');
  ses.setPermissionRequestHandler((_wc,p,cb)=>cb(['fullscreen','pointerLock'].includes(p)));
  ses.setPermissionCheckHandler((_wc,p)=>['fullscreen','pointerLock'].includes(p));
  ses.setUserAgent(`Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`);
  window=new BrowserWindow({width:1280,height:720,backgroundColor:'#111111',webPreferences:{
    nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,
    preload:path.join(__dirname,'../client/preload.cjs'),partition:'persist:gfn',backgroundThrottling:false}});
  window.setMenu(null);
  window.webContents.on('will-navigate',(e,u)=>{if(!allowed(u)) e.preventDefault();});
  dispose=attachWebRTCInternals(BrowserWindow,data=>{
    if(data?.status==='sampled'&&Array.isArray(data.streams)&&data.streams.length) samples.push(data);
  });
  window.on('closed',()=>{try{dispose?.();}catch{}});
  await window.loadURL(url);
  const deadline=Date.now()+seconds*1000;
  while(Date.now()<deadline&&!done){
    await new Promise(r=>setTimeout(r,3000));
    // Stop early once a decoder name is settled and frames are flowing.
    const last=samples[samples.length-1]?.streams?.[0];
    if(last&&last.framesDecoded>120&&last.decoder&&last.decoder!=='unknown') break;
  }
  finish();
}).catch(error=>finish({error:error.message}));
setTimeout(()=>finish({error:'probe deadline'}),(seconds+60)*1000).unref?.();
}
