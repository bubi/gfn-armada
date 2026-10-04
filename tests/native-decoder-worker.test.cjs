const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Worker}=require('node:worker_threads');
function launch(fixture){
  const worker=new Worker(path.join(__dirname,'../client/native-decoder-worker.cjs'),{workerData:{addon:path.join(__dirname,'fixtures',fixture)}});
  const messages=[];
  worker.on('message',message=>messages.push(message));
  return {worker,messages};
}
function receive(worker,kind,predicate=()=>true){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error(`Missing ${kind}`));},3000);
    const handler=message=>{if(message.kind===kind&&predicate(message)){cleanup();resolve(message);}};
    const error=error=>{cleanup();reject(error);};
    function cleanup(){clearTimeout(timer);worker.off('message',handler);worker.off('error',error);}
    worker.on('message',handler);worker.on('error',error);
  });
}
test('decoder readiness waits for pipeline preparation and accepts a first packet burst',async t=>{
  const {worker,messages}=launch('prewarm-decoder.cjs');t.after(()=>worker.terminate());
  await receive(worker,'ready');
  assert.deepEqual(messages.slice(0,2).map(m=>m.kind),['opened','ready']);
  const acks=receive(worker,'ack',message=>message.sequence===8);
  for(let sequence=1;sequence<=8;sequence++) worker.postMessage({kind:'push',sequence,bytes:Buffer.from([0,0,0,1,0x65]),timestampUs:sequence*16667,key:sequence===1});
  await acks;
  assert.equal(messages.filter(m=>m.kind==='ack'&&m.accepted).length,8);
  const closed=receive(worker,'closed');worker.postMessage({kind:'stop'});await closed;
});
test('unavailable decoder fails before readiness and closes without a live stream',async t=>{
  const {worker,messages}=launch('unavailable-decoder.cjs');t.after(()=>worker.terminate());
  const failed=receive(worker,'failed'),closed=receive(worker,'closed');
  assert.equal((await failed).reason,'test-pipeline-unavailable');await closed;
  assert.equal(messages.some(m=>m.kind==='ready'),false);
});
