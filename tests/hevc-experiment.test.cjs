const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup() {
 const source=fs.readFileSync(require.resolve('../client/preload.cjs'),'utf8');
 const events=[],calls=[];
 const codecs=['H264','H265','rtx'].map(c=>({mimeType:'video/'+c}));
 class XHR {open(){}send(body){calls.push(body);}}
 class PC {setRemoteDescription(d){this.remoteDescription=d;return Promise.resolve();}createAnswer(){return Promise.resolve({sdp:'m=video 9 UDP/TLS/RTP/SAVPF 98\r\na=rtpmap:98 H265/90000\r\n'});}getTransceivers(){return [{receiver:{track:{kind:'video'}},setCodecPreferences:c=>calls.push(c)}];}}
 const context={require:()=>({}),location:{origin:'https://test.invalid',href:'https://test.invalid/'},process:{argv:[]},URL,
  XMLHttpRequest:XHR,RTCPeerConnection:PC,RTCRtpReceiver:{getCapabilities:()=>({codecs})}};
 context.window={fetch:(input,init)=>{calls.push(init?.body);return Promise.resolve();},postMessage:m=>events.push(m.data)};
 vm.createContext(context);vm.runInContext(source+'\ninstallHevcExperiment();',context);
 return {context,events,calls,codecs,PC};
}
const body=()=>({sessionRequestData:{sdrHdrMode:0,metaData:[{key:'GSStreamerType',value:'WebRTC'}],clientRequestMonitorSettings:[{widthInPixels:1920,heightInPixels:1080,framesPerSecond:60}],requestedStreamingFeatures:{codec:1,bitDepth:0,chromaFormat:0},deviceHashId:'secret-preserve'}});
test('HEVC hook changes only observed fresh SDR WebRTC session and preserves other fields',async()=>{
 const {context,calls,events}=setup();const b=body();
 await context.window.fetch('https://prod.cloudmatchbeta.nvidiagrid.net/v2/session',{method:'POST',body:JSON.stringify(b)});
 const result=JSON.parse(calls[0]);assert.equal(result.sessionRequestData.requestedStreamingFeatures.codec,2);assert.equal(result.sessionRequestData.deviceHashId,'secret-preserve');
 assert.ok(events.some(e=>e.event==='request-preferred'));assert.ok(!JSON.stringify(events).includes('secret-preserve'));
});
test('HEVC hook leaves resume, unrelated hosts, malformed, unsupported profiles and missing capabilities intact',async()=>{
 const {context,calls,codecs}=setup();
 for(const [url,method,b] of [['https://example.com/v2/session','POST',body()],['https://x.nvidiagrid.net/v2/session/seat','PUT',body()],['https://x.nvidiagrid.net/v2/session','POST',{...body(),sessionRequestData:{...body().sessionRequestData,sdrHdrMode:1}}]]) {
 const text=JSON.stringify(b);await context.window.fetch(url,{method,body:text});assert.equal(calls.at(-1),text);
 }
 codecs.splice(1,1);const text=JSON.stringify(body());await context.window.fetch('https://x.nvidiagrid.net/v2/session',{method:'POST',body:text});assert.equal(calls.at(-1),text);
});
test('HEVC hook handles XHR and applies preference only to actual HEVC offer',async()=>{
 const {context,calls,PC,events}=setup();const x=new context.XMLHttpRequest();x.open('POST','https://x.nvidiagrid.net/v2/session');x.send(JSON.stringify(body()));assert.equal(JSON.parse(calls[0]).sessionRequestData.requestedStreamingFeatures.codec,2);
 const pc=new PC();await pc.setRemoteDescription({type:'offer',sdp:'m=video 9 UDP/TLS/RTP/SAVPF 98\r\na=rtpmap:98 H264/90000\r\n'});await pc.createAnswer();assert.ok(!events.some(e=>e.event==='answer-preferred'));
 await pc.setRemoteDescription({type:'offer',sdp:'m=video 9 UDP/TLS/RTP/SAVPF 98\r\na=rtpmap:98 H265/90000\r\n'});await pc.createAnswer();assert.equal(calls.at(-1)[0].mimeType,'video/H265');assert.equal(calls.at(-1)[1].mimeType,'video/H264');
});
