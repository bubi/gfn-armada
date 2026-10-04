// Process-isolation tests only. Never reports a decoded frame or hardware success.
module.exports={openStream:()=>({device:'test-only-no-decoder'}),pushFrame:()=>true,
  pullFrame:()=>({eos:false}),releaseFrame:()=>{},close:()=>{}};
