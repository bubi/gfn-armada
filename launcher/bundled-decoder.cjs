const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function select({env=process.env,platform=process.platform,arch=process.arch,hardwareDecode=true,bundleRoot=env.GFN_ARMADA_ELECTRON?path.dirname(env.GFN_ARMADA_ELECTRON):null,io=fs}={}){
  const next={...env},result={bundled:false,selected:false,hardwareDecodeActive:'unknown',reason:'not-packaged'};
  const read=file=>{try{return io.readFileSync(file,'utf8')}catch{return ''}};
  const list=dir=>{try{return io.readdirSync(dir)}catch{return []}};
  const directory=bundleRoot&&path.join(bundleRoot,'iris-driver');
  if(!directory||!io.existsSync(path.join(directory,'manifest.json')))return {env:next,report:result};
  const manifest=JSON.parse(read(path.join(directory,'manifest.json')));
  Object.assign(result,{bundled:true,experimental:true,sourceCommit:manifest.commit,moduleSha256:manifest.moduleSha256,patches:manifest.patches,reason:'unsupported-host'});
  if(platform!=='linux'||arch!=='arm64')return {env:next,report:result};
  const mode=env.GFN_ARMADA_BUNDLED_IRIS||'auto';
  if(!['auto','0','1'].includes(mode))throw new Error('GFN_ARMADA_BUNDLED_IRIS must be auto, 0 or 1');
  if(!hardwareDecode||mode==='0'){result.reason='disabled';return {env:next,report:result};}
  if(env.GFN_ARMADA_VAAPI||env.LIBVA_DRIVER_NAME||env.LIBVA_DRIVERS_PATH){result.reason='external-driver-override';return {env:next,report:result};}
  if(!env.WAYLAND_DISPLAY||env.GFN_ARMADA_OZONE==='x11'){result.reason='wayland-required';return {env:next,report:result};}
  if(mode==='auto'&&!/odin.*portal/i.test(read('/proc/device-tree/model'))){result.reason='auto-requires-odin-portal';return {env:next,report:result};}
  const video=list('/sys/class/video4linux').filter(x=>/^video\d+$/.test(x)).find(x=>/iris.*decoder/i.test(read(`/sys/class/video4linux/${x}/name`))&&io.existsSync('/dev/'+x));
  const render=list('/dev/dri').sort().find(x=>/^renderD\d+$/.test(x));
  if(!video||!render){result.reason='iris-or-render-device-missing';return {env:next,report:result};}
  const module=path.join(directory,'dri/v4l2_drv_video.so');
  if(crypto.createHash('sha256').update(io.readFileSync(module)).digest('hex')!==manifest.moduleSha256)throw new Error('Bundled Iris decoder checksum mismatch');
  Object.assign(next,{LIBVA_DRIVER_NAME:'v4l2',LIBVA_DRIVERS_PATH:path.join(directory,'dri'),LIBVA_V4L2_VIDEO_PATH:'/dev/'+video,GFN_ARMADA_VAAPI:'/dev/dri/'+render,GFN_ARMADA_OZONE:'wayland'});
  Object.assign(result,{selected:true,reason:'experimental-iris-requested',videoDevice:next.LIBVA_V4L2_VIDEO_PATH,renderDevice:next.GFN_ARMADA_VAAPI});
  next.GFN_ARMADA_BUNDLED_DECODER_REPORT=JSON.stringify(result);
  return {env:next,report:result};
}
module.exports={select};
