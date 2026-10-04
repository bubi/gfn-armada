module.exports={...require('./fake-decoder.cjs'),pullFrame:()=>{
  throw new Error('First prototype requires negotiated limited-range BT.709 (test rejection)');
}};
