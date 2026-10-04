const {spawn}=require('node:child_process');
const fs=require('node:fs');
const {encode,Reader}=require('./helper-wire.cjs');
function startHelper({command,args,env,onEvent,profile,readyTimeoutMs=15000}){
  const child=spawn(command,args,{env,stdio:['ignore','ignore','ignore','pipe','pipe']});
  let stopped=false,exited=false,ready=false,killTimer,readyTimer,nextRequest=0,pendingBytes=0;
  const pending=new Map(),requests=new Map();
  let highWater=0,ackCount=0,ackMaxMs=0;
  const metrics=()=>({stage:"helper-pipe",pending:pending.size,pendingBytes,highWater,ackCount,ackMaxMs,oldestMs:pending.size?performance.now()-pending.values().next().value.at:0});
  let resolveReady,rejectReady;
  const prepared=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  function settle(){for(const item of pending.values()){clearTimeout(item.timer);item.resolve(false);}pending.clear();pendingBytes=0;for(const item of requests.values()){clearTimeout(item.timer);item.reject(new Error('Helper unavailable'));}requests.clear();}
  function write(message,bytes){
    if(exited||child.stdio[3].destroyed) throw new Error('Helper unavailable');
    child.stdio[3].write(encode(message,bytes));
  }
  function stop(){
    if(stopped) return;stopped=true;settle();
    clearTimeout(readyTimer);if(!ready) rejectReady(new Error('Helper stopped before readiness'));
    try{write({kind:'stop'});}catch{}
    killTimer=setTimeout(()=>{if(!exited) child.kill('SIGKILL');},3000);killTimer.unref();
  }
  const reader=new Reader((message,bytes)=>{
    if(bytes.length) throw new Error('Helper control payload rejected');
    if(message.kind==='ready'){if(ready||stopped) return;ready=true;clearTimeout(readyTimer);resolveReady();}
    else if(message.kind==='ack'){
      if(!Number.isSafeInteger(message.sequence)||typeof message.accepted!=='boolean') throw new Error('Invalid helper acknowledgement');
      const item=pending.get(message.sequence);if(item){ackCount++;ackMaxMs=Math.max(ackMaxMs,performance.now()-item.at);clearTimeout(item.timer);pending.delete(message.sequence);pendingBytes-=item.bytes;item.resolve(message.accepted);}
    }else if(message.kind==='pixels'){
      const item=requests.get(message.id);if(item){clearTimeout(item.timer);requests.delete(message.id);item.resolve(message.value);}
    }else if(!['opened','stats','closed','failed'].includes(message.kind)) throw new Error('Unknown helper status');
    onEvent(message);
  },16384);
  child.stdio[4].on('data',chunk=>{try{reader.feed(chunk);}catch{onEvent({kind:'failed',reason:'invalid-helper-control'});stop();}});
  child.stdio[4].on('end',()=>{
    try{reader.end();}catch{onEvent({kind:'failed',reason:'truncated-helper-control'});stop();return;}
    if(!stopped&&!exited){onEvent({kind:'failed',reason:'helper-control-ended'});stop();}
  });
  child.stdio[4].on('error',()=>{onEvent({kind:'failed',reason:'helper-control-pipe-failed'});stop();});
  child.stdio[3].on('error',()=>{onEvent({kind:'failed',reason:'helper-input-pipe-failed'});stop();});
  child.on('error',()=>{rejectReady(new Error('Helper spawn failed'));onEvent({kind:'failed',reason:'helper-spawn-failed'});stop();if(!child.pid&&profile) fs.rmSync(profile,{recursive:true,force:true});});
  child.once('exit',(code,signal)=>{
    exited=true;clearTimeout(readyTimer);clearTimeout(killTimer);settle();
    if(!ready) rejectReady(new Error('Helper exited before readiness'));
    onEvent({kind:'exit',code,signal,expected:stopped});
    if(profile) fs.rmSync(profile,{recursive:true,force:true});
  });
  readyTimer=setTimeout(()=>{rejectReady(new Error('Helper readiness timeout'));onEvent({kind:'failed',reason:'helper-readiness-timeout'});stop();},readyTimeoutMs);
  return {prepared,pid:child.pid,stop,metrics,
    push(message,bytes){
      if(stopped||!ready||!Number.isSafeInteger(message.sequence)||message.sequence<1||pending.has(message.sequence)) return Promise.resolve(false);
      if(pending.size>=8||pendingBytes+bytes.length>4194304){onEvent({kind:'failed',reason:'helper-supervisor-queue-overflow'});stop();return Promise.resolve(false);}
      return new Promise(resolve=>{
        const timer=setTimeout(()=>{onEvent({kind:'failed',reason:'helper-packet-ack-timeout'});stop();},2000);
        pending.set(message.sequence,{resolve,timer,bytes:bytes.length,at:performance.now()});pendingBytes+=bytes.length;highWater=Math.max(highWater,pending.size);
        try{write({kind:'push',...message},bytes);}catch{stop();}
      });
    },
    inspect(){return new Promise((resolve,reject)=>{
      if(stopped||!ready){reject(new Error('Helper unavailable'));return;}
      const id=++nextRequest,timer=setTimeout(()=>{requests.delete(id);reject(new Error('Helper inspection timeout'));},2000);
      requests.set(id,{resolve,reject,timer});try{write({kind:'inspect',id});}catch{stop();}
    });},
    killForTest(signal){if(!stopped&&!exited) child.kill(signal);}
  };
}
module.exports={startHelper};
