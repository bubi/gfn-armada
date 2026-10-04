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
