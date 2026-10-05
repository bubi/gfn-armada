const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {select}=require('../launcher/bundled-decoder.cjs');
const moduleBytes=Buffer.from('synthetic driver'),sha=crypto.createHash('sha256').update(moduleBytes).digest('hex');
function setup(){
  const files={'/bundle/iris-driver/manifest.json':JSON.stringify({commit:'pinned',moduleSha256:sha,patches:[1,2,3,4]}),'/bundle/iris-driver/dri/v4l2_drv_video.so':moduleBytes,'/proc/device-tree/model':'AYN Odin 2 Portal\0','/sys/class/video4linux/video7/name':'Iris Decoder'};
  const io={existsSync:file=>file==='/dev/video7'||file in files,readFileSync:(file,encoding)=>{if(!(file in files))throw new Error('missing');return encoding?files[file].toString():Buffer.from(files[file])},readdirSync:dir=>dir==='/sys/class/video4linux'?['video7']:dir==='/dev/dri'?['renderD129']:[]};
  return {files,options:{platform:'linux',arch:'arm64',bundleRoot:'/bundle',env:{WAYLAND_DISPLAY:'gamescope-0'},io}};
}
test('bundled Iris selection uses detected nodes and preserves sandbox defaults',()=>{
  const {options}=setup(),r=select(options);assert.equal(r.report.selected,true);assert.equal(r.env.GFN_ARMADA_VAAPI,'/dev/dri/renderD129');assert.equal(r.env.LIBVA_V4L2_VIDEO_PATH,'/dev/video7');assert.equal(r.env.GFN_ARMADA_VAAPI_NO_SANDBOX,undefined);assert.equal(r.report.hardwareDecodeActive,'unknown');assert.deepEqual(options.env,{WAYLAND_DISPLAY:'gamescope-0'});
});
test('bundled decoder leaves disabled, external, X11 and unrelated hardware configurations intact',()=>{
  const {files,options}=setup();
  for(const change of [{hardwareDecode:false},{env:{...options.env,GFN_ARMADA_BUNDLED_IRIS:'0'}},{env:{...options.env,LIBVA_DRIVERS_PATH:'/custom'}},{env:{DISPLAY:':0'}},{platform:'darwin'}])assert.equal(select({...options,...change}).report.selected,false);
  files['/proc/device-tree/model']='Unrelated handheld';assert.equal(select(options).report.selected,false);
  assert.equal(select({...options,env:{...options.env,GFN_ARMADA_BUNDLED_IRIS:'1'}}).report.selected,true);
});
test('bundled driver integrity is checked before selecting the module',()=>{
  const {files,options}=setup();files['/bundle/iris-driver/dri/v4l2_drv_video.so']=Buffer.from('damaged');assert.throws(()=>select(options),/checksum/);
});
