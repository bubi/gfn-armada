// Feasibility test only: observe compressed local H.264, forward unchanged.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {loopback}=require('./fixtures/local-webrtc.cjs');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'gfn-transform-')));
const deadline=setTimeout(()=>{console.log(JSON.stringify({status:'timeout'}));app.exit(1)},30000);
function observeEncoded(receiver) {
  const source=`
    onrtctransform=event=>{
      let frames=0,bytes=0,keyFrames=0,annexB=0;
      event.transformer.readable.pipeThrough(new TransformStream({transform(frame,controller){
        const data=new Uint8Array(frame.data);
        frames++;bytes+=data.byteLength;if(frame.type==='key') keyFrames++;
        if(data[0]===0&&data[1]===0&&(data[2]===1||(data[2]===0&&data[3]===1))) annexB++;
        controller.enqueue(frame);
        if(frames%30===0) postMessage({frames,bytes,keyFrames,annexB});
      }})).pipeTo(event.transformer.writable).catch(()=>postMessage({error:true}));
    };
  `;
  const worker=new Worker(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
  worker.onmessage=e=>{window.encodedEvidence=e.data};
  receiver.transform=new RTCRtpScriptTransform(worker);
}
app.whenReady().then(async()=>{
  const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  await w.loadURL('data:text/html,<title>Encoded H264 test</title>');
  await w.webContents.executeJavaScript(`(${loopback.toString()})({onVideoReceiver:${observeEncoded.toString()}})`);
  const timer=setInterval(async()=>{
    try{
      const result=await w.webContents.executeJavaScript('({encoded:window.encodedEvidence,decoded:document.querySelector("video")?.getVideoPlaybackQuality()?.totalVideoFrames})');
      if(result.encoded?.error) throw new Error('transform failed');
      if(result.encoded?.frames>=30&&result.decoded>=30){clearInterval(timer);clearTimeout(deadline);console.log(JSON.stringify({status:'passed',...result}));app.exit(0)}
    }catch{clearInterval(timer);clearTimeout(deadline);console.log(JSON.stringify({status:'failed'}));app.exit(1)}
  },1000);
}).catch(()=>{clearTimeout(deadline);app.exit(1)});
