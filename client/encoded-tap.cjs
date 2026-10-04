// Serialized into the page. This is an opt-in observation tap, not a transport replacement.
function installEncodedTap() {
  if(window.__gfnArmadaEncodedTap) return;
  const state={attached:false}; window.__gfnArmadaEncodedTap=state;
  let preparedWorker,preparedURL,workerReady=false,pendingReceiver;
  function workerSource() {
    postMessage({kind:'ready'});
    onrtctransform=event=>{
      const transformer=event.transformer, generation=transformer.options.generation;
      let pendingBytes=0, enabled=true, started=false, sequence=0,observed=0,codecReported=false;
      const pending=new Map();
      const report=reason=>postMessage({kind:'status',generation,reason});
      onmessage=e=>{
        if(e.data?.kind==='ack' && pending.has(e.data.sequence)){
          pendingBytes-=pending.get(e.data.sequence);pending.delete(e.data.sequence);
        }
        if(e.data?.kind==='disable') enabled=false;
      };
      transformer.sendKeyFrameRequest?.().catch(()=>report('keyframe-request-unavailable'));
      transformer.readable.pipeThrough(new TransformStream({transform(frame,controller){
        // Always forward the original frame unchanged, including after bridge failure.
        try {
          if(enabled) {
            const bytes=new Uint8Array(frame.data);
            if(!observed++) report('encoded-frame-observed');
            const metadata=frame.getMetadata();
            const mime=metadata.mimeType || transformer.options.codecs[metadata.payloadType];
            if(mime!=='video/H264'){enabled=false;report('negotiated-codec-not-h264');return;}
            if(!codecReported){codecReported=true;report('negotiated-h264');}
            const annex=bytes.length>=4 && bytes[0]===0 && bytes[1]===0 && (bytes[2]===1 || (bytes[2]===0 && bytes[3]===1));
            let sps=false,pps=false;
            if(!started && frame.type==='key' && annex) {
              for(let i=0;i<bytes.length-4;i++) if(bytes[i]===0 && bytes[i+1]===0) {
                const n=bytes[i+2]===1?i+3:(bytes[i+2]===0&&bytes[i+3]===1?i+4:-1);
                if(n>=0){sps ||= (bytes[n]&31)===7;pps ||= (bytes[n]&31)===8;}
              }
              if(sps&&pps) started=true;
              else report('waiting-inband-parameter-sets');
            }
            if(started) {
              const full=pending.size>=8 || pendingBytes+bytes.length>4194304;
              if(!annex || bytes.length>2097152 || full) {
                enabled=false; report(full?'compressed-queue-overflow':'unsupported-access-unit');
              } else {
                pending.set(++sequence,bytes.length);pendingBytes+=bytes.length;const copy=frame.data.slice(0);
                postMessage({kind:'frame',generation,sequence,timestamp:metadata.rtpTimestamp??frame.timestamp,key:frame.type==='key',bytes:copy},[copy]);
              }
            }
          }
        } catch {enabled=false;report('tap-copy-failed');}
        finally {controller.enqueue(frame);}
      }})).pipeTo(transformer.writable).catch(()=>report(observed?'transform-ended':'transform-ended-before-stream'));
    };
  }
  function report(reason) {window.postMessage({type:'gfn-armada-encoded-status',reason},location.origin);}
  function attach(receiver) {
    if(state.attached || receiver.track?.kind!=='video' || receiver.track.readyState==='ended') return;
    if(!workerReady){pendingReceiver ||= receiver;return;}
    if(receiver.transform) {report('existing-transform-preserved');return;}
    try {
      const generation=crypto.randomUUID();
      const codecs=Object.fromEntries((receiver.getParameters().codecs||[]).map(c=>[c.payloadType,c.mimeType]));
      const url=preparedURL,worker=preparedWorker;
      let transform,seenFrame=false;
      worker.onerror=()=>{
        if(receiver.transform===transform) receiver.transform=null;
        worker.terminate();URL.revokeObjectURL(url);report('worker-unavailable-or-csp-blocked');
      };
      const resetProbe=()=>{
        if(preparedWorker!==worker) return;
        worker.terminate();URL.revokeObjectURL(url);window.removeEventListener('message',feedback);
        state.attached=false;workerReady=false;pendingReceiver=undefined;
        report('probe-receiver-ended');prepareWorker();
      };
      worker.onmessage=e=>{
        if(e.data.kind==='status' && e.data.reason==='transform-ended-before-stream'){resetProbe();return;}
        if(e.data.kind==='frame' || (e.data.kind==='status'&&e.data.reason==='encoded-frame-observed')) seenFrame=true;
        URL.revokeObjectURL(url);window.postMessage({type:'gfn-armada-encoded',...e.data},location.origin,e.data.bytes?[e.data.bytes]:[]);
      };
      const feedback=e=>{
        if(e.source===window && e.origin===location.origin && e.data?.type==='gfn-armada-encoded-feedback' && e.data.generation===generation)
          worker.postMessage({kind:e.data.accepted?'ack':'disable',sequence:e.data.sequence});
      };
      window.addEventListener('message',feedback);
      transform=new RTCRtpScriptTransform(worker,{generation,codecs});receiver.transform=transform;state.attached=true;
      receiver.track.addEventListener('ended',()=>{
        if(!seenFrame){resetProbe();return;}
        worker.terminate();URL.revokeObjectURL(url);window.removeEventListener('message',feedback);report('track-ended');
      },{once:true});
      report('attached-encoded-shadow');
    }catch{report('encoded-transform-unavailable');}
  }
  state.attach=attach; // Also used by the local test, never a native capability.
  const Native=window.RTCPeerConnection;
  if(!Native || !window.RTCRtpScriptTransform){report('encoded-transform-unavailable');return;}
  // Verify worker loading/CSP before inserting it into a live decoder path.
  function prepareWorker(){try {
    preparedURL=URL.createObjectURL(new Blob([`(${workerSource.toString()})()`],{type:'text/javascript'}));
    preparedWorker=new Worker(preparedURL);
    preparedWorker.onerror=()=>{URL.revokeObjectURL(preparedURL);preparedWorker.terminate();report('worker-unavailable-or-csp-blocked');};
    preparedWorker.onmessage=e=>{
      if(e.data?.kind==='ready'){
        URL.revokeObjectURL(preparedURL);workerReady=true;state.ready=true;
        if(pendingReceiver) attach(pendingReceiver);
      }
    };
  }catch{report('worker-unavailable-or-csp-blocked');}}
  prepareWorker();
  window.RTCPeerConnection=new Proxy(Native,{construct(target,args,newTarget){
    const pc=Reflect.construct(target,args,newTarget);
    // Let GFN's synchronous track handler install its own transform first.
    pc.addEventListener('track',event=>queueMicrotask(()=>attach(event.receiver)));return pc;
  }});
  report('hook-installed');
}
module.exports={installEncodedTap};
