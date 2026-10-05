// Actual sandboxed preload and first page script; no NVIDIA request or profile.
const {app,BrowserWindow,session,ipcMain}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {identity,requestHeaders}=require('../client/browser-identity.cjs');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-identity-'));app.setPath('userData',profile);
const deadline=setTimeout(()=>app.exit(1),20000);
app.on('quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
app.whenReady().then(async()=>{
 ipcMain.handle('native-shadow-bootstrap',()=>null);
 const id=identity({mode:'windows',chrome:process.versions.chrome});
 session.defaultSession.setUserAgent(id.userAgent);
 session.defaultSession.webRequest.onBeforeSendHeaders({urls:['https://play.geforcenow.com/*']},(d,cb)=>cb({requestHeaders:requestHeaders(d.requestHeaders,id)}));
 let headerUA,hevcInstalled=false;
 ipcMain.on('hevc-experiment-status',(_e,data)=>{if(data.event==='installed'&&data.preferred==='AV1')hevcInstalled=true;});
 session.defaultSession.protocol.handle('https',request=>{
  headerUA=request.headers.get('user-agent');
  return new Response(`<script>window.firstIdentity={ua:navigator.userAgent,platform:navigator.platform,hintPlatform:navigator.userAgentData.platform,node:typeof require};</script>`,{headers:{'Content-Type':'text/html'}});
 });
 const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,
  preload:path.resolve(__dirname,'../client/preload.cjs'),additionalArguments:[`--gfn-armada-identity=${JSON.stringify(id)}`,'--gfn-armada-av1-experiment']}});
 await w.loadURL('https://play.geforcenow.com/identity-probe');
 const r=await w.webContents.executeJavaScript(`(async()=>({first:window.firstIdentity,hints:await navigator.userAgentData.getHighEntropyValues(['platformVersion','architecture','bitness','fullVersionList']),receive:RTCRtpReceiver.getCapabilities('video').codecs.map(c=>c.mimeType)}))()`);
 assert.equal(hevcInstalled,true);assert.equal(r.first.ua,id.userAgent);assert.equal(r.first.platform,'Win32');assert.equal(r.first.hintPlatform,'Windows');assert.equal(r.first.node,'undefined');
 assert.equal(r.hints.platformVersion,'10.0.0');assert.equal(r.hints.architecture,id.hints.architecture);assert.ok(r.receive.includes('video/H264'));assert.equal(headerUA,id.userAgent);
 console.log(JSON.stringify({status:'passed',mode:id.mode,firstScriptIdentity:r.first,highEntropyHints:r.hints,capabilityApisUnchanged:true,scope:'synthetic local protocol; no GFN session'}));
 clearTimeout(deadline);w.destroy();app.exit(0);
}).catch(e=>{console.error(e.message);clearTimeout(deadline);app.exit(1)});
