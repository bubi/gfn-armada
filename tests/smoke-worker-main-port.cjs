// Local transport regression: no NVIDIA access and no hardware-decode claim.
if(process.argv.includes('--gfn-armada-native-helper')) require('../client/native-helper.cjs');
else {
const {app,BrowserWindow,ipcMain,session}=require('electron');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {attachNativeShadow}=require('../client/native-shadow.cjs');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-worker-port-test-'));
app.setPath('userData',profile);
let window,shadow,finished=false,accessUnitResync=false,resumed=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>finish(new Error('Transport test deadline')),20000);
async function finish(error,result={}){
  if(finished) return;finished=true;clearTimeout(deadline);shadow?.stop('test-finished');
  for(let n=0;n<200&&shadow&&!shadow.snapshot().helperExited;n++) await sleep(20);
  if(shadow&&!shadow.snapshot().helperExited) error ||=new Error('Helper remained running');
  shadow?.dispose();window?.destroy();
  console.log(JSON.stringify({status:error?'failed':'passed',scope:'worker-to-main-while-page-blocked',nativeTested:false,...result,...(error?{error:error.message}:{})}));
  app.exit(error?1:0);
}
app.on('window-all-closed',()=>{});
app.on('quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
app.whenReady().then(async()=>{
  session.defaultSession.protocol.handle('https',()=>new Response('<title>Local worker port regression</title>',{headers:{'Content-Type':'text/html'}}));
  window=new BrowserWindow({show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,preload:path.join(__dirname,'../client/preload.cjs')}});
  shadow=attachNativeShadow({app,ipcMain,source:window.webContents,addon:path.join(__dirname,'fixtures/fake-decoder.cjs'),localTest:true,report(data){accessUnitResync ||=data.status==='non-annexb-access-unit';resumed ||=data.status==='queue-resync-resumed';}});
  await shadow.prepare();await window.loadURL('https://play.geforcenow.com/local-port-test');
  for(let n=0;n<100;n++){
    if(await window.webContents.executeJavaScript('Boolean(window.__gfnArmadaEncodedTap?.ready)')) break;
    await sleep(20);
  }
  await window.webContents.executeJavaScript(`(()=>{
    const generation=crypto.randomUUID();
    function sender(){
      onmessage=e=>{
        const port=e.ports[0],generation=e.data.generation;let sequence=0;
        const push=()=>{const bytes=Uint8Array.from([0,0,0,1,0x65,1]).buffer;
          sequence++;
          if(sequence===3) port.postMessage({kind:'status',generation,reason:'non-annexb-access-unit'});
          if(sequence===4) port.postMessage({kind:'status',generation,reason:'queue-resync-resumed'});
          port.postMessage({kind:'frame',generation,sequence,timestamp:sequence*1500,key:sequence===1,bytes});};
        port.onmessage=e=>{if(e.data.kind==='ack') setTimeout(push,2);};push();
      };
    }
    const worker=new Worker(URL.createObjectURL(new Blob(['('+sender.toString()+')()'],{type:'text/javascript'})));
    const channel=e=>{
      if(e.source!==window||e.data?.type!=='gfn-armada-encoded-channel'||e.data.generation!==generation) return;
      window.removeEventListener('message',channel);worker.postMessage({generation},e.ports);
    };
    window.addEventListener('message',channel);
    window.postMessage({type:'gfn-armada-encoded-channel-request',generation},location.origin);
  })()`);
  for(let n=0;n<100&&shadow.snapshot().sequence<5;n++) await sleep(20);
  const before=shadow.snapshot();if(!accessUnitResync||!resumed) throw new Error('Supervisor did not retain resync statuses');
  if(before.sequence<5||before.stopped) throw new Error('Direct port unavailable');
  const block=window.webContents.executeJavaScript('(()=>{const end=performance.now()+300;while(performance.now()<end){}return true;})()');
  await sleep(150);const during=shadow.snapshot();await block;
  const acknowledgementsDuring=during.queueMetrics['helper-pipe'].ackCount-before.queueMetrics['helper-pipe'].ackCount;
  if(during.stopped||acknowledgementsDuring<10) throw new Error('Page blockade stalled worker/main ACKs');
  await finish(null,{accessUnitResyncNotTerminal:true,pageBlockMs:300,acksDuringFirst150Ms:acknowledgementsDuring,packetsBefore:before.sequence,packetsDuring:during.sequence});
}).catch(error=>finish(error));
}
