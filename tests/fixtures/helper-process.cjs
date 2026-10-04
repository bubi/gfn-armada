const {Socket}=require('node:net');
const {Reader,encode}=require('../../client/helper-wire.cjs');
const input=new Socket({fd:3,readable:true,writable:false}),output=new Socket({fd:4,readable:false,writable:true});
const mode=process.argv[2];
const reader=new Reader(message=>{
  if(message.kind==='stop'){output.end(encode({kind:'closed',decoded:0,draws:0,released:0,outstanding:0}),()=>process.exit(0));return;}
  if(mode==='invalid-control'){output.write(encode({kind:'ack',sequence:'bad',accepted:true}));return;}
  if(mode==='delayed-ack'){setTimeout(()=>output.write(encode({kind:'ack',sequence:message.sequence,accepted:true})),60);return;}
  if(message.sequence===2) return; // Intentionally leave one request pending for the death test.
  output.write(encode({kind:'ack',sequence:message.sequence,accepted:true}));
});
input.on('data',chunk=>reader.feed(chunk));
if(mode!=='no-ready') output.write(encode({kind:'ready'}));
