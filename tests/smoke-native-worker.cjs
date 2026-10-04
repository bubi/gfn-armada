// Run in the Fedora ARM64 builder without V4L2 decoder plugins/devices.
const {Worker}=require('node:worker_threads');
const assert=require('node:assert/strict');
const path=require('node:path');
const addon=process.env.GFN_ARMADA_NATIVE_BRIDGE;
if(!addon || !path.isAbsolute(addon)) throw new Error('Absolute addon path required');
const worker=new Worker(path.join(__dirname,'../client/native-decoder-worker.cjs'),{workerData:{addon}});
let ready=false,failed=false,closed=false;
const timeout=setTimeout(()=>{console.error('Native worker deadline exceeded');process.exit(1)},10000);
worker.on('message',message=>{
  if(message.kind==='ready'){
    ready=true;worker.postMessage({kind:'push',sequence:1,bytes:new Uint8Array([0,0,0,1,0x65]),timestampUs:0,key:true});
  }else if(message.kind==='failed'){
    assert.match(message.reason,/explicit v4l2h264dec pipeline unavailable/);
    failed=true;worker.postMessage({kind:'stop'});
  }else if(message.kind==='closed') closed=true;
});
worker.on('error',error=>{clearTimeout(timeout);throw error;});
worker.on('exit',code=>{
  clearTimeout(timeout);assert.equal(code,0);assert.ok(ready&&failed&&closed);
  console.log(JSON.stringify({status:'passed',scope:'native-worker-startup-and-missing-decoder-fallback',hardwareTested:false}));
});
