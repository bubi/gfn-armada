// Real local WebRTC + production preload. Mac tests the tap; ARM64 can test Iris.
const {app,BrowserWindow,ipcMain,session,sharedTexture}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {loopback}=require('./fixtures/local-webrtc.cjs');
const {installEncodedTap}=require('../client/encoded-tap.cjs');
const {packet}=require('../client/encoded-packet.cjs');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-native-bridge-'));
app.setPath('userData',profile);
if(process.platform==='linux') app.commandLine.appendSwitch('ozone-platform','wayland');
let shadow,window,encoded=0,finishing=false,overflow=false,originalFrames=0;
const native=Boolean(process.env.GFN_ARMADA_NATIVE_BRIDGE);
const backpressure=process.env.GFN_ARMADA_TEST_BACKPRESSURE==='1';
const blockedWorker=process.env.GFN_ARMADA_TEST_BLOCK_WORKER==='1';
const durationMs=Number(process.env.GFN_ARMADA_TEST_DURATION_MS||0);
if(!Number.isSafeInteger(durationMs)||durationMs<0||durationMs>60000) throw new Error('Invalid test duration');
const fixedResolution=process.env.GFN_ARMADA_TEST_FIXED_RESOLUTION==='1';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>finish(new Error('Bridge deadline exceeded')),durationMs+30000);
async function finish(error,extra={}){
  if(finishing) return;finishing=true;clearTimeout(deadline);
  shadow?.stop('test-finished');
  for(let n=0;n<100 && shadow?.snapshot().outstanding;n++) await sleep(20);
  const state=shadow?.snapshot();
  if(state?.outstanding) error ||=new Error('Samples remain leased');
  shadow?.dispose();window?.destroy();
  console.log(JSON.stringify({status:error?'failed':'passed',scope:native?'local-webrtc-h264-iris-shadow':'encoded-tap-only',nativeTested:native,encoded,originalFrames,...state,...extra,...(error?{error:error.message}:{})}));
  app.exit(error?1:0);
}
app.on('window-all-closed',()=>{});
app.on('quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
app.whenReady().then(async()=>{
  // Local response under the production origin; no network request or NVIDIA login.
  await session.defaultSession.protocol.handle('https',request=>new Response(
    request.url==='https://play.geforcenow.com/local-test'?'<meta charset="utf-8"><title>Local native bridge test</title>':'',
    {status:request.url==='https://play.geforcenow.com/local-test'?200:404,headers:{'Content-Type':'text/html',...(blockedWorker?{'Content-Security-Policy':"worker-src 'none'"}:{})}}));
  window=new BrowserWindow({show:true,width:960,height:600,webPreferences:{
    sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,preload:path.join(__dirname,'../client/preload.cjs')
  }});
  if(native){
    shadow=require('../client/native-shadow.cjs').attachNativeShadow({app,BrowserWindow,ipcMain,sharedTexture,
      source:window.webContents,addon:process.env.GFN_ARMADA_NATIVE_BRIDGE,localTest:true,
      report:data=>console.log(JSON.stringify({event:'native-shadow-test',...data}))});
    await shadow.prepare();
  }else{
    ipcMain.handle('native-shadow-bootstrap',()=>`(${installEncodedTap.toString()})()`);
    ipcMain.handle('native-shadow-packet',async(_event,data)=>{
      packet(data,encoded+1);encoded++;
      if(backpressure){await sleep(500);return false;}
      return true;
    });
    ipcMain.on('native-shadow-status',(_event,reason)=>{overflow ||=reason==='compressed-queue-overflow';console.log(JSON.stringify({event:'tap-status',reason}))});
  }
  await window.loadURL('https://play.geforcenow.com/local-test');
  for(let n=0;n<50;n++){
    if(await window.webContents.executeJavaScript('Boolean(window.__gfnArmadaEncodedTap)')) break;
    await sleep(100);
  }
  if(process.env.GFN_ARMADA_TEST_PROBE_RECEIVER==='1'){
    await window.webContents.executeJavaScript(`(async()=>{
      const a=new RTCPeerConnection(),b=new RTCPeerConnection();
      a.addTransceiver('video',{direction:'sendonly'});
      await b.setRemoteDescription(await a.createOffer());
      await new Promise(resolve=>setTimeout(resolve,200));b.close();a.close();
      await new Promise(resolve=>setTimeout(resolve,200));
    })()`);
  }
  await window.webContents.executeJavaScript(`(${loopback.toString()})({width:1280,height:720,pattern:'bars',fixedResolution:${fixedResolution}})`);
  const started=Date.now();
  while(!finishing){
    await sleep(250);
    originalFrames=await window.webContents.executeJavaScript('document.querySelector("video")?.getVideoPlaybackQuality().totalVideoFrames||0');
    const state=shadow?.snapshot();
    if(state?.stopped) throw new Error('Native shadow stopped');
    if(Date.now()-started>=durationMs && originalFrames>=((backpressure||blockedWorker)?60:30) && (native?state.decoded>=30&&state.draws>=30:blockedWorker?encoded===0:backpressure?encoded>0&&encoded<=8:encoded>=30)){
      const pixels=native?await shadow.inspectTestOutput():undefined;
      if(pixels && pixels.distinctColors<4) throw new Error('Native output has no test pattern');
      if(pixels && fixedResolution && (pixels.width!==1280 || pixels.height!==720)) throw new Error('Native output resolution is not 1280x720');
      await finish(null,{originalFrames,elapsedMs:Date.now()-started,...(backpressure?{backpressureFallback:true,overflow}:{}),...(blockedWorker?{cspFallback:true}:{}),...(pixels?{pixels}:{})});return;
    }
  }
}).catch(error=>finish(error));
