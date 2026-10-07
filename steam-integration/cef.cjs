// Local Steam CEF transport. No server, shell command or remote endpoint is exposed.
function loopback(url,protocol,port){
  const u=new URL(url);
  if(u.protocol!==protocol||u.hostname!=='127.0.0.1'||u.port!==String(port)||u.username||u.password)throw new Error('Steam debugger must stay on loopback');
  return u;
}
async function connect({port=8080,fetch=globalThis.fetch,WebSocket=globalThis.WebSocket,signal}={}){
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid Steam debugger port');
  signal?.throwIfAborted();
  const bounded=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(10000)]);
  const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:bounded,redirect:'error'});
  if(!response.ok)throw new Error('Steam debugger unavailable');
  const text=await response.text();if(text.length>1024*1024)throw new Error('Steam debugger inventory too large');
  const pages=JSON.parse(text);if(!Array.isArray(pages)||pages.length>100)throw new Error('Invalid Steam debugger inventory');
  const candidates=pages.filter(p=>(p.title==='SharedJSContext'&&p.url?.startsWith('https://steamloopback.host/'))||(p.title==='Steam Big Picture Mode'&&p.url?.startsWith('about:blank')));
  candidates.sort((a,b)=>Number(b.title==='SharedJSContext')-Number(a.title==='SharedJSContext'));
  const page=candidates[0];if(!page)throw new Error('Steam library context unavailable');
  const url=loopback(page.webSocketDebuggerUrl,'ws:',port);
  const socket=new WebSocket(url.href),pending=new Map();let sequence=0,closed=false;
  const rejectAll=()=>{closed=true;for(const task of pending.values())task.reject(new Error('Steam connection closed; sync result may be partial'));pending.clear()};
  socket.addEventListener('message',event=>{
    if(typeof event.data!=='string'||event.data.length>4*1024*1024){socket.close();return;}
    let reply;try{reply=JSON.parse(event.data)}catch{socket.close();return;}
    const task=pending.get(reply.id);if(!task)return;pending.delete(reply.id);
    if(reply.error||reply.result?.exceptionDetails)task.reject(new Error('Steam live operation failed'));
    else task.resolve(reply.result?.result?.value);
  });
  socket.addEventListener('close',rejectAll);socket.addEventListener('error',rejectAll);
  const abort=()=>{rejectAll();socket.close()};
  if(signal){signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();}
  try{await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.close();reject(new Error('Steam connection timed out'))},5000);
    socket.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
    socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Steam connection unavailable'))},{once:true});
    socket.addEventListener('close',()=>{clearTimeout(timer);reject(new Error('Steam connection closed'))},{once:true});
  })}catch(e){signal?.removeEventListener('abort',abort);socket.close();throw e;}
  return {
    async evaluate(expression){
      if(closed||signal?.aborted)throw new Error('Steam connection closed');
      const id=++sequence;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);socket.close();reject(new Error('Steam operation timed out; result may be partial'))},20000);
        pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:e=>{clearTimeout(timer);reject(e)}});
        try{socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))}catch{pending.get(id)?.reject(new Error('Steam operation could not be sent'));pending.delete(id);}
      });
    },
    close(){signal?.removeEventListener('abort',abort);socket.close();rejectAll();}
  };
}
module.exports={connect,loopback};
