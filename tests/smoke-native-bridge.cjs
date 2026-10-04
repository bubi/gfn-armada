// Real local WebRTC + production preload. Mac tests the tap; ARM64 can test Iris.
if(process.argv.includes('--gfn-armada-native-helper')) require('../client/native-helper.cjs');
else {
const {app,BrowserWindow,ipcMain,session,sharedTexture,MessageChannelMain}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {loopback}=require('./fixtures/local-webrtc.cjs');
const {installEncodedTap}=require('../client/encoded-tap.cjs');
const {packet}=require('../client/encoded-packet.cjs');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-native-bridge-'));
app.setPath('userData',profile);
const frontendOzone=process.env.GFN_ARMADA_TEST_FRONTEND_OZONE||'wayland';
if(!['wayland','x11'].includes(frontendOzone)) throw new Error('Invalid frontend test backend');
if(process.platform==='linux') app.commandLine.appendSwitch('ozone-platform',frontendOzone);
let shadow,window,encoded=0,finishing=false,overflow=false,originalFrames=0,crashAtFrames=null;
const helperCrash=process.env.GFN_ARMADA_TEST_HELPER_CRASH==='1';
const helperReject=process.env.GFN_ARMADA_TEST_HELPER_REJECT==='1';
const mockHelper=(helperCrash||helperReject)&&!process.env.GFN_ARMADA_NATIVE_BRIDGE;
const native=Boolean(process.env.GFN_ARMADA_NATIVE_BRIDGE)||mockHelper;
const addon=mockHelper?path.join(__dirname,helperReject?'fixtures/rejecting-decoder.cjs':'fixtures/fake-decoder.cjs'):process.env.GFN_ARMADA_NATIVE_BRIDGE;
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
  for(let n=0;n<200 && shadow && (!shadow.snapshot().helperExited||shadow.snapshot().outstanding);n++) await sleep(20);
  const state=shadow?.snapshot();
  if(state?.outstanding) error ||=new Error('Samples remain leased');
  if(state && !state.helperExited) error ||=new Error('Helper remains running');
  if(state && !helperCrash && state.helperExitCode!==0) error ||=new Error('Helper did not exit cleanly');
  shadow?.dispose();window?.destroy();
  console.log(JSON.stringify({status:error?'failed':'passed',scope:helperReject?'helper-decoder-rejection-fallback':helperCrash?'helper-process-crash-isolation':native?'local-webrtc-h264-iris-shadow':'encoded-tap-only',nativeTested:native&&!mockHelper,encoded,originalFrames,...state,...extra,...(error?{error:error.message}:{})}));
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
      source:window.webContents,addon,localTest:true,
      report:data=>console.log(JSON.stringify({event:'native-shadow-test',...data}))});
    await shadow.prepare();
  }else{
    ipcMain.handle('native-shadow-bootstrap',()=>`(${installEncodedTap.toString()})()`);
    ipcMain.handle('native-shadow-channel',(event,generation)=>{
      const {port1,port2}=new MessageChannelMain();
      port1.on('message',async({data})=>{
        if(data.kind==='status'){overflow ||=data.reason==='compressed-queue-overflow';return;}
        if(data.kind!=='frame') throw new Error('Unexpected test transport message');
        packet({...data,bytes:new Uint8Array(data.bytes)},encoded+1);encoded++;
        if(backpressure) await sleep(500);
        port1.postMessage({kind:backpressure?'disable':'ack',sequence:data.sequence});
      });
      port1.start();event.senderFrame.postMessage('native-shadow-channel',{generation},[port2]);return true;
    });
    ipcMain.on('native-shadow-status',(_event,reason)=>{overflow ||=reason==='compressed-queue-overflow';console.log(JSON.stringify({event:'tap-status',reason}))});
  }
  await window.loadURL('https://play.geforcenow.com/local-test');
  for(let n=0;n<50;n++){
    if(await window.webContents.executeJavaScript('Boolean(window.__gfnArmadaEncodedTap?.ready)')) break;
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
    if(helperReject){
      if(state.stopped&&crashAtFrames===null) crashAtFrames=originalFrames;
      if(state.helperExited){
        if(state.helperExitSignal||state.helperExitCode!==0) throw new Error('Rejecting helper did not exit cleanly');
        if(mockHelper&&state.lastNativeError!=='First prototype requires negotiated limited-range BT.709 (test rejection)')
          throw new Error('Decoder rejection diagnostic was lost during helper shutdown');
        if(originalFrames>=Math.max(30,crashAtFrames+30)){
          await finish(null,{decoderRejectionContained:true,parentPid:process.pid,browserFramesAtRejection:crashAtFrames,browserFramesAfterRejection:originalFrames});return;
        }
      }
      continue;
    }
    if(helperCrash){
      if(crashAtFrames===null && originalFrames>=30 && (mockHelper?state.sequence>=8:state.decoded>=30&&state.draws>=30)){
        crashAtFrames=originalFrames;shadow.crashTestHelper();
      }
      if(state.helperExited){
        if(state.helperExitSignal!=='SIGSEGV') throw new Error('Helper exit was not SIGSEGV');
        if(originalFrames>=crashAtFrames+30){await finish(null,{helperCrashContained:true,parentPid:process.pid,browserFramesBeforeCrash:crashAtFrames,browserFramesAfterCrash:originalFrames,elapsedMs:Date.now()-started});return;}
      }
      continue;
    }
    if(state?.stopped) throw new Error('Native shadow stopped');
    if(Date.now()-started>=durationMs && originalFrames>=((backpressure||blockedWorker)?60:30) && (native?state.decoded>=30&&state.draws>=30:blockedWorker?encoded===0:backpressure?encoded>0&&encoded<=8:encoded>=30)){
      const pixels=native?await shadow.inspectTestOutput():undefined;
      if(pixels && pixels.distinctColors<4) throw new Error('Native output has no test pattern');
      if(pixels && fixedResolution && (pixels.width!==1280 || pixels.height!==720)) throw new Error('Native output resolution is not 1280x720');
      await finish(null,{originalFrames,elapsedMs:Date.now()-started,...(backpressure?{backpressureFallback:true,overflow}:{}),...(blockedWorker?{cspFallback:true}:{}),...(pixels?{pixels}:{})});return;
    }
  }
}).catch(error=>finish(error));
}
