// Diagnostic only: synthetic local H.264 WebRTC, no NVIDIA session or profile.
// Pass Chromium logging switches on argv (before JavaScript startup).
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {loopback}=require('./fixtures/local-webrtc.cjs');
const {attachWebRTCInternals}=require('../client/webrtc-internals.cjs');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-vaapi-local-'));
app.setPath('userData',profile);
app.commandLine.appendSwitch('hardware-video-device-path',process.env.GFN_ARMADA_VAAPI||'/dev/dri/renderD128');
app.commandLine.appendSwitch('enable-features','VaapiVideoDecoder,VaapiVideoDecodeLinuxGL');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
let window,dispose;
const samples=[];
app.whenReady().then(async()=>{
  dispose=attachWebRTCInternals(BrowserWindow,data=>{
    if(data?.status==='sampled'&&data.streams?.length) samples.push(data);
  });
  window=new BrowserWindow({width:960,height:600,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
  await window.loadURL('data:text/html,<title>Local VA-API probe</title>');
  await window.webContents.executeJavaScript(`(${loopback.toString()})({width:1280,height:720,fixedResolution:true,onVideoReceiver:r=>window.probeReceiver=r})`);
  await new Promise(r=>setTimeout(r,15000));
  const streams=await window.webContents.executeJavaScript(`(async()=>{const s=await window.probeReceiver.getStats();return [...s.values()].filter(x=>x.type==='inbound-rtp'&&x.kind==='video').map(x=>({decoder:x.decoderImplementation||'unknown',powerEfficient:x.powerEfficientDecoder??null,framesDecoded:x.framesDecoded,framesDropped:x.framesDropped,codec:s.get(x.codecId)?.mimeType||'unknown'}))})()`);
  console.log(JSON.stringify({probe:'vaapi-local',streams,nativeDecoderSamples:samples,gpuFeatures:app.getGPUFeatureStatus(),hardwareValidated:false,note:'Synthetic stream only; inspect decoder report and driver submissions, not advertised capabilities.'}));
  dispose?.();
  window.destroy();app.exit(0);
}).catch(e=>{console.error(JSON.stringify({probe:'vaapi-local',error:e.message}));app.exit(1)});
app.on('quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
setTimeout(()=>app.exit(2),30000).unref();
