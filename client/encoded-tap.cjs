// Serialized into the page. This is an opt-in observation tap, not a transport replacement.
function installEncodedTap() {
  if(window.__gfnArmadaEncodedTap) return;
  const state={attached:false}; window.__gfnArmadaEncodedTap=state;
  let preparedWorker,preparedURL,preparedPort,preparedGeneration,workerReady=false,pendingReceiver;
  function workerSource() {
    postMessage({kind:'ready'});
    onrtctransform=event=>{
      const transformer=event.transformer, generation=transformer.options.generation,port=transformer.options.port;
      let pendingBytes=0, enabled=true, started=false, sequence=0,observed=0,codecReported=false;
      const pending=new Map();
      let highWater=0,ackCount=0,ackMaxMs=0,lastMetrics=0,yieldCount=0,yieldMaxMs=0,accessUnitBytes=0,annexB=0;
      const metrics=()=>({stage:"tap",pending:pending.size,pendingBytes,highWater,ackCount,ackMaxMs,yieldCount,yieldMaxMs,accessUnitBytes,annexB,oldestMs:pending.size?performance.now()-pending.values().next().value.at:0});
      const report=reason=>{port.postMessage({kind:'status',generation,reason,metrics:metrics()});
        if(['encoded-frame-observed','transform-ended-before-stream'].includes(reason)) postMessage({kind:'lifecycle',reason});};
      port.onmessage=e=>{
        if(e.data?.kind==='ack' && pending.has(e.data.sequence)){
          const item=pending.get(e.data.sequence);ackMaxMs=Math.max(ackMaxMs,performance.now()-item.at);ackCount++;
          pendingBytes-=item.bytes;pending.delete(e.data.sequence);
          if(performance.now()-lastMetrics>=1000){lastMetrics=performance.now();report("queue-metrics");}
        }
        if(e.data?.kind==='disable') enabled=false;
      };
      transformer.sendKeyFrameRequest?.().catch(()=>report('keyframe-request-unavailable'));
      transformer.readable.pipeThrough(new TransformStream({async transform(frame,controller){
        // Always forward the original frame unchanged, including after bridge failure.
        try {
          if(enabled) {
            const bytes=new Uint8Array(frame.data);accessUnitBytes=bytes.length;
            if(!observed++) report('encoded-frame-observed');
            const metadata=frame.getMetadata();
            const mime=metadata.mimeType || transformer.options.codecs[metadata.payloadType];
            if(mime!=='video/H264'){enabled=false;report('negotiated-codec-not-h264');return;}
            if(!codecReported){codecReported=true;report('negotiated-h264');}
            const annex=bytes.length>=4 && bytes[0]===0 && bytes[1]===0 && (bytes[2]===1 || (bytes[2]===0 && bytes[3]===1));
            annexB=annex?1:0;
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
                enabled=false; report(full?'compressed-queue-overflow':bytes.length===0?'empty-access-unit':bytes.length>2097152?'oversized-access-unit':'non-annexb-access-unit');
              } else {
                pending.set(++sequence,{bytes:bytes.length,at:performance.now()});highWater=Math.max(highWater,pending.size);pendingBytes+=bytes.length;const copy=frame.data.slice(0);
                port.postMessage({kind:'frame',generation,sequence,timestamp:metadata.rtpTimestamp??frame.timestamp,key:frame.type==='key',bytes:copy},[copy]);
              }
            }
          }
        } catch {enabled=false;report('tap-copy-failed');}
        finally {controller.enqueue(frame);}
        // A burst of resolved stream promises can starve MessagePort ACK tasks.
        // Forward first, then give tasks one turn; never wait indefinitely for credit.
        if(enabled && pending.size>=4){
          const began=performance.now();yieldCount++;await new Promise(resolve=>setTimeout(resolve,0));
          yieldMaxMs=Math.max(yieldMaxMs,performance.now()-began);
        }
      }})).pipeTo(transformer.writable).catch(()=>report(observed?'transform-ended':'transform-ended-before-stream'));
    };
  }
  function report(reason) {window.postMessage({type:'gfn-armada-encoded-status',reason},location.origin);}
  function attach(receiver) {
    if(state.attached || receiver.track?.kind!=='video' || receiver.track.readyState==='ended') return;
    if(!workerReady){pendingReceiver ||= receiver;return;}
    if(receiver.transform) {report('existing-transform-preserved');return;}
    try {
      const generation=preparedGeneration;
      const codecs=Object.fromEntries((receiver.getParameters().codecs||[]).map(c=>[c.payloadType,c.mimeType]));
      const url=preparedURL,worker=preparedWorker;
      let transform,seenFrame=false;
      worker.onerror=()=>{
        if(receiver.transform===transform) receiver.transform=null;
        worker.terminate();URL.revokeObjectURL(url);report('worker-unavailable-or-csp-blocked');
      };
      const resetProbe=()=>{
        if(preparedWorker!==worker) return;
        worker.terminate();URL.revokeObjectURL(url);
        state.attached=false;state.ready=false;workerReady=false;pendingReceiver=undefined;
        report('probe-receiver-ended');prepareWorker();
      };
      worker.onmessage=e=>{
        if(e.data.kind!=='lifecycle') return;
        if(e.data.reason==='transform-ended-before-stream'){resetProbe();return;}
        if(e.data.reason==='encoded-frame-observed') seenFrame=true;
      };
      const port=preparedPort;preparedPort=undefined;
      transform=new RTCRtpScriptTransform(worker,{generation,codecs,port},[port]);receiver.transform=transform;state.attached=true;
      receiver.track.addEventListener('ended',()=>{
        if(!seenFrame){resetProbe();return;}
        worker.terminate();URL.revokeObjectURL(url);report('track-ended');
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
    const worker=preparedWorker,generation=crypto.randomUUID();preparedGeneration=generation;
    let channelTimer;
    const channel=e=>{
      if(e.source!==window||e.origin!==location.origin||e.data?.type!=='gfn-armada-encoded-channel'||e.data.generation!==generation||e.ports.length!==1) return;
      clearTimeout(channelTimer);window.removeEventListener('message',channel);
      if(preparedWorker!==worker){e.ports[0].close();return;}
      preparedPort=e.ports[0];workerReady=true;state.ready=true;
      if(pendingReceiver) attach(pendingReceiver);
    };
    preparedWorker.onmessage=e=>{
      if(e.data?.kind==='ready'){
        URL.revokeObjectURL(preparedURL);window.addEventListener('message',channel);
        channelTimer=setTimeout(()=>{window.removeEventListener('message',channel);worker.terminate();report('encoded-channel-unavailable');},3000);
        window.postMessage({type:'gfn-armada-encoded-channel-request',generation},location.origin);
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
