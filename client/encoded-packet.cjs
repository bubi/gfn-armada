const MAX_BYTES=2097152;
function packet(data,expectedSequence) {
  if(!data || typeof data.generation!=='string' || !/^[0-9a-f-]{36}$/.test(data.generation) ||
     data.sequence!==expectedSequence || !Number.isInteger(data.timestamp) || data.timestamp<0 || data.timestamp>0xffffffff ||
     typeof data.key!=='boolean' || !(data.bytes instanceof Uint8Array) || !data.bytes.byteLength || data.bytes.byteLength>MAX_BYTES)
    throw new Error('Invalid encoded packet');
  const b=data.bytes;
  if(b.length<4 || b[0]!==0 || b[1]!==0 || !(b[2]===1 || (b[2]===0&&b[3]===1))) throw new Error('Non Annex-B packet');
  return data;
}
function rtpDelta(previous,current) {
  const delta=(current-previous+0x100000000)%0x100000000;
  if(delta>90000*5) throw new Error('RTP timestamp discontinuity');
  return delta*1000000/90000;
}
module.exports={packet,rtpDelta,MAX_BYTES};
