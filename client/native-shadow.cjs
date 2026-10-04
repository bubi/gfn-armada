const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {installEncodedTap}=require('./encoded-tap.cjs');
const {packet,rtpDelta}=require('./encoded-packet.cjs');
const {startHelper}=require('./helper-process.cjs');
function attachNativeShadow({app,ipcMain,source,addon,report,localTest=false}) {
  if((!localTest&&(process.platform!=='linux'||process.arch!=='arm64'))||!path.isAbsolute(addon)) throw new Error('Native shadow requires Linux ARM64 and an absolute addon path');
  let helper,starting,stopped=false,generation,sequence=0,inflight=0,inflightBytes=0,previous,pts=0;
  let decoded=0,draws=0,released=0,outstanding=0,lastFrameAt=null,helperExited=false,helperExitSignal=null,helperExitCode=null;
  const trusted=event=>{
    try{return event.sender===source&&event.senderFrame===source.mainFrame&&new URL(event.senderFrame.url).origin==='https://play.geforcenow.com';}catch{return false;}
  };
  const evidence=(status,reason)=>report({status,reason,timestamp:new Date().toISOString(),lastFrameAt,mode:'isolated-parallel-shadow',codec:'H264',
    helperPid:helper?.pid,helperExited,helperExitSignal,helperExitCode,encodedFrames:sequence,decodedTransfers:decoded,rendererDraws:draws,releasedSamples:released,outstanding,
    originalBrowserDecodeEnabled:true,hardwareDecoderActive:'unknown'});
  function stop(reason='stopped') {
    if(stopped) return;stopped=true;helper?.stop();evidence('stopped',reason);
  }
  async function start(){
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-native-helper-'));
    const env={};
    for(const key of ['HOME','PATH','TMPDIR','XDG_RUNTIME_DIR','WAYLAND_DISPLAY','DISPLAY','XAUTHORITY','DBUS_SESSION_BUS_ADDRESS','LANG','LC_ALL','LD_LIBRARY_PATH'])
      if(process.env[key]!==undefined) env[key]=process.env[key];
    env.GFN_ARMADA_HELPER_PROFILE=profile;env.GFN_ARMADA_NATIVE_BRIDGE=addon;
    if(localTest) env.GFN_ARMADA_HELPER_LOCAL_TEST='1';
    const args=[...(!app.isPackaged?[path.resolve(__dirname,'..')]:[]),'--gfn-armada-native-helper',...(process.platform==='linux'?['--ozone-platform=wayland']:[])];
    helper=startHelper({command:process.execPath,args,env,profile,onEvent:message=>{
      if(message.kind==='failed'){report({status:'native-error',reason:message.reason});stop('native-helper-failed');}
      else if(message.kind==='opened') report({status:'native-opened',codec:'H264',device:message.device,helperPid:helper.pid,hardwareDecoderActive:'unknown'});
      else if(message.kind==='stats'||message.kind==='closed'){
        if(['decoded','draws','released','outstanding'].some(key=>!Number.isSafeInteger(message[key])||message[key]<0)||message.outstanding>4){stop('invalid-helper-counters');return;}
        decoded=message.decoded;draws=message.draws;released=message.released;outstanding=message.outstanding;
        lastFrameAt=typeof message.lastFrameAt==='string'?message.lastFrameAt:null;
        if(message.kind==='closed') evidence('closed');else if(decoded&&decoded%30===0) evidence('transferring');
      }else if(message.kind==='exit'){
        helperExited=true;helperExitSignal=message.signal;helperExitCode=message.code;
        // OS reclaims the helper's FDs; this does not count as sample release.
        outstanding=0;if(!stopped) stop('native-helper-exited');
        evidence('helper-exited',message.signal||String(message.code));
      }
    }});
    await helper.prepared;if(stopped) throw new Error('Native helper stopped');
    evidence('helper-ready');
  }
  ipcMain.handle('native-shadow-bootstrap',async event=>{
    if(!trusted(event)||stopped) return null;
    starting ||=start();await starting;
    return !stopped?`(${installEncodedTap.toString()})()`:null;
  });
  ipcMain.handle('native-shadow-packet',async(event,data)=>{
    if(!trusted(event)||stopped) return false;
    let heldBytes=0;
    try{
      const p=packet(data,sequence+1);
      if(inflight>=8||inflightBytes+p.bytes.byteLength>4194304){stop('ipc-queue-overflow');return false;}
      if(generation&&p.generation!==generation) throw new Error('Receiver generation changed');
      if(!generation){if(!p.key) throw new Error('Initial keyframe required');generation=p.generation;}
      sequence++;inflight++;heldBytes=p.bytes.byteLength;inflightBytes+=heldBytes;
      starting ||=start();await starting;if(stopped) return false;
      if(previous!==undefined) pts+=rtpDelta(previous,p.timestamp);previous=p.timestamp;
      return await helper.push({sequence:p.sequence,timestampUs:pts,key:p.key},Buffer.from(p.bytes));
    }catch{stop('invalid-packet-or-startup-failed');return false;}
    finally{if(heldBytes){inflight--;inflightBytes-=heldBytes;}}
  });
  const onStatus=(event,reason)=>{
    if(trusted(event)&&['compressed-queue-overflow','unsupported-access-unit','tap-copy-failed','transform-ended','track-ended'].includes(reason)){stop(reason);return;}
    if(trusted(event)&&reason==='probe-receiver-ended'){
      if(sequence) stop('track-ended');else report({status:reason,hardwareDecoderActive:'unknown'});
      return;
    }
    if(trusted(event) && ['negotiated-codec-not-h264','encoded-transform-unavailable','worker-unavailable-or-csp-blocked'].includes(reason)){stop(reason);return;}
    if(trusted(event) && ['hook-installed','attached-encoded-shadow','negotiated-h264','encoded-frame-observed','waiting-inband-parameter-sets','negotiated-codec-not-h264','existing-transform-preserved','encoded-transform-unavailable','worker-unavailable-or-csp-blocked','keyframe-request-unavailable'].includes(reason)) report({status:reason,hardwareDecoderActive:'unknown'});
    else if(trusted(event)) stop('encoded-tap-ended-or-overloaded');
  };
  ipcMain.on('native-shadow-status',onStatus);
  let initialNavigation=true;
  const navigation=(_e,_url,inPlace,isMain)=>{
    if(isMain&&!inPlace){if(initialNavigation) initialNavigation=false;else stop('source-navigation');}
  };
  const gone=()=>stop('source-renderer-gone'),destroyed=()=>stop('source-destroyed');
  source.on('render-process-gone',gone);source.on('did-start-navigation',navigation);source.once('destroyed',destroyed);
  return {prepare:()=>{starting ||=start();return starting;},stop,
    snapshot:()=>({sequence,decoded,draws,released,outstanding,stopped,helperPid:helper?.pid,helperExited,helperExitSignal,helperExitCode}),
    inspectTestOutput:()=>{if(!localTest) throw new Error('Pixel readback is restricted to the local test');return helper.inspect();},
    crashTestHelper:()=>{if(!localTest) throw new Error('Fault injection is restricted to the local test');helper.killForTest('SIGSEGV');},
    dispose:()=>{
      stop('disposed');ipcMain.removeHandler('native-shadow-bootstrap');ipcMain.removeHandler('native-shadow-packet');ipcMain.removeListener('native-shadow-status',onStatus);
      source.removeListener('did-start-navigation',navigation);source.removeListener('render-process-gone',gone);source.removeListener('destroyed',destroyed);
    }
  };
}
module.exports={attachNativeShadow};
