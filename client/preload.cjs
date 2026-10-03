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
}
