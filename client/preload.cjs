const {ipcRenderer,webFrame}=require('electron');
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
  let pendingEncoded=0,pendingBytes=0,encodedEnabled=false,statusSecond=0,statusCount=0;
  const bufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
  let highWater=0,ackCount=0,ackMaxMs=0,lastMetrics=0;
  const pendingTimes=new Map();
  const queueMetrics=()=>({stage:"preload",pending:pendingEncoded,pendingBytes,highWater,ackCount,ackMaxMs,oldestMs:pendingTimes.size?performance.now()-pendingTimes.values().next().value:0});
  const sendStatus=(reason,metrics)=>{
    const second=Math.floor(Date.now()/1000);
    if(second!==statusSecond){statusSecond=second;statusCount=0;}
    if(typeof reason==='string' && reason.length<100 && statusCount++<8) ipcRenderer.send('native-shadow-status',reason,metrics);
  };
  let encodedPort;
  window.addEventListener('message',event=>{
    if(event.source!==window||event.origin!==location.origin||!encodedEnabled||event.data?.type!=='gfn-armada-encoded-channel-request') return;
    const generation=event.data.generation;
    if(typeof generation!=='string'||generation.length!==36) return;
    encodedPort?.close();const channel=new MessageChannel();encodedPort=channel.port1;
    const port=encodedPort;
    port.onmessage=e=>{if(e.data?.generation===generation) receiveEncoded(e.data,port);};
    window.postMessage({type:'gfn-armada-encoded-channel',generation},location.origin,[channel.port2]);
  });
  async function receiveEncoded(data,port){
    if(data.kind==='status'){sendStatus(data.reason,data.metrics);return;}
    if(data.kind!=='frame' || typeof data.generation!=='string' || data.generation.length!==36) return;
    let byteLength;try{byteLength=bufferLength.call(data.bytes)}catch{return;}
    if(!byteLength || byteLength>2097152) return;
    if(pendingEncoded>=8 || pendingBytes+byteLength>4194304){sendStatus('compressed-queue-overflow',queueMetrics());return;}
    pendingEncoded++;pendingBytes+=byteLength;highWater=Math.max(highWater,pendingEncoded);
    const started=performance.now(),token={};pendingTimes.set(token,started);
    let accepted=false;
    try{
      accepted=await ipcRenderer.invoke('native-shadow-packet',{generation:data.generation,sequence:data.sequence,
        timestamp:data.timestamp,key:data.key,bytes:new Uint8Array(data.bytes)});
    }catch{}finally{
      ackCount++;ackMaxMs=Math.max(ackMaxMs,performance.now()-started);pendingTimes.delete(token);
      pendingEncoded--;pendingBytes-=byteLength;
      if(performance.now()-lastMetrics>=1000){lastMetrics=performance.now();sendStatus("queue-metrics",queueMetrics());}
      port.postMessage({kind:accepted?'ack':'disable',sequence:data.sequence});
    }
  }
  window.addEventListener('message',event=>{
    if(event.source===window&&event.origin===location.origin&&encodedEnabled&&event.data?.type==='gfn-armada-encoded-status') sendStatus(event.data.reason);
  });
  ipcRenderer.invoke('native-shadow-bootstrap').then(source=>{
    if(typeof source==='string' && source.length<32000){encodedEnabled=true;return webFrame.executeJavaScript(source);}
  }).catch(()=>{});
}
