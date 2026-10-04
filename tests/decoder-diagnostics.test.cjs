const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {processVideo}=require('../launcher/process-video.cjs');
const {decoderProperties}=require('../client/media-diagnostics.cjs');
test('device access probe includes child runtime FDs without leaking unrelated paths',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-proc-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const [pid,exe] of [['100','gfn-armada-electron'],['101','unrelated']]) {
    fs.mkdirSync(path.join(root,pid,'fd'),{recursive:true});fs.symlinkSync('/opt/'+exe,path.join(root,pid,'exe'));
    fs.symlinkSync('/dev/video0',path.join(root,pid,'fd','4'));fs.symlinkSync('/private/session-token',path.join(root,pid,'fd','5'));
  }
  const result=processVideo(root);
  assert.equal(result.processes.length,1);assert.deepEqual(result.processes[0].devices,[{fd:'4',target:'/dev/video0'}]);
  assert.equal(JSON.stringify(result).includes('session-token'),false);
  fs.rmSync(path.join(root,'100','fd'),{recursive:true});
  assert.equal(processVideo(root).processes[0].fdStatus,'unreadable-or-exited');
  assert.equal(processVideo(path.join(root,'missing')).status,'unavailable');
});
test('native media report retains only decoder properties, excluding URLs and titles',()=>{
  const report=decoderProperties({playerId:'1',properties:[{name:'kVideoDecoderName',value:'FFmpegVideoDecoder'},
    {name:'kIsPlatformVideoDecoder',value:'false'},{name:'url',value:'https://example.com/?token=secret'},
    {name:'title',value:'private'}]});
  assert.equal(report.properties.length,2);assert.equal(JSON.stringify(report).includes('secret'),false);
  assert.equal(decoderProperties({properties:[]}),null);
});
