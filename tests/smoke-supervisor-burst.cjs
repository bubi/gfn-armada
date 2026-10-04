// Local burst regression: no NVIDIA access and no hardware-decode claim.
// A real GFN burst fills the eight-packet window faster than any acknowledgement
// can return. The supervisor must stage such a burst instead of ending the bridge.
if(process.argv.includes('--gfn-armada-native-helper')) require('../client/native-helper.cjs');
else {
const {app,BrowserWindow,ipcMain,session}=require('electron');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {attachNativeShadow}=require('../client/native-shadow.cjs');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-burst-test-'));
app.setPath('userData',profile);
const BURST=Number(process.env.GFN_ARMADA_TEST_BURST||24);
if(!Number.isSafeInteger(BURST)||BURST<9||BURST>64) throw new Error('Burst must exceed the native window and stay within the staging bound');
let window,shadow,finished=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>finish(new Error('Burst test deadline')),20000);
async function finish(error,result={}){
  if(finished) return;finished=true;clearTimeout(deadline);shadow?.stop('test-finished');
  for(let n=0;n<200&&shadow&&!shadow.snapshot().helperExited;n++) await sleep(20);
  const state=shadow?.snapshot();
  if(state&&!state.helperExited) error ||=new Error('Helper remained running');
  if(state&&state.helperExitCode!==0) error ||=new Error('Helper did not exit cleanly');
  shadow?.dispose();window?.destroy();
  console.log(JSON.stringify({status:error?'failed':'passed',scope:'supervisor-stages-burst-beyond-native-window',
    nativeTested:false,burst:BURST,...result,...(error?{error:error.message}:{})}));
  app.exit(error?1:0);
}
app.on('window-all-closed',()=>{});
app.on('quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
app.whenReady().then(async()=>{
  session.defaultSession.protocol.handle('https',()=>new Response('<title>Local burst regression</title>',{headers:{'Content-Type':'text/html'}}));
  window=new BrowserWindow({show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,preload:path.join(__dirname,'../client/preload.cjs')}});
  shadow=attachNativeShadow({app,ipcMain,source:window.webContents,addon:path.join(__dirname,'fixtures/fake-decoder.cjs'),localTest:true,report(){}});
  await shadow.prepare();await window.loadURL('https://play.geforcenow.com/local-burst-test');
  for(let n=0;n<100;n++){
    if(await window.webContents.executeJavaScript('Boolean(window.__gfnArmadaEncodedTap?.ready)')) break;
    await sleep(20);
  }
  // The worker posts the whole burst in one task and never waits for credit,
  // reproducing an arrival rate no acknowledgement round trip can match.
  await window.webContents.executeJavaScript(`(()=>{
    const generation=crypto.randomUUID();
    function sender(){
      onmessage=e=>{
        const port=e.ports[0],generation=e.data.generation,burst=e.data.burst;
        for(let sequence=1;sequence<=burst;sequence++)
          port.postMessage({kind:'frame',generation,sequence,timestamp:sequence*1500,key:sequence===1,
            bytes:Uint8Array.from([0,0,0,1,0x65,1]).buffer});
      };
    }
    const worker=new Worker(URL.createObjectURL(new Blob(['('+sender.toString()+')()'],{type:'text/javascript'})));
    const channel=e=>{
      if(e.source!==window||e.data?.type!=='gfn-armada-encoded-channel'||e.data.generation!==generation) return;
      window.removeEventListener('message',channel);worker.postMessage({generation,burst:${BURST}},e.ports);
    };
    window.addEventListener('message',channel);
    window.postMessage({type:'gfn-armada-encoded-channel-request',generation},location.origin);
  })()`);
  let state;
  for(let n=0;n<200;n++){
    state=shadow.snapshot();
    if(state.stopped||state.sequence>=BURST) break;
    await sleep(20);
  }
  if(state.stopped) throw new Error('Supervisor stopped on a burst instead of staging it');
  if(state.sequence!==BURST) throw new Error(`Supervisor accepted ${state.sequence} of ${BURST} burst packets`);
  const staged=state.queueMetrics.supervisor.highWater;
  if(!(staged>8)) throw new Error(`Burst never exceeded the native window: staged high water ${staged}`);
  // Everything staged must still reach the helper pipe in order, none dropped.
  for(let n=0;n<200&&shadow.snapshot().queueMetrics['helper-pipe'].ackCount<BURST;n++) await sleep(20);
  const drained=shadow.snapshot();
  if(drained.queueMetrics['helper-pipe'].ackCount!==BURST) throw new Error('Staged burst did not drain to the helper');
  if(drained.queueMetrics.supervisor.pending) throw new Error('Supervisor queue did not drain');
  await finish(null,{acceptedPackets:drained.sequence,stagedHighWater:staged,
    helperAcknowledgements:drained.queueMetrics['helper-pipe'].ackCount});
}).catch(error=>finish(error));
}
