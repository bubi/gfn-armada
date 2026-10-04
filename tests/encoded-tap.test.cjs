const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {installEncodedTap}=require('../client/encoded-tap.cjs');
const PARAMETER_SET_KEYFRAME=[0,0,0,1,0x67,1,0,0,0,1,0x68,1,0,0,0,1,0x65,1];
async function burst(acknowledge,invalidData,keyframeAt){
  // Capture the actual serialized worker through its page bootstrap.
  let source;
  const window={RTCPeerConnection:function(){},RTCRtpScriptTransform:function(){},postMessage(){}};
  vm.runInNewContext(`(${installEncodedTap.toString()})()`,{window,location:{origin:'https://play.geforcenow.com'},
    Blob:class{constructor(parts){this.parts=parts;}},Worker:class{},crypto:webcrypto,
    URL:{createObjectURL(blob){source=blob.parts[0];return 'blob:test';},revokeObjectURL(){}}});
  const messages=[],forwarded=[],frames=[],timers=[];let pending=0,highWater=0,held=[],keyframeRequests=0,releasing=false;
  const later=ack=>timers.push(new Promise(resolve=>setTimeout(()=>{ack();resolve();},0)));
  const port={postMessage(message){
    messages.push(message);
    // Withholding credit until the overflow reproduces a burst that outruns every
    // acknowledgement; releasing it afterwards lets the tap resume on its own.
    if(message.reason==='queue-overflow-resync'&&acknowledge==='after-resync'){
      releasing=true;const batch=held;held=[];if(batch.length) later(()=>batch.forEach(ack=>ack()));
    }
    if(message.kind!=='frame') return;
    pending++;highWater=Math.max(highWater,pending);
    const ack=()=>{pending--;port.onmessage({data:{kind:'ack',sequence:message.sequence}});};
    if(acknowledge===true||releasing) later(ack);
    else if(acknowledge==='after-resync') held.push(ack);
  }};
  const context=vm.createContext({postMessage(){},TransformStream,Uint8Array,performance,setTimeout});
  vm.runInContext(source,context);
  let resolveDone;const done=new Promise(resolve=>{resolveDone=resolve;});
  const readable=new ReadableStream({start(controller){
    for(let i=0;i<40;i++){
      const key=i===0||i===keyframeAt;
      const data=i===3&&invalidData?invalidData.buffer:Uint8Array.from(key?PARAMETER_SET_KEYFRAME:[0,0,0,1,0x41,1]).buffer;
      const frame={data,type:key?'key':'delta',getMetadata:()=>({mimeType:'video/H264',rtpTimestamp:i*1500})};
      frames.push(frame);controller.enqueue(frame);
    }
    controller.close();
  }});
  const writable=new WritableStream({write(frame){forwarded.push(frame);},close(){resolveDone();}});
  context.onrtctransform({transformer:{options:{generation:'test',codecs:{},port},readable,writable,
    sendKeyFrameRequest(){keyframeRequests++;return Promise.resolve();}}});
  await done;await Promise.all(timers);
  assert.equal(forwarded.length,40);
  forwarded.forEach((frame,i)=>assert.equal(frame,frames[i],'original frame identity and ordering'));
  return {messages,highWater,keyframeRequests};
}
test('tap yields during a queued burst so task-delivered ACKs drain without widening the queue',async()=>{
  const {messages,highWater}=await burst(true);
  assert.equal(messages.filter(m=>m.kind==='frame').length,40);
  assert.ok(highWater<=4);
  assert.equal(messages.some(m=>m.reason==='queue-overflow-resync'),false);
});
test('tap bounds an unacknowledged burst at eight copies and resyncs instead of failing closed',async()=>{
  const {messages,highWater,keyframeRequests}=await burst(false);
  assert.equal(messages.filter(m=>m.kind==='frame').length,8);assert.equal(highWater,8);
  const resync=messages.find(m=>m.reason==='queue-overflow-resync');
  assert.equal(resync.metrics.pending,8);assert.equal(resync.metrics.resyncCount,1);
  // One resync, one keyframe request: without returning credit the remainder stays dropped.
  assert.equal(messages.filter(m=>m.reason==='queue-overflow-resync').length,1);
  assert.ok(keyframeRequests>=2,'resync requests a fresh keyframe');
  assert.equal(messages.some(m=>m.reason==='compressed-queue-overflow'),false);
});
test('tap resumes at the next parameter-set keyframe once credit returns instead of ending the bridge',async()=>{
  const {messages}=await burst('after-resync',undefined,20);
  const frames=messages.filter(m=>m.kind==='frame');
  assert.equal(frames.length,8+20,'eight before the overflow, then frame 20 onwards');
  assert.ok(messages.some(m=>m.reason==='queue-overflow-resync'));
  assert.ok(messages.some(m=>m.reason==='queue-resync-resumed'));
  // Decoding must restart on a keyframe, never mid-GOP.
  assert.equal(frames[8].key,true);
  const resumed=messages.find(m=>m.reason==='queue-resync-resumed');
  assert.equal(resumed.metrics.dropped,12);assert.equal(resumed.metrics.resyncCount,1);
});

for(const [reason,bytes,annexB] of [
  ['empty-access-unit',new Uint8Array(0),0],
  ['non-annexb-access-unit',Uint8Array.from([0x41,1]),0],
  ['oversized-access-unit',new Uint8Array(2097153),0]
]) test(`tap recovers from ${reason} on a parameter-set keyframe without exporting payload bytes`,async()=>{
  const {messages,keyframeRequests}=await burst(true,bytes,20);
  const status=messages.find(m=>m.reason===reason);
  assert.ok(status);assert.equal(status.metrics.accessUnitBytes,bytes.length);
  assert.equal(status.metrics.annexB,annexB);assert.equal(status.bytes,undefined);
  const copied=messages.filter(m=>m.kind==='frame');
  assert.equal(copied.length,23);assert.equal(copied[3].key,true);
  assert.ok(keyframeRequests>=2);assert.equal(status.metrics.resyncing,1);
  const resumed=messages.find(m=>m.reason==='queue-resync-resumed');
  assert.equal(resumed.metrics.dropped,17);assert.equal(resumed.metrics.resyncCount,1);
  assert.equal(resumed.metrics.resyncing,0);
});
