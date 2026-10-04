// Optional real-runtime test: local synthetic H.264 WebRTC, no GFN/login/mic.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {attachWebRTCInternals}=require('../client/webrtc-internals.cjs');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-native-stats-'));
app.setPath('userData',profile);
let dispose;
const finish=code=>{clearTimeout(deadline);dispose?.();app.exit(code)};
const deadline=setTimeout(()=>{console.log(JSON.stringify({status:'timeout'}));finish(1)},30000);
const {loopback}=require('./fixtures/local-webrtc.cjs');

app.whenReady().then(async()=>{
  const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,
    nodeIntegration:false,backgroundThrottling:false}});
  let started=false;
  dispose=attachWebRTCInternals(BrowserWindow,async data=>{
    if(data.status==='unavailable'){console.log(JSON.stringify(data));finish(1);return}
    if(!started&&data.status==='waiting') {
      started=true;
      try{await w.loadURL('data:text/html,<title>Local WebRTC test</title>');await w.webContents.executeJavaScript(`(${loopback.toString()})()`)}
      catch{console.log(JSON.stringify({status:'loopback-failed'}));finish(1)}
    }
    const s=data.streams?.find(s=>s.codec==='video/H264'&&s.framesDecoded>0&&s.decoder!=='unknown');
    if(s){console.log(JSON.stringify({status:'passed',stream:s}));finish(0)}
  },'null');
}).catch(()=>finish(1));
