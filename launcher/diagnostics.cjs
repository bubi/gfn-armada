const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {gunzipSync}=require('node:zlib');
const {spawnSync}=require('node:child_process');
const {paths}=require('./config.cjs');
function probe(command,args=[]) {
  const p=spawnSync(command,args,{encoding:'utf8',timeout:5000,maxBuffer:256*1024});
  return {available:!p.error,ok:!p.error&&p.status===0,output:(p.stdout||'').slice(0,32768),error:p.error?.code || (p.status!==0 ? (p.stderr||'').slice(0,1024):null)};
}
function read(file) {try{return fs.readFileSync(file,'utf8').trim()}catch{return null}}
function list(dir, pattern) {try{return fs.readdirSync(dir).filter(x=>pattern.test(x))}catch{return []}}
function kernelConfig() {
  for(const file of ['/proc/config.gz',`/boot/config-${os.release()}`]) {
    try {
      const raw=fs.readFileSync(file);
      const text=file.endsWith('.gz')?gunzipSync(raw).toString('utf8'):raw.toString('utf8');
      return {available:true,source:file,output:text.split('\n').filter(line=>/CONFIG_(VIDEO_QCOM|VIDEO_V4L2|MEDIA_SUPPORT)/.test(line)).join('\n')};
    }catch{}
  }
  return {available:false,source:null,output:'',status:'unknown'};
}
function diagnostics() {
  const devices=list('/dev',/^(video|media)\d+$/).map(x=>({path:`/dev/${x}`,name:read(`/sys/class/video4linux/${x}/name`),probe:probe('v4l2-ctl',['--device',`/dev/${x}`,'--all','--list-formats-out','--list-formats'])}));
  const runtimeFile=path.join(paths().state,'runtime.json');
  let runtime=null; try{runtime=JSON.parse(read(runtimeFile))}catch{}
  return {architecture:os.arch(),platform:os.platform(),kernel:os.release(),deviceTree:read('/proc/device-tree/model'),
    displayEnvironment:process.env.WAYLAND_DISPLAY?'wayland requested':process.env.DISPLAY?'X11/XWayland environment':'unknown',
    gamescope:probe('pgrep',['-x','gamescope']).ok?'process detected':'unknown',
    gpu:probe('vulkaninfo',['--summary']),egl:probe('eglinfo',['-B']),videoDevices:devices,
    kernelVideoConfig:kernelConfig(),processVideoAccess:require('./process-video.cjs').processVideo(),
    ffmpeg:probe('ffmpeg',['-hide_banner','-decoders']),ffmpegHwaccels:probe('ffmpeg',['-hide_banner','-hwaccels']),
    gstreamer:probe('gst-inspect-1.0',['video4linux2']),
    h264HardwareDecode:'unknown',hevcHardwareDecode:'unknown',av1HardwareDecode:'unknown',dmabuf:'unknown',
    bundledDecoder:require('./bundled-decoder.cjs').select({hardwareDecode:require('./config.cjs').loadConfig().hardware_decode}).report,
    runtimeSnapshot:runtime,runtimeSnapshotFile:runtimeFile,
    note:'Device presence, compiled FFmpeg decoders, GPU feature status and page-reported RTC statistics do not prove Qualcomm hardware decoding. Runtime snapshot is historical; check timestamp and session.'};
}
module.exports={probe,diagnostics};
