// Synthetic clip only. This app never loads GFN or its authenticated profile.
const {app,BrowserWindow,ipcMain,sharedTexture}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const bridge=require('./bridge.node');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-dmabuf-'));
app.setPath('userData',profile);
app.commandLine.appendSwitch('ozone-platform',process.env.GFN_ARMADA_OZONE || 'wayland');
let window,opened=false,finished=false,received=0,submitted=0,released=0,peakLeases=0;
let negotiatedColorSpace=null;
const pending=new Set();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>finish(new Error('30 second test deadline exceeded')),30000);
function log(value){ console.log(JSON.stringify(value)); }
async function finish(error,evidence={}) {
  if(finished) return; finished=true; clearTimeout(deadline);
  if(window && !window.isDestroyed()) window.destroy();
  for(let i=0;i<100 && pending.size;i++) await sleep(20);
  if(pending.size) error ||= new Error('GPU references still outstanding after renderer shutdown');
  if(opened && !pending.size) { try{bridge.close()}catch(e){error ||= e} }
  log({status:error?'failed':'passed',experiment:'local-hevc-dmabuf',
    submitted,received,released,peakLeases,outstanding:pending.size,negotiatedColorSpace,...evidence,
    ...(error?{error:String(error.message).slice(0,500)}:{})});
  app.exit(error?1:0);
}
app.on('quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
// Keep Main alive while destruction of the last window releases GPU leases.
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  const clip=process.env.GFN_ARMADA_TEST_CLIP;
  if(!clip || !path.isAbsolute(clip) || !fs.statSync(clip).isFile()) throw new Error('Set GFN_ARMADA_TEST_CLIP to an absolute local HEVC path');
  assert.throws(()=>bridge.pullFrame(0),/not open/);
  assert.throws(()=>bridge.releaseFrame(0),/Unknown/);
  assert.throws(()=>bridge.openFile(123),/requires/);
  window=new BrowserWindow({width:960,height:600,show:true,webPreferences:{
    preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false
  }});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  const ready=new Promise(resolve=>ipcMain.once('dmabuf-ready',event=>{
    if(event.sender===window.webContents) resolve();
  }));
  ipcMain.on('dmabuf-frame',(event,result)=>{
    if(!finished && event.sender===window.webContents && Number.isInteger(result?.frames) && result.frames<=1000) received=result.frames;
  });
  ipcMain.on('dmabuf-error',(event,message)=>{
    if(!finished && event.sender===window.webContents) finish(new Error(String(message).slice(0,500)));
  });
  await window.loadFile(path.join(__dirname,'index.html')); await ready;
  await app.getGPUInfo('complete');
  // On Linux GPU feature information can still be provisional at this point.
  let features;
  for(let i=0;i<50;i++) {
    features=app.getGPUFeatureStatus();
    if(features.gpu_compositing==='enabled' && ['enabled','enabled_on'].includes(features.opengl)) break;
    await sleep(100);
  }
  if(features.gpu_compositing!=='enabled' || !['enabled','enabled_on'].includes(features.opengl))
    throw new Error('GPU compositing / OpenGL is not enabled');
  const renderer=await window.webContents.executeJavaScript(`(()=>{
    const gl=document.createElement('canvas').getContext('webgl');
    const info=gl?.getExtension('WEBGL_debug_renderer_info');
    return info?String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)).slice(0,300):'unknown';
  })()`);
  log({event:'gpu-ready',renderer,features});
  const decoder=bridge.openFile(clip); opened=true;
  assert.throws(()=>bridge.openFile(clip),/already open/i);
  const deviceName=/^\/dev\/video\d+$/.test(decoder.device)
    ? fs.readFileSync(`/sys/class/video4linux/${path.basename(decoder.device)}/name`,'utf8').trim() : 'unknown';
  if(deviceName!=='qcom-iris-decoder') throw new Error('This validation requires the Qualcomm Iris decoder');
  log({event:'pipeline-open',decoder:'v4l2h265dec',device:decoder.device,driver:deviceName,electron:process.versions.electron,chromium:process.versions.chrome});
  while(!finished) {
    if(pending.size>=4) { await sleep(10); continue; }
    const frame=bridge.pullFrame(20);
    if(frame.eos) break;
    if(!frame.textureInfo) {await sleep(10);continue;}
    negotiatedColorSpace=frame.textureInfo.colorSpace;
    if(process.env.GFN_ARMADA_TEST_EXPECT_RANGE&&negotiatedColorSpace.range!==process.env.GFN_ARMADA_TEST_EXPECT_RANGE){
      bridge.releaseFrame(frame.leaseId);throw new Error('Negotiated color range differs from the test fixture');
    }
    if(!submitted) log({event:'native-frame',decoder:'v4l2h265dec',format:'linear-nv12-dmabuf',
      codedSize:frame.textureInfo.codedSize,visibleRect:frame.textureInfo.visibleRect,colorSpace:negotiatedColorSpace,
      planes:frame.textureInfo.handle.nativePixmap.planes.map(({stride,offset,size})=>({stride,offset,size})),
      gpu:app.getGPUFeatureStatus(),ozone:process.env.GFN_ARMADA_OZONE || 'wayland'});
    pending.add(frame.leaseId); peakLeases=Math.max(peakLeases,pending.size);
    let imported;
    try {
      imported=sharedTexture.importSharedTexture({textureInfo:frame.textureInfo,
        allReferencesReleased:()=>{
          bridge.releaseFrame(frame.leaseId); pending.delete(frame.leaseId); released++;
          if(released===1) assert.throws(()=>bridge.releaseFrame(frame.leaseId),/already released/);
        }});
      if(!submitted) assert.throws(()=>bridge.close(),/still leased/);
      await sharedTexture.sendSharedTexture({frame:window.webContents.mainFrame,importedSharedTexture:imported});
      submitted++;
    } catch(error) {
      if(!imported){bridge.releaseFrame(frame.leaseId);pending.delete(frame.leaseId);released++;}
      throw error;
    } finally {imported?.release();}
    await sleep(30);
    // The fixed synthetic fixture has 60 frames. Do not wait for decoder EOS
    // while a renderer may still retain its final capture buffer.
    if(submitted===60) break;
  }
  if(finished) return;
  // Validation readback only: not part of the playback/decoder pipeline.
  const pixels=await window.webContents.executeJavaScript(`(()=>{
    const canvas=document.querySelector('canvas'),context=canvas.getContext('2d');
    const samples=[];
    for(let y=0;y<3;y++)for(let x=0;x<7;x++)
      samples.push([...context.getImageData(Math.floor((x+.5)*canvas.width/7),Math.floor((y+.5)*canvas.height/3),1,1).data]);
    return {width:canvas.width,height:canvas.height,rgbSamples:samples.map(p=>p.slice(0,3)),distinctColors:new Set(samples.map(p=>p.slice(0,3).map(c=>Math.round(c/32)).join(','))).size};
  })()`);
  if(submitted<30 || received!==submitted || pixels.distinctColors<5) throw new Error('Insufficient displayed frames or test-pattern colors');
  const screenshot=await window.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname,'test-pattern.png'),screenshot.toPNG());
  await finish(null,{pixels,validationReadback:true});
}).catch(error=>finish(error));
