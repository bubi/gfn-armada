const test=require('node:test'),assert=require('node:assert/strict');
const {connect,loopback}=require('../steam-integration/cef.cjs');
class Socket extends EventTarget{
  static instances=[];
  constructor(url){super();this.url=url;Socket.instances.push(this);queueMicrotask(()=>this.dispatchEvent(new Event('open')))}
  send(text){const request=JSON.parse(text);this.sent=request;queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id:request.id,result:{result:{value:{status:'ready'}}}})})))}
  close(){this.dispatchEvent(new Event('close'))}
}
const page={title:'SharedJSContext',url:'https://steamloopback.host/routes/library/home',webSocketDebuggerUrl:'ws://127.0.0.1:8080/devtools/page/test'};
const fetchPages=pages=>async()=>({ok:true,text:async()=>JSON.stringify(pages)});
test('CEF connection prefers Steam library context and correlates only requested replies',async()=>{
  const bridge=await connect({fetch:fetchPages([{title:'Steam Big Picture Mode',url:'about:blank',webSocketDebuggerUrl:'ws://127.0.0.1:8080/other'},page]),WebSocket:Socket});
  const socket=Socket.instances.at(-1);assert.equal(socket.url,page.webSocketDebuggerUrl);
  assert.equal((await bridge.evaluate('1')).status,'ready');assert.equal(socket.sent.method,'Runtime.evaluate');bridge.close();await assert.rejects(bridge.evaluate('1'),/closed/);
});
test('Steam debug endpoint rejects external hosts, credentials, port drift and unrelated contexts',async()=>{
  for(const url of ['ws://evil.example:8080/test','ws://127.0.0.1:9090/test','ws://secret@127.0.0.1:8080/test','wss://127.0.0.1:8080/test'])assert.throws(()=>loopback(url,'ws:',8080));
  await assert.rejects(connect({fetch:fetchPages([{...page,title:'Unrelated tab'}]),WebSocket:Socket}),/context/);
  await assert.rejects(connect({fetch:fetchPages([{...page,webSocketDebuggerUrl:'ws://evil.example:8080/test'}]),WebSocket:Socket}),/loopback/);
});
test('aborting a Steam operation closes the channel and rejects uncertain work',async()=>{
  const controller=new AbortController();const bridge=await connect({fetch:fetchPages([page]),WebSocket:Socket,signal:controller.signal});
  const socket=Socket.instances.at(-1);socket.send=()=>{};const work=bridge.evaluate('1');controller.abort();await assert.rejects(work,/partial/);bridge.close();
});
