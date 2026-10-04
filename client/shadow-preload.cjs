const {sharedTexture,ipcRenderer}=require('electron');
let frames=0;
sharedTexture.setSharedTextureReceiver(async({importedSharedTexture})=>{
  let frame;
  try{
    frame=importedSharedTexture.getVideoFrame();const canvas=document.querySelector('canvas');
    if(canvas.width!==frame.visibleRect.width || canvas.height!==frame.visibleRect.height){
      canvas.width=frame.visibleRect.width;canvas.height=frame.visibleRect.height;
    }
    canvas.getContext('2d',{alpha:false}).drawImage(frame,0,0,canvas.width,canvas.height);
    document.querySelector('output').textContent=`H264 / native shadow — ${++frames} Draw-Aufrufe`;
    ipcRenderer.send('native-shadow-draw',{frames});
  }finally{frame?.close();importedSharedTexture.release();}
});
addEventListener('DOMContentLoaded',()=>ipcRenderer.send('native-shadow-ready'),{once:true});
