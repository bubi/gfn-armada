const {ipcRenderer,webFrame,contextBridge}=require('electron');
// An explicit compatibility experiment, confined to the official GFN origin.
// Synchronous main-world setup precedes page scripts. No IPC/Node API is exposed.
if(location.origin==='https://play.geforcenow.com') {
  const arg=process.argv.find(v=>v.startsWith('--gfn-armada-identity='));
  if(arg)try {
    const id=JSON.parse(arg.slice('--gfn-armada-identity='.length));
    const applied=contextBridge.executeInMainWorld({func:id=>{
      for(const [key,value] of [['userAgent',id.userAgent],['appVersion',id.userAgent.replace(/^Mozilla\//,'')],['platform',id.platform]])
        Object.defineProperty(navigator,key,{configurable:true,get:()=>value});
      const hints=id.hints;
      const low=()=>({brands:hints.brands,mobile:hints.mobile,platform:hints.platform});
      const data=Object.freeze({...low(),getHighEntropyValues:async keys=>{
        const out=low();for(const key of keys)if(Object.hasOwn(hints,key))out[key]=hints[key];return out;
      },toJSON:low});
      Object.defineProperty(navigator,'userAgentData',{configurable:true,get:()=>data});
      return {userAgentMatches:navigator.userAgent===id.userAgent,platformMatches:navigator.platform===id.platform,
        hintPlatformMatches:navigator.userAgentData.platform===hints.platform};
    },args:[id]});
    ipcRenderer.send('browser-identity-status',applied);
  }catch{ipcRenderer.send('browser-identity-status',{failed:true});}
}
// Experimental HEVC negotiation; original login/UI remain in place.
// Self-contained for synchronous execution in the page's main world.
function installHevcExperiment() {
  const emit=data=>window.postMessage({type:'gfn-armada-hevc-experiment',data},location.origin);
  const caps=()=>RTCRtpReceiver.getCapabilities('video')?.codecs||[];
  const hasHevc=()=>caps().some(c=>c.mimeType.toLowerCase()==='video/h265');
  function rewrite(url,method,body) {
    try {
      const u=new URL(url,location.href);
      if(u.protocol!=='https:'||!['nvidiagrid.net','geforcenow.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))||
        u.pathname!=='/v2/session'||String(method).toUpperCase()!=='POST'||typeof body!=='string'||body.length>262144)return body;
      const value=JSON.parse(body),r=value.sessionRequestData,f=r?.requestedStreamingFeatures;
      if(!f||typeof f!=='object'||Array.isArray(f)||![0,1,2,3].includes(f.codec))return body;
      // Restrict to the observed browser WebRTC request; never alter native/resume requests.
      if(!Array.isArray(r.metaData)||!r.metaData.some(m=>m.key==='GSStreamerType'&&m.value==='WebRTC'))return body;
      const monitors=r.clientRequestMonitorSettings;
      if(r.sdrHdrMode!==0||f.bitDepth!==0||f.chromaFormat!==0||!Array.isArray(monitors)||
        !monitors.length||!monitors.every(m=>m.widthInPixels===1920&&m.heightInPixels===1080&&m.framesPerSecond===60)) {
        emit({event:'request-skipped-profile'});return body;
      }
      if(!hasHevc()){emit({event:'request-skipped-capability'});return body;}
      const previousCodec=f.codec;f.codec=2;
      emit({event:'request-preferred',previousCodec,requestedCodec:2});
      return JSON.stringify(value);
    }catch{return body;}
  }
  const fetch=window.fetch;
  window.fetch=function(input,init) {
    const url=typeof input==='string'||input instanceof URL?String(input):input?.url;
    if(init&&typeof init.body==='string')init={...init,body:rewrite(url,init.method||input?.method||'GET',init.body)};
    return fetch.call(this,input,init);
  };
  const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send,requests=new WeakMap();
  XMLHttpRequest.prototype.open=function(method,url,...rest){requests.set(this,{method,url});return open.call(this,method,url,...rest);};
  XMLHttpRequest.prototype.send=function(body){const r=requests.get(this);return send.call(this,r?rewrite(r.url,r.method,body):body);};
  // Read only video sections; export codec names, never raw SDP/ICE/identifiers.
  function offered(sdp) {
    const names=new Set();let video=false;
    for(const line of String(sdp||'').split(/\r?\n/)) {
      if(line.startsWith('m='))video=line.startsWith('m=video ');
      if(video){const m=line.match(/^a=rtpmap:\d+ (H264|H265|AV1)\/90000/i);if(m)names.add(m[1].toUpperCase());}
    }
    return [...names];
  }
  const remote=RTCPeerConnection.prototype.setRemoteDescription,answer=RTCPeerConnection.prototype.createAnswer;
  RTCPeerConnection.prototype.setRemoteDescription=function(description) {
    if(description?.type==='offer')emit({event:'server-offer',codecs:offered(description.sdp)});
    return remote.call(this,description);
  };
  RTCPeerConnection.prototype.createAnswer=async function(...args) {
    if(this.remoteDescription?.type==='offer'&&offered(this.remoteDescription.sdp).includes('H265')) {
      try {
        const codecs=caps();
        const rank=c=>c.mimeType.toLowerCase()==='video/h265'?0:c.mimeType.toLowerCase()==='video/h264'?1:2;
        if(hasHevc())for(const t of this.getTransceivers())if(t.receiver.track.kind==='video')
          t.setCodecPreferences([...codecs].sort((a,b)=>rank(a)-rank(b)));
        emit({event:'answer-preferred',fallback:'H264'});
      }catch{emit({event:'answer-preference-failed'});}
    }
    const result=await answer.apply(this,args);
    emit({event:'answer-created',codecs:offered(result.sdp)});return result;
  };
  emit({event:'installed',receiveHevc:hasHevc()});
}
if(location.origin==='https://play.geforcenow.com'&&process.argv.includes('--gfn-armada-hevc-experiment')) {
  let count=0;
  window.addEventListener('message',e=>{
    if(e.source===window&&e.origin===location.origin&&e.data?.type==='gfn-armada-hevc-experiment'&&count++<100)
      ipcRenderer.send('hevc-experiment-status',e.data.data);
  });
  try{contextBridge.executeInMainWorld({func:installHevcExperiment});}
  catch{ipcRenderer.send('hevc-experiment-status',{event:'install-failed'});}
}
// No Node API exposed to the remote page. Main-world observations are untrusted.
function observe() {
  const peers=new Set();
  const Native=window.RTCPeerConnection;
  if(Native) {
    window.RTCPeerConnection=new Proxy(Native,{construct(target,args,newTarget){
      const pc=Reflect.construct(target,args,newTarget);peers.add(pc);
      pc.addEventListener('connectionstatechange',()=>{if(pc.connectionState==='closed') peers.delete(pc)});
      return pc;
    }});
  }
  setInterval(async()=>{
    const streams=[];
    for(const pc of peers) {try {
      const stats=await pc.getStats();
      stats.forEach(s=>{if(s.type==='inbound-rtp'&&(s.kind==='video'||s.mediaType==='video')) {
        const c=stats.get(s.codecId);
        streams.push({codec:c?.mimeType||'unknown',decoder:s.decoderImplementation||'unknown',
          powerEfficientDecoder:typeof s.powerEfficientDecoder==='boolean'?s.powerEfficientDecoder:null,
          framesDecoded:s.framesDecoded??null,framesDropped:s.framesDropped??null,
          totalDecodeTime:s.totalDecodeTime??null,
          meanDecodeMs:s.framesDecoded?1000*s.totalDecodeTime/s.framesDecoded:null});
      }});
    }catch{}}
    const codecs=window.RTCRtpReceiver?.getCapabilities('video')?.codecs?.map(c=>c.mimeType)||[];
    const controllers=Array.from(navigator.getGamepads?.()||[]).filter(Boolean).map(g=>({index:g.index,mapping:g.mapping,buttons:g.buttons.length,axes:g.axes.length}));
    let renderer='unknown';try{const gl=document.createElement('canvas').getContext('webgl');const ext=gl?.getExtension('WEBGL_debug_renderer_info');if(ext) renderer=gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}catch{}
    window.postMessage({type:'gfn-armada-observation',payload:{streams,codecs,controllers,renderer}},location.origin);
  },5000);
}
if(location.origin==='https://play.geforcenow.com') {
  let last=0;
  window.addEventListener('message',e=>{
    if(e.source!==window || e.origin!==location.origin || e.data?.type!=='gfn-armada-observation' || Date.now()-last<4000) return;
    let size;try{size=JSON.stringify(e.data.payload).length}catch{return}
    if(size>16384) return;last=Date.now();ipcRenderer.send('rtc-observation',e.data.payload);
  });
  webFrame.executeJavaScript(`(${observe.toString()})()`).catch(()=>{});
  // Enabled only by Main's explicit native-shadow option. Remote data stays untrusted.
  let encodedEnabled=false,statusSecond=0,statusCount=0;
  const sendStatus=reason=>{
    const second=Math.floor(Date.now()/1000);
    if(second!==statusSecond){statusSecond=second;statusCount=0;}
    if(typeof reason==='string'&&reason.length<100&&statusCount++<8) ipcRenderer.send('native-shadow-status',reason);
  };
  // Only the setup port crosses the page. Frames/ACKs then bypass its event loop.
  ipcRenderer.on('native-shadow-channel',(event,data)=>{
    if(!encodedEnabled||typeof data?.generation!=='string'||event.ports.length!==1) return;
    window.postMessage({type:'gfn-armada-encoded-channel',generation:data.generation},location.origin,event.ports);
  });
  window.addEventListener('message',event=>{
    if(event.source!==window||event.origin!==location.origin||!encodedEnabled) return;
    const data=event.data;
    if(data?.type==='gfn-armada-encoded-channel-request'){
      if(typeof data.generation!=='string'||!/^[0-9a-f-]{36}$/.test(data.generation)) return;
      ipcRenderer.invoke('native-shadow-channel',data.generation).then(ok=>{if(!ok) sendStatus('encoded-channel-unavailable');}).catch(()=>sendStatus('encoded-channel-unavailable'));
    }else if(data?.type==='gfn-armada-encoded-status') sendStatus(data.reason);
  });
  ipcRenderer.invoke('native-shadow-bootstrap').then(source=>{
    if(typeof source==='string' && source.length<32000){encodedEnabled=true;return webFrame.executeJavaScript(source);}
  }).catch(()=>{});
}
