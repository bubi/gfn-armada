const {test}=require('node:test'),assert=require('node:assert/strict');
const {encode,Reader}=require('../client/helper-wire.cjs');
test('helper wire preserves binary access units across arbitrary pipe fragmentation',()=>{
  const messages=[],reader=new Reader((header,bytes)=>messages.push({header,bytes:Buffer.from(bytes)}));
  const bytes=Buffer.from([0,0,0,1,0x65,0xff,0,13,10]);
  const wire=Buffer.concat([encode({kind:'push',sequence:1,key:true},bytes),encode({kind:'stop'})]);
  for(const byte of wire) reader.feed(Buffer.from([byte]));reader.end();
  assert.deepEqual(messages,[{header:{kind:'push',sequence:1,key:true},bytes},{header:{kind:'stop'},bytes:Buffer.alloc(0)}]);
});
test('helper wire rejects oversized prefixes and truncated or invalid metadata',()=>{
  const prefix=Buffer.alloc(4);prefix.writeUInt32BE(0xffffffff);
  assert.throws(()=>new Reader(()=>{}).feed(prefix),/frame length/);
  const reader=new Reader(()=>{});reader.feed(encode({kind:'push'}).subarray(0,7));assert.throws(()=>reader.end(),/Truncated/);
  assert.throws(()=>encode({kind:'push'},Buffer.alloc(2097153)),/too large/);
  assert.throws(()=>new Reader(()=>{}).feed(encode([])),/Invalid helper message/);
});
