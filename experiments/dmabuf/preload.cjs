const {ipcRenderer, sharedTexture}=require('electron');
let frames=0;
sharedTexture.setSharedTextureReceiver(async({importedSharedTexture})=>{
  let frame;
  try {
    frame=importedSharedTexture.getVideoFrame();
    const canvas=document.querySelector('canvas');
    if(!canvas) throw new Error('Test canvas unavailable');
    // Electron currently uses codedSize as naturalSize; exclude decoder padding.
    if(!frames) { canvas.width=frame.visibleRect.width; canvas.height=frame.visibleRect.height; }
    canvas.getContext('2d',{alpha:false}).drawImage(frame,0,0,canvas.width,canvas.height);
    frames++;
    document.querySelector('output').textContent=`HEVC / Iris / DMA-BUF — ${frames} Frames`;
    ipcRenderer.send('dmabuf-frame',{frames,width:canvas.width,height:canvas.height});
  } catch(error) {
    ipcRenderer.send('dmabuf-error',String(error.message).slice(0,500));
  } finally {
    frame?.close();
    importedSharedTexture.release();
  }
});
addEventListener('DOMContentLoaded',()=>ipcRenderer.send('dmabuf-ready'),{once:true});
