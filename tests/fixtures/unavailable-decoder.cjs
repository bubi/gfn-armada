module.exports={...require('./fake-decoder.cjs'),openStream(){throw new Error('test-pipeline-unavailable');}};
