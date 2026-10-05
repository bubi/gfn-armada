const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {processVideo}=require('../launcher/process-video.cjs');
const {decoderProperties}=require('../client/media-diagnostics.cjs');
const {nativeStatsEnabled,videoReports,softwareDecodeStatus}=require('../client/webrtc-internals.cjs');
test('native Chromium stats are enabled by default except catalog imports, with explicit opt-out',()=>{
  for(const command of ['launch','login','map'])assert.equal(nativeStatsEnabled(command,{}),true);
  assert.equal(nativeStatsEnabled('library',{}),false);
  assert.equal(nativeStatsEnabled('launch',{GFN_ARMADA_MEDIA_DIAGNOSTICS:'0'}),false);
});
test('decode interval metrics reject resets and stream format changes without exporting identifiers',()=>{
  const history=new Map();
  const sample=(frames,time,timestamp,width=1920)=>videoReports([
    ['private-stream',{type:'inbound-rtp',kind:'video',codecId:'c',framesDecoded:frames,totalDecodeTime:time,
      timestamp,frameWidth:width,frameHeight:1080,jitterBufferDelay:0.4,jitterBufferEmittedCount:100}],
    ['c',{mimeType:'video/H264'}]],history)[0];
  const first=sample(100,0.4,1000);
  assert.equal(first.meanDecodeMs,4);assert.equal(first.intervalMeanDecodeMs,null);
  assert.equal(first.meanJitterBufferMs,4);
  const next=sample(200,0.7,2000);
  assert.ok(Math.abs(next.intervalMeanDecodeMs-3)<1e-10);
  assert.equal(next.intervalFramesDecoded,100);assert.equal(next.intervalMs,1000);
  assert.equal(sample(200,0.7,2000).intervalMeanDecodeMs,null);
  assert.equal(sample(5,0.02,3000).intervalMeanDecodeMs,null);
  assert.equal(sample(10,0.04,4000,1280).intervalMeanDecodeMs,null);
  assert.equal(JSON.stringify(next).includes('private-stream'),false);
  videoReports([],history);assert.equal(history.size,0);
});
test('software evidence can reject hardware without treating efficiency hints as a VPU proof',()=>{
  assert.equal(softwareDecodeStatus({status:'sampled',streams:[{decoder:'FFmpeg',framesDecoded:100}]}),'no');
  assert.equal(softwareDecodeStatus({status:'sampled',streams:[{decoder:'ExternalDecoder (V4L2VideoDecoder)',framesDecoded:100,powerEfficientDecoder:true}]}),'unknown');
  assert.equal(softwareDecodeStatus({status:'sampled',streams:[{decoder:'FFmpeg',framesDecoded:0}]}),'unknown');
  assert.equal(softwareDecodeStatus({status:'stale',streams:[{decoder:'FFmpeg',framesDecoded:100}]}),'unknown');
});
test('native WebRTC stats export video decoder evidence without session identifiers',()=>{
  const result=videoReports([
    ['video',{type:'inbound-rtp',kind:'video',codecId:'codec',decoderImplementation:'FFmpeg',
      powerEfficientDecoder:false,framesDecoded:100,framesDropped:0,totalDecodeTime:0.1,
      timestamp:1000,trackIdentifier:'secret-track',ssrc:123}],
    ['codec',{mimeType:'video/H264',sdpFmtpLine:'private-sdp'}],
    ['audio',{type:'inbound-rtp',kind:'audio',decoderImplementation:'audio'}],
    ['candidate',{type:'local-candidate',address:'192.168.1.198'}],
  ]);
  assert.equal(result.length,1);assert.equal(result[0].decoder,'FFmpeg');
  assert.equal(result[0].powerEfficientDecoder,false);
  assert.equal(/secret|private|192\.168|ssrc|codecId/.test(JSON.stringify(result)),false);
  assert.deepEqual(videoReports(null),[]);
  assert.equal(videoReports([['v',{type:'inbound-rtp',kind:'video',framesDecoded:NaN}]])[0].decoder,'unknown');
});
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
