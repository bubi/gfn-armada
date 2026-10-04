#!/usr/bin/env node
// Optional bounded local H.264 test of an existing Chromium binary.
// CDP uses private process pipes, never a network debugging port or GFN profile.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {installObserver,videoReports}=require('../client/webrtc-internals.cjs');
const {loopback}=require('../tests/fixtures/local-webrtc.cjs');
const binary=process.argv[2];
if(!binary||process.argv.length!==3){console.error('Usage: node scripts/probe-chromium.cjs /absolute/path/to/chromium');process.exit(2)}
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-chromium-probe-'));
const child=spawn(binary,['--remote-debugging-pipe',`--user-data-dir=${profile}`,
  ...(process.env.GFN_ARMADA_PROBE_IGNORE_BLOCKLIST==='1'?['--ignore-gpu-blocklist']:[]),
  '--no-first-run','--no-default-browser-check','--ozone-platform=x11',
  '--enable-features=AcceleratedVideoDecodeLinuxGL',
  '--enable-logging=stderr','--vmodule=*video_decoder*=3,*v4l2*=3,*rtc_video_decoder*=3',
  'about:blank'],
  {stdio:['ignore','ignore','pipe','pipe','pipe']});
// Child stderr is retained locally for failed startup; never visit auth pages.
let stderr='',buffer=Buffer.alloc(0),id=0,finished=false;
const pending=new Map();
child.stderr.on('data',b=>{
  stderr=(stderr+b.toString()).slice(-4096);
  if(process.env.GFN_ARMADA_PROBE_LOG) fs.appendFileSync(process.env.GFN_ARMADA_PROBE_LOG,b,{mode:0o600});
});
function call(method,params={},sessionId) {
  return new Promise((resolve,reject)=>{
    const request={id:++id,method,params};if(sessionId) request.sessionId=sessionId;
    pending.set(request.id,{resolve,reject});child.stdio[3].write(JSON.stringify(request)+'\0');
  });
}
child.stdio[3].on('error',()=>finish(1,{status:'pipe-error'}));
child.stdio[4].on('data',b=>{
  buffer=Buffer.concat([buffer,b]);let pos;
  while((pos=buffer.indexOf(0))!==-1){
    const raw=buffer.subarray(0,pos).toString();buffer=buffer.subarray(pos+1);
    let message;try{message=JSON.parse(raw)}catch{continue}
    const p=pending.get(message.id);if(!p) continue;pending.delete(message.id);
    if(message.error) p.reject(new Error(message.error.message));else p.resolve(message.result);
  }
});
const deadline=setTimeout(()=>finish(1,{status:'timeout',stderr}),45000);
function finish(code,data) {
  if(finished) return;finished=true;clearTimeout(deadline);
  console.log(JSON.stringify(data));process.exitCode=code;
  child.kill('SIGTERM');const force=setTimeout(()=>child.kill('SIGKILL'),3000);force.unref();
}
child.on('error',e=>finish(1,{status:'spawn-failed',code:e.code}));
child.on('exit',()=>{
  if(!finished) finish(1,{status:'browser-exited',stderr});
  fs.rmSync(profile,{recursive:true,force:true});
  for(const p of pending.values()) p.reject(new Error('Browser exited'));pending.clear();
});
const evaluate=(sessionId,expression)=>call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId)
  .then(r=>{if(r.exceptionDetails) throw new Error('Evaluation failed');return r.result.value});
(async()=>{
  const create=async url=>{
    const {targetId}=await call('Target.createTarget',{url});
    const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    await call('Runtime.enable',{},sessionId);return sessionId;
  };
  const internals=await create('chrome://webrtc-internals');
  // Wait for module initialization, not a fixed startup sleep.
  for(let n=0;n<100;n++){
    if(await evaluate(internals,'document.readyState==="complete"')) break;
    await new Promise(r=>setTimeout(r,100));
  }
  await evaluate(internals,`(${installObserver.toString()})('null',${videoReports.toString()})`);
  const local=await create('data:text/html,<title>Local H264 probe</title>');
  await evaluate(local,`(${loopback.toString()})()`);
  while(!finished){
    await new Promise(r=>setTimeout(r,1000));
    const data=await evaluate(internals,'window.__gfnArmadaNativeStats');
    const stream=data?.streams?.find(s=>s.codec==='video/H264'&&s.framesDecoded>=30&&s.decoder!=='unknown');
    if(stream){
      const {gpu}=await call('SystemInfo.getInfo');
      finish(0,{status:'measured',stream,gpu:{videoDecoding:gpu.videoDecoding,
        videoDecodeFeature:gpu.featureStatus?.video_decode,renderer:gpu.auxAttributes?.glRenderer},
      note:'Synthetic local WebRTC, not GFN. Decoder evidence is not a zero-copy proof.'});return}
  }
})().catch(()=>finish(1,{status:'probe-failed',stderr}));
