const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {installEncodedTap}=require('../client/encoded-tap.cjs');
async function burst(acknowledge){
  // Capture the actual serialized worker through its page bootstrap.
  let source;
  const window={RTCPeerConnection:function(){},RTCRtpScriptTransform:function(){},postMessage(){}};
  vm.runInNewContext(`(${installEncodedTap.toString()})()`,{window,location:{origin:'https://play.geforcenow.com'},
    Blob:class{constructor(parts){this.parts=parts;}},Worker:class{},crypto:webcrypto,
    URL:{createObjectURL(blob){source=blob.parts[0];return 'blob:test';},revokeObjectURL(){}}});
  const messages=[],forwarded=[],frames=[],timers=[];let pending=0,highWater=0;
  const port={postMessage(message){
    messages.push(message);
    if(message.kind==='frame'){
      pending++;highWater=Math.max(highWater,pending);
      if(acknowledge) timers.push(new Promise(resolve=>setTimeout(()=>{
        pending--;port.onmessage({data:{kind:'ack',sequence:message.sequence}});resolve();
      },0)));
    }
  }};
  const context=vm.createContext({postMessage(){},TransformStream,Uint8Array,performance,setTimeout});
  vm.runInContext(source,context);
  let resolveDone;const done=new Promise(resolve=>{resolveDone=resolve;});
  const readable=new ReadableStream({start(controller){
    for(let i=0;i<40;i++){
      const data=Uint8Array.from(i===0?[0,0,0,1,0x67,1,0,0,0,1,0x68,1,0,0,0,1,0x65,1]:[0,0,0,1,0x41,1]).buffer;
      const frame={data,type:i===0?'key':'delta',getMetadata:()=>({mimeType:'video/H264',rtpTimestamp:i*1500})};
      frames.push(frame);controller.enqueue(frame);
    }
    controller.close();
  }});
  const writable=new WritableStream({write(frame){forwarded.push(frame);},close(){resolveDone();}});
  context.onrtctransform({transformer:{options:{generation:'test',codecs:{},port},readable,writable}});
  await done;await Promise.all(timers);
  assert.equal(forwarded.length,40);
  forwarded.forEach((frame,i)=>assert.equal(frame,frames[i],'original frame identity and ordering'));
  return {messages,highWater};
}
test('tap yields during a queued burst so task-delivered ACKs drain without widening the queue',async()=>{
  const {messages,highWater}=await burst(true);
  assert.equal(messages.filter(m=>m.kind==='frame').length,40);
  assert.ok(highWater<=4);
  assert.equal(messages.some(m=>m.reason==='compressed-queue-overflow'),false);
});
test('tap still fails closed after eight unacknowledged packets and forwards every original frame',async()=>{
  const {messages,highWater}=await burst(false);
  assert.equal(messages.filter(m=>m.kind==='frame').length,8);assert.equal(highWater,8);
  assert.equal(messages.find(m=>m.reason==='compressed-queue-overflow').metrics.pending,8);
});
