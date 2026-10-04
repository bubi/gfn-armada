// Binary framed IPC. Only compressed access units cross this OS-process boundary.
const MAX_HEADER=4096,MAX_PAYLOAD=2097152;
function encode(message,bytes=Buffer.alloc(0)) {
  const header=Buffer.from(JSON.stringify(message));
  if(!header.length||header.length>MAX_HEADER||bytes.byteLength>MAX_PAYLOAD) throw new Error('Helper message too large');
  const prefix=Buffer.alloc(6);prefix.writeUInt32BE(2+header.length+bytes.byteLength);prefix.writeUInt16BE(header.length,4);
  return Buffer.concat([prefix,header,bytes]);
}
class Reader {
  constructor(onMessage,maxBody=MAX_HEADER+MAX_PAYLOAD+2){this.onMessage=onMessage;this.maxBody=maxBody;this.prefix=Buffer.alloc(4);this.used=0;this.body=null;}
  feed(chunk){
    let offset=0;
    while(offset<chunk.length){
      const target=this.body||this.prefix,n=Math.min(target.length-this.used,chunk.length-offset);
      chunk.copy(target,this.used,offset,offset+n);this.used+=n;offset+=n;
      if(this.used!==target.length) continue;
      if(!this.body){
        const length=this.prefix.readUInt32BE();
        if(length<3||length>this.maxBody) throw new Error('Invalid helper frame length');
        this.body=Buffer.allocUnsafe(length);this.used=0;
      }else{
        const body=this.body;this.body=null;this.used=0;
        const length=body.readUInt16BE();
        if(!length||length>MAX_HEADER||length>body.length-2) throw new Error('Invalid helper header length');
        const message=JSON.parse(body.subarray(2,2+length).toString());
        if(!message||typeof message!=='object'||Array.isArray(message)||typeof message.kind!=='string') throw new Error('Invalid helper message');
        this.onMessage(message,body.subarray(2+length));
      }
    }
  }
  end(){if(this.used||this.body) throw new Error('Truncated helper frame');}
}
module.exports={encode,Reader};
