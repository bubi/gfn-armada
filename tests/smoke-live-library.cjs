// Actual Electron/CDP integration with synthetic local GFN/Steam pages.
// HTTPS is intercepted in this temporary session; no NVIDIA/Steam request leaves it.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {attachLibrarySync}=require('../client/library-sync.cjs');
const {syncLive}=require('../steam-integration/live-sync.cjs'),{connect}=require('../steam-integration/cef.cjs');
const vdf=require('../steam-integration/binary-vdf.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-live-smoke-'));
app.setPath('userData',path.join(root,'profile'));
const port=Number(process.env.GFN_TEST_CEF_PORT||19227);app.commandLine.appendSwitch('remote-debugging-port',String(port));
const deadline=setTimeout(()=>finish(Error('Live library smoke timeout')),25000);
let finished=false,windows=[],disposers=[];
function finish(error,result){if(finished)return;finished=true;clearTimeout(deadline);for(const dispose of disposers)dispose();for(const win of windows)if(!win.isDestroyed())win.destroy();fs.rmSync(root,{recursive:true,force:true});if(error)console.error(error.message);else console.log(JSON.stringify(result));app.exit(error?1:0)}
const steamHTML=`<title>SharedJSContext</title><ul id="games"></ul><script>
const entries=new Map(),callbacks=new Map();let next=2147483649;
window.appStore={m_mapApps:entries,GetAppOverviewByAppID:id=>entries.get(id)};
function notify(id){for(const cb of callbacks.get(id)||[])cb({...entries.get(id)})}
window.SteamClient={Apps:{
AddShortcut:async(name,exe)=>{const id=next++;entries.set(id,{unAppID:id,strDisplayName:'client',strShortcutExe:exe,strShortcutStartDir:'',strShortcutLaunchOptions:''});document.querySelector('#games').appendChild(document.createElement('li'));return id},
RegisterForAppDetails:(id,cb)=>{const set=callbacks.get(id)||new Set();callbacks.set(id,set);set.add(cb);if(entries.has(id))cb({...entries.get(id)});return {unregister:()=>set.delete(cb)}}}};
for(const [method,field] of Object.entries({SetShortcutName:'strDisplayName',SetShortcutExe:'strShortcutExe',SetShortcutStartDir:'strShortcutStartDir',SetShortcutLaunchOptions:'strShortcutLaunchOptions'}))SteamClient.Apps[method]=(id,value)=>{entries.get(id)[field]=value;notify(id)};
</script>`;
const catalog={data:{apps:{items:[{id:'synthetic',title:'Synthetic smoke game',library:{favorited:true},variants:[{id:'123',appStore:'STEAM',storeUrl:'https://store.steampowered.com/app/1',gfn:{library:{status:'PLATFORM_SYNC'}}}]}],pageInfo:{hasNextPage:false,endCursor:null}}}};
const endpoint='https://games.geforce.com/graphql?'+new URLSearchParams({variables:JSON.stringify({vpcId:'synthetic',locale:'en_US'}),huId:'synthetic-account'});
const gfnHTML=`<title>Synthetic GFN</title><script>fetch(${JSON.stringify(endpoint)},{headers:{Authorization:'GFNJWT synthetic-local-smoke-not-a-real-token'}}).catch(()=>{});</script>`;
app.whenReady().then(async()=>{
  const ses=session.fromPartition('temporary-live-smoke');
  ses.protocol.handle('https',request=>{
    const host=new URL(request.url).hostname;
    const headers={'Access-Control-Allow-Origin':'https://play.geforcenow.com','Access-Control-Allow-Headers':'Authorization','Access-Control-Allow-Methods':'GET, OPTIONS'};
    if(request.method==='OPTIONS')return new Response('',{headers});
    if(host==='steamloopback.host')return new Response(steamHTML,{headers:{'Content-Type':'text/html'}});
    if(host==='play.geforcenow.com')return new Response(gfnHTML,{headers:{'Content-Type':'text/html'}});
    if(host==='games.geforce.com')return new Response(JSON.stringify(catalog),{headers:{...headers,'Content-Type':'application/json'}});
    return new Response('Blocked by synthetic smoke',{status:403});
  });
  const prefs={session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false};
  const steam=new BrowserWindow({show:false,webPreferences:prefs});windows.push(steam);await steam.loadURL('https://steamloopback.host/routes/library/home');
  const gfn=new BrowserWindow({show:false,webPreferences:prefs});windows.push(gfn);
  const executable=path.join(root,'client'),user=path.join(root,'userdata/1'),file=path.join(root,'games.json');
  fs.writeFileSync(executable,'#!/bin/sh\n',{mode:0o755});fs.mkdirSync(path.join(user,'config'),{recursive:true});
  const shortcuts=path.join(user,'config/shortcuts.vdf'),before=vdf.encode([{type:0,key:'shortcuts',value:[]}]);fs.writeFileSync(shortcuts,before);
  let reports=[];
  const ready=new Promise((resolve,reject)=>{
    disposers.push(attachLibrarySync(gfn.webContents,{request:{command:'launch'},config:{steam_integration:true},file,state:path.join(root,'state'),executable,fetch:(...args)=>ses.fetch(...args),
      sync:(rows,options)=>syncLive(rows,{...options,user,connect:opts=>connect({...opts,port})}),
      report:data=>{reports.push(data);if(data.phase==='steam'&&data.status==='synced')resolve(data);if(data.status==='failed'||data.status==='pending'||data.status==='partial')reject(Error('Synthetic library sync failed: '+data.status))}}));
  });
  await gfn.loadURL('https://play.geforcenow.com/');const result=await ready;
  assert.equal(result.added,1);assert.deepEqual(fs.readFileSync(shortcuts),before);
  const rows=JSON.parse(fs.readFileSync(file));const second=await syncLive(rows,{executable,user,state:path.join(root,'state'),connect:opts=>connect({...opts,port})});assert.equal(second.unchanged,1);
  assert.equal(await steam.webContents.executeJavaScript("document.querySelectorAll('#games li').length"),1);
  finish(null,{synthetic:true,realElectronCDP:true,automaticAuthenticatedImport:true,liveShortcutVisible:true,repeatWithoutDuplicate:true,vdfUntouched:true,deviceSteam:'not-tested'});
}).catch(error=>finish(error));
