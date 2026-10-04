const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {startHelper}=require('../client/helper-process.cjs');
function fixture(mode,readyTimeoutMs){
  const events=[];let resolveExit;const exit=new Promise(resolve=>{resolveExit=resolve;});
  const helper=startHelper({command:process.execPath,args:[path.join(__dirname,'fixtures/helper-process.cjs'),mode],env:process.env,readyTimeoutMs,
    onEvent:event=>{events.push(event);if(event.kind==='exit') resolveExit(event);}});
  return {helper,events,exit};
}
test('helper death rejects pending packets without terminating the supervisor',async()=>{
  const {helper,events,exit}=fixture('hold-second');await helper.prepared;
  assert.notEqual(helper.pid,process.pid);
  const bytes=Buffer.from([0,0,0,1,0x65]);
  assert.equal(await helper.push({sequence:1,timestampUs:0,key:true},bytes),true);
  const pending=helper.push({sequence:2,timestampUs:16667,key:false},bytes);
  helper.killForTest('SIGKILL');
  assert.equal(await pending,false);assert.equal((await exit).signal,'SIGKILL');
  assert.ok(events.some(e=>e.kind==='exit'));assert.equal(await helper.push({sequence:3},bytes),false);
});
test('malformed helper control fails closed and terminates only the helper',async()=>{
  const {helper,events,exit}=fixture('invalid-control');await helper.prepared;
  assert.equal(await helper.push({sequence:1},Buffer.from([0,0,0,1,0x65])),false);
  await exit;assert.ok(events.some(e=>e.reason==='invalid-helper-control'));
});
test('helper startup deadline is enforced for a non-ready process',async()=>{
  const {helper,events,exit}=fixture('no-ready',150);
  await assert.rejects(helper.prepared,/readiness timeout/);await exit;
  assert.ok(events.some(e=>e.reason==='helper-readiness-timeout'));
});

test('helper queue telemetry measures ACK delay, bounded high water and drain',async()=>{
  const {helper,exit}=fixture('delayed-ack');await helper.prepared;
  const bytes=Buffer.from([0,0,0,1,0x65]);
  const first=helper.push({sequence:1},bytes),second=helper.push({sequence:2},bytes);
  assert.equal(helper.metrics().pending,2);assert.equal(helper.metrics().pendingBytes,10);
  assert.deepEqual(await Promise.all([first,second]),[true,true]);
  const m=helper.metrics();assert.equal(m.highWater,2);assert.equal(m.ackCount,2);
  assert.ok(m.ackMaxMs>=40);assert.equal(m.pending,0);assert.equal(m.oldestMs,0);
  helper.stop();await exit;
});
