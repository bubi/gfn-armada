const {app,BrowserWindow,ipcMain,session,dialog}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {paths,loadConfig}=require('../launcher/config.cjs');
const {parse,clientArgs,ozonePlatform}=require('../launcher/cli.cjs');
const {allowed,origin}=require('./navigation.cjs');
const {resolveGame,HOME,saveMapping,validatedURL}=require('../launcher/mapping.cjs');
const root=paths();
let cfg,request;
try {
  cfg=loadConfig();
  request=parse(clientArgs(process.argv,app.isPackaged));
  if(!['launch','login','library','map'].includes(request.command)) throw new Error('Use the gfn-armada launcher for this command');
  request.resolved=resolveGame(['login','map'].includes(request.command)?null:request.target);
}catch(e){console.error(e.message);app.exit(1)}
if(cfg&&request?.resolved) {
  for(const dir of [root.data,root.state]) fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const profile=path.join(root.data,'chromium');
  fs.mkdirSync(profile,{recursive:true,mode:0o700});
  app.setName('gfn-armada');app.setPath('userData',profile);app.setPath('sessionData',profile);
  const backend=ozonePlatform();
  if(backend) app.commandLine.appendSwitch('ozone-platform',backend);
  if(!cfg.hardware_decode) app.commandLine.appendSwitch('disable-accelerated-video-decode');
  // Opt-in VA-API decode. Chromium's render-node scan only considers PCI DRM
  // devices (media/gpu/vaapi/vaapi_wrapper.cc), so an SoC GPU is skipped and
  // VA-API never initialises; --hardware-video-device-path bypasses that scan.
  // Requires an external libva driver for the Iris VPU, selected through
  // LIBVA_DRIVER_NAME. Advertised capability is not proof of hardware decode.
  let gpuSandboxDisabled=false;
  const vaapiNode=process.env.GFN_ARMADA_VAAPI;
  if(cfg.hardware_decode && vaapiNode && path.isAbsolute(vaapiNode) && fs.existsSync(vaapiNode)) {
    app.commandLine.appendSwitch('hardware-video-device-path',vaapiNode);
    // The Iris path needs renderable NV12 pixmaps. Wayland + ANGLE GL was
    // measured on Odin; X11 selected an unavailable VA image processor.
    // Keep an explicit ozone preference intact; select Wayland when launching
    // this experiment (GFN_ARMADA_OZONE=wayland).
    if(backend==='wayland') {
      app.commandLine.appendSwitch('use-gl','angle');
      app.commandLine.appendSwitch('use-angle','gl');
    }
    app.commandLine.appendSwitch('enable-features','VaapiVideoDecoder,VaapiVideoDecodeLinuxGL,WebRtcAllowH265Receive');
    app.commandLine.appendSwitch('force-fieldtrials','WebRTC-Video-H26xPacketBuffer/Enabled');
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
    // Retained solely for explicit diagnostic comparisons. The Iris trace on
    // Odin proves /dev/video0 can be opened with the GPU sandbox enabled;
    // disabling it did not fix the observed X11 format-selection failure.
    // This switch is a deliberate, separately named diagnostic that removes the
    // GPU sandbox: it is NOT implied by enabling VA-API and must not become the
    // default. The GPU process handles untrusted content from the remote page.
    if(process.env.GFN_ARMADA_VAAPI_NO_SANDBOX==='1') {
      app.commandLine.appendSwitch('disable-gpu-sandbox');
      gpuSandboxDisabled=true;
    }
  }
  if(process.env.GFN_ARMADA_LOG==='debug') {
    // Child processes log to their inherited stderr, so the file sink misses
    // the GPU process. Allow stderr for remote diagnosis of that process.
    if(process.env.GFN_ARMADA_LOG_SINK==='stderr') app.commandLine.appendSwitch('enable-logging','stderr');
    else {
      app.commandLine.appendSwitch('enable-logging','file');
      app.commandLine.appendSwitch('log-file',path.join(root.state,'chromium.log'));
    }
    app.commandLine.appendSwitch('vmodule','*video_decoder*=3,*v4l2*=3,*rtc_video_decoder*=3,*webrtc_video_decoder*=3,*vaapi*=3');
  }
  const log=(event,data={})=>console.log(JSON.stringify({timestamp:new Date().toISOString(),event,...data}));
  let win;let runtime={timestamp:new Date().toISOString(),pid:process.pid,versions:process.versions,
    hardwareDecoderActive:'unknown',dmabuf:'unknown',requestedOzone:backend||'default',
    vaapiDevicePath:vaapiNode??null,gpuSandboxDisabled,
    bundledDecoder:process.env.GFN_ARMADA_BUNDLED_DECODER_REPORT?JSON.parse(process.env.GFN_ARMADA_BUNDLED_DECODER_REPORT):null,
    source:'page-reported; diagnostic evidence only',active:false};
  function save() {runtime.timestamp=new Date().toISOString();const f=path.join(root.state,'runtime.json');fs.writeFileSync(f+'.tmp',JSON.stringify(runtime,null,2),{mode:0o600});fs.renameSync(f+'.tmp',f)}
  const prefs={nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,preload:path.join(__dirname,'preload.cjs'),partition:'persist:gfn'};
  function secure(window) {
    window.webContents.on('will-navigate',(event,url)=>{if(!allowed(url)){event.preventDefault();log('navigation-blocked',{origin:origin(url)})}});
    window.webContents.on('will-redirect',(event,url)=>{if(!allowed(url)){event.preventDefault();log('redirect-blocked',{origin:origin(url)})}});
    window.webContents.setWindowOpenHandler(({url})=>{
      if(allowed(url)) return {action:'allow',overrideBrowserWindowOptions:{webPreferences:prefs}};
      log('popup-blocked',{origin:origin(url)});return {action:'deny'};
    });
    window.webContents.on('will-attach-webview',e=>e.preventDefault());
  }
  if(!app.requestSingleInstanceLock()) {
    if(request.command==='library'){console.error('Close the running GFN client before importing the library');app.exit(1)}
    else app.quit();
  }
  else {
    app.on('second-instance',(_e,argv)=>{
      try{const next=parse(clientArgs(argv,app.isPackaged));if(!['login','launch','map'].includes(next.command)) return;
        const target=resolveGame(['login','map'].includes(next.command)?null:next.target);
        request= {...next,resolved:target};
        if(win&&!win.isDestroyed()){win.loadURL(target.url).catch(()=>log('load-failed'));win.show();win.focus()}
      }catch(e){log('launch-error',{message:e.message})}
    });
    app.whenReady().then(async()=>{
      const ses=session.fromPartition('persist:gfn');
      ses.setPermissionRequestHandler((_wc,permission,callback)=>callback(['fullscreen','pointerLock'].includes(permission)));
      ses.setPermissionCheckHandler((_wc,permission)=>['fullscreen','pointerLock'].includes(permission));
      if(cfg.compatibility_user_agent) {
        const ua=`Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
        ses.setUserAgent(ua);
      }
      app.on('browser-window-created',(_e,w)=>secure(w));
      win=new BrowserWindow({width:1280,height:720,title:'gfn-armada',backgroundColor:'#111111',fullscreen:cfg.fullscreen&&request.command==='launch',webPreferences:prefs});
      win.setMenu(null);
      if(request.command==='library'){
        const dispose=require('./catalog-import.cjs').attachCatalogImport(win.webContents,{fetch:(...args)=>ses.fetch(...args),
          onProgress:data=>{win.setTitle(data.status==='waiting-for-gfn-login'?'GFN Armada — Sign in to import your library':`GFN Armada — Reading library${data.apps!==undefined?' ('+data.apps+' games)':''}`);log('catalog-progress',data)},
          onComplete:result=>{runtime.catalogImportComplete=true;runtime.catalogImport=result;save();log('catalog-imported',result);void dialog.showMessageBox(win,{type:'info',message:`Imported ${result.imported} bookmarked, owned store editions.`,detail:`${result.unknownOwnership} bookmarked editions have unknown ownership and were skipped. ${result.manualOwnership} imported editions use ownership manually confirmed in GFN. Close Steam, then run gfn-armada sync --apply to add shortcuts.`,buttons:['Close client']}).then(()=>app.quit())},
          onError:data=>{log('catalog-import-failed',data);dialog.showErrorBox('Library import unavailable',data.message)}});
        win.on('closed',dispose);
      }
      if(process.env.GFN_ARMADA_NATIVE_SHADOW==='1') {
        let shadow;
        try {
          const addon=process.env.GFN_ARMADA_NATIVE_BRIDGE;
          if(typeof addon!=='string' || !path.isAbsolute(addon)) throw new Error('Set GFN_ARMADA_NATIVE_BRIDGE to an absolute ARM64 addon path');
          shadow=require('./native-shadow.cjs').attachNativeShadow({app,ipcMain,
            source:win.webContents,addon,report:data=>{runtime.nativeShadow=data;save();log('native-shadow',data)}});
          win.on('closed',()=>shadow.dispose());
          await shadow.prepare();
        }catch{shadow?.dispose();ipcMain.handle('native-shadow-bootstrap',()=>null);log('native-shadow-unavailable');}
      } else ipcMain.handle('native-shadow-bootstrap',()=>null);
      if(require('./webrtc-internals.cjs').nativeStatsEnabled(request.command)) {
        const disposeInternals=require('./webrtc-internals.cjs').attachWebRTCInternals(BrowserWindow,data=>{
          runtime.nativeWebRTC=data;
          runtime.hardwareDecoderActive=require('./webrtc-internals.cjs').softwareDecodeStatus(data);
          runtime.hardwareDecoderEvidence='native Chromium WebRTC stats; check timestamp and session';
          save();log('native-webrtc-decoder',data);
        });
        win.on('closed',disposeInternals);
      }
      // CDP Media diagnostics stay opt-in; the catalog importer also uses CDP.
      if(process.env.GFN_ARMADA_MEDIA_DIAGNOSTICS==='1'&&request.command!=='library') {
        require('./media-diagnostics.cjs').attachMediaDiagnostics(win.webContents,data=>{
          runtime.nativeMedia=runtime.nativeMedia||{};
          if(data.playerId) runtime.nativeMedia[data.playerId]=data.properties;
          else runtime.nativeMediaStatus=data.status;
          save();log('native-media-decoder',data);
        });
      }
      let capturing=false;
      async function captureMapping() {
        if(request.command!=='map' || capturing) return;
        capturing=true;
        try {
          const mappingRequest={...request};
          const url=validatedURL(win.webContents.getURL());
          const answer=await dialog.showMessageBox(win,{type:'question',buttons:['Save mapping','Cancel'],defaultId:1,cancelId:1,title:'GFN game mapping',message:`Save the currently opened GFN stream as ${mappingRequest.name} (${mappingRequest.target})?`,detail:'Check that this is the correct game and matching store in GFN. Existing mappings are backed up.'});
          if(answer.response===0) {
            const [store,storeGameId]=mappingRequest.target.split(':');
            saveMapping({store,storeGameId,...(store==='steam'?{steamAppId:storeGameId}:{}),gfnVariantId:new URLSearchParams(new URL(url).hash.split('?')[1]).get('cmsId'),captureSource:'manual-webclient',name:mappingRequest.name,launchURL:url});
            log('mapping-saved',{gameKey:mappingRequest.target});
          }
        }catch(e){dialog.showErrorBox('Mapping not saved',e.message)}finally{capturing=false}
      }
      win.webContents.on('before-input-event',(event,input)=>{
        if(input.type!=='keyDown') return;
        if(input.control&&input.shift&&input.key.toLowerCase()==='p'){event.preventDefault();void captureMapping()}
        if(input.control&&input.shift&&input.key.toLowerCase()==='i'){event.preventDefault();win.webContents.toggleDevTools()}
        if(input.key==='F11'){event.preventDefault();win.setFullScreen(!win.isFullScreen())}
        if(input.control&&input.shift&&input.key.toLowerCase()==='d'){
          event.preventDefault();const d=new BrowserWindow({width:1000,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
          d.loadURL('chrome://gpu');
        }
      });
      ipcMain.on('rtc-observation',(event,data)=>{
        if(event.sender!==win.webContents||event.senderFrame?.url.startsWith(HOME)!==true) return;
        if(!data || !Array.isArray(data.streams)||!Array.isArray(data.codecs)||!Array.isArray(data.controllers)) return;
        runtime.observation=data;runtime.active=true;save();
        if(process.env.GFN_ARMADA_LOG==='debug') log('rtc-observation',data);
      });
      win.webContents.on('did-fail-load',(_e,code,_description,_url,isMain)=>{if(isMain)log('load-failed',{code})});
      win.webContents.on('did-start-navigation',(_e,_url,_inPlace,isMain)=>{if(isMain){runtime.observation=null;runtime.active=false;save()}});
      // Experiment affordance for unattended remote test runs: a catalogue page the
      // user supplied explicitly, constrained to the same navigation allowlist. It
      // does not relax the captured-streamer-route contract in games.json and only
      // replaces the initial load, so the bridge still stops on later navigation.
      const startOverride=process.env.GFN_ARMADA_START_URL;
      const initialURL=startOverride&&allowed(startOverride)?startOverride:request.resolved.url;
      if(startOverride) log('start-url-override',{accepted:initialURL===startOverride,origin:origin(startOverride)});
      log('start',{architecture:process.arch,versions:process.versions,game:request.resolved.game,streamPreferencesApplied:false});
      runtime.gpuFeatures=app.getGPUFeatureStatus();save();
      await win.loadURL(initialURL);
      if(request.command==='map') await dialog.showMessageBox(win,{type:'info',message:`Open ${request.name} with the ${request.target.split(':')[0]} store in GFN, then press Ctrl+Shift+P to capture its current launch URL.`,detail:'No ID is guessed. The URL must match the upstream-observed streamer route.'});
      const refreshGPU=()=>app.getGPUInfo('complete').then(gpu=>{
        runtime.gpu=gpu;runtime.gpuFeatures=app.getGPUFeatureStatus();runtime.gpuSnapshotTimestamp=new Date().toISOString();save();
      }).catch(()=>{});
      // Reading complete GPU info can itself emit this event. Never request it
      // again from the event handler, otherwise the update loop prevents exit.
      app.on('gpu-info-update',()=>{
        runtime.gpuFeatures=app.getGPUFeatureStatus();runtime.gpuSnapshotTimestamp=new Date().toISOString();save();
      });
      void refreshGPU();
    }).catch(e=>{log('startup-failed',{message:e.message});app.quit()});
    app.on('child-process-gone',(_e,details)=>log('child-process-gone',{type:details.type,reason:details.reason}));
    app.on('window-all-closed',()=>{if(request.command==='library'&&!runtime.catalogImportComplete)app.exit(1);else app.quit()});
    app.on('before-quit',()=>{runtime.active=false;save()});
  }
}
