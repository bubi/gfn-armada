// Tests pipeline preparation only; never supplies decoded frames.
let opened=false;
module.exports={
  ...require('./fake-decoder.cjs'),
  openStream(){
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);
    opened=true;return {device:'test-only-prewarm'};
  },
  pushFrame(){if(!opened) throw new Error('Pipeline not prepared');return true;}
};
