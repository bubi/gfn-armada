const {test}=require('node:test');const assert=require('node:assert/strict');
const {packet,rtpDelta,MAX_BYTES}=require('../client/encoded-packet.cjs');
const valid=()=>({generation:'12345678-1234-1234-1234-123456789abc',sequence:1,timestamp:0xffffff00,key:true,bytes:new Uint8Array([0,0,0,1,0x65])});
test('compressed input rejects malformed payloads and discontinuous sequences before native code',()=>{
  assert.equal(packet(valid(),1).key,true);
  for(const change of [{sequence:2},{generation:'other'},{timestamp:NaN},{timestamp:-1},{key:'yes'},{bytes:[]},{bytes:new Uint8Array(MAX_BYTES+1)},{bytes:new Uint8Array([1,2,3,4])}])
    assert.throws(()=>packet({...valid(),...change},1));
});
test('RTP clock handles rollover but fails closed on stale/out-of-order frames',()=>{
  assert.equal(rtpDelta(0xffffff00,0x00000ab8),1000000/30);
  assert.throws(()=>rtpDelta(5000,4000));assert.throws(()=>rtpDelta(0,90000*6));
});
