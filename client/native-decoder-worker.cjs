const {parentPort,workerData}=require('node:worker_threads');
const bridge=require(workerData.addon);
if(['openStream','pushFrame','pullFrame','releaseFrame','close'].some(name=>typeof bridge[name]!=='function'))
  throw new Error('Native addon does not implement the H264 stream API');
let opened=false,stopping=false,leases=new Set(),timer;
function failure(reason) {
  if(!stopping){stopping=true;clearInterval(timer);parentPort.postMessage({kind:'failed',reason:String(reason).slice(0,300)});}
}
function finish() {
  if(stopping && !leases.size){if(opened) bridge.close();parentPort.postMessage({kind:'closed'});parentPort.close();}
}
parentPort.on('message',message=>{
  try {
    if(message.kind==='release') {bridge.releaseFrame(message.id);leases.delete(message.id);finish();return;}
    if(message.kind==='stop'){stopping=true;clearInterval(timer);finish();return;}
    if(stopping) return;
    if(message.kind==='push') {
      if(!opened){const decoder=bridge.openStream();opened=true;parentPort.postMessage({kind:'opened',device:decoder.device});}
      const accepted=bridge.pushFrame(Buffer.from(message.bytes),message.timestampUs,message.key);
      parentPort.postMessage({kind:'ack',sequence:message.sequence,accepted});
      if(!accepted) failure('native-compressed-queue-overflow');
    }
  }catch(error){failure(error.message);}
});
timer=setInterval(()=>{
  if(!opened || stopping || leases.size>=4) return;
  try {
    const frame=bridge.pullFrame(0);
    if(frame.textureInfo){leases.add(frame.leaseId);parentPort.postMessage({kind:'frame',...frame});}
    else if(frame.eos) failure('unexpected-decoder-eos');
  }catch(error){failure(error.message);}
},4);
parentPort.postMessage({kind:'ready'});
