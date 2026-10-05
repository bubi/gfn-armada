// Read-only capability probe. No NVIDIA session, no login, no network request.
// Reports what this Chromium build advertises for WebRTC video receive, so an
// HEVC decision rests on measurement instead of release notes.
// GFN_ARMADA_PROBE_H265=1 adds the documented HEVC receive switches.
// GFN_ARMADA_PROBE_VAAPI=1 additionally asks for the VA-API decoder, for use
// with an external libva driver selected through LIBVA_DRIVER_NAME. The shipped
// Electron is built with use_vaapi=true and use_v4l2_codec=false, so libva is
// the only hardware decode entry point present in the binary.
const {app,BrowserWindow,session}=require('electron');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-codec-probe-'));
app.setPath('userData',profile);
const withH265=process.env.GFN_ARMADA_PROBE_H265==='1';
const withVaapi=process.env.GFN_ARMADA_PROBE_VAAPI==='1';
const switches=[];
const features=[];
if(withH265){
  features.push('WebRtcAllowH265Receive');
  app.commandLine.appendSwitch('force-fieldtrials','WebRTC-Video-H26xPacketBuffer/Enabled');
  switches.push('--force-fieldtrials=WebRTC-Video-H26xPacketBuffer/Enabled');
}
if(withVaapi){
  features.push('VaapiVideoDecoder','VaapiVideoDecodeLinuxGL');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  switches.push('--ignore-gpu-blocklist');
}
if(features.length){
  app.commandLine.appendSwitch('enable-features',features.join(','));
  switches.push(`--enable-features=${features.join(',')}`);
}
let window;
app.on('window-all-closed',()=>{});
app.on('quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
app.whenReady().then(async()=>{
  session.defaultSession.protocol.handle('https',()=>new Response('<title>codec probe</title>',{headers:{'Content-Type':'text/html'}}));
  window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await window.loadURL('https://play.geforcenow.com/codec-probe');
  const result=await window.webContents.executeJavaScript(`(async()=>{
    const out={receive:[],send:[],mediaCapabilities:{}};
    try{out.receive=(RTCRtpReceiver.getCapabilities('video')?.codecs||[]).map(c=>c.mimeType);}catch(e){out.receiveError=String(e)}
    try{out.send=(RTCRtpSender.getCapabilities('video')?.codecs||[]).map(c=>c.mimeType);}catch(e){out.sendError=String(e)}
    // MediaCapabilities is the other surface the HEVC rollout exposes.
    for(const [name,type] of [['h264','video/mp4; codecs="avc1.42E01E"'],['hevc','video/mp4; codecs="hvc1.1.6.L93.B0"'],['av1','video/mp4; codecs="av01.0.04M.08"']]){
      try{
        const r=await navigator.mediaCapabilities.decodingInfo({type:'file',video:{contentType:type,width:1280,height:720,bitrate:5000000,framerate:60}});
        out.mediaCapabilities[name]={supported:r.supported,powerEfficient:r.powerEfficient,smooth:r.smooth};
      }catch(e){out.mediaCapabilities[name]={error:String(e)}}
    }
    return out;
  })()`);
  const gpuInfo=await app.getGPUInfo('complete').catch(()=>null);
  const unique=list=>[...new Set(list)].sort();
  console.log(JSON.stringify({
    probe:'webrtc-video-codecs',h265SwitchesApplied:withH265,vaapiSwitchesApplied:withVaapi,switches,
    libvaDriverName:process.env.LIBVA_DRIVER_NAME??null,libvaDriversPath:process.env.LIBVA_DRIVERS_PATH??null,
    chrome:process.versions.chrome,electron:process.versions.electron,platform:process.platform,arch:process.arch,
    receiveCodecs:unique(result.receive),sendCodecs:unique(result.send),
    h265Receive:result.receive.some(m=>/265|hevc/i.test(m)),
    av1Receive:result.receive.some(m=>/av1/i.test(m)),
    mediaCapabilities:result.mediaCapabilities,
    gpuFeatures:app.getGPUFeatureStatus(),
    // Which decode profiles Chromium actually accepted from the VA driver.
    // Empty here while advertised codecs look fine means Chromium rejected
    // the driver rather than the driver failing to offer anything.
    videoDecodeProfiles:(gpuInfo?.videoDecodeAcceleratorSupportedProfile||[]).map(p=>
      `${p.profile}@${p.maxResolutionWidth}x${p.maxResolutionHeight}${p.encrypted?' enc':''}`),
    note:'Advertised capability is not proof that NVIDIA negotiates or that the VPU decodes it.'
  }));
  window.destroy();app.exit(0);
}).catch(error=>{console.log(JSON.stringify({probe:'webrtc-video-codecs',error:error.message}));app.exit(1);});
