#!/usr/bin/env node
const {processVideo}=require('../launcher/process-video.cjs');
const seconds=Number(process.argv[2]||30);
if(process.argv.length>3||!Number.isInteger(seconds)||seconds<1||seconds>300) {
  console.error('Usage: sample-video-access.cjs [seconds: 1..300]');process.exit(1);
}
let last;const deadline=Date.now()+seconds*1000;
function sample() {
  const report=processVideo();const key=JSON.stringify(report.processes);
  if(key!==last||Date.now()>=deadline) {console.log(JSON.stringify(report));last=key}
  if(Date.now()<deadline) setTimeout(sample,250);
}
sample();
