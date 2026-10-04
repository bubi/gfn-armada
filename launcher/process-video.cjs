const fs=require('node:fs');
const path=require('node:path');
// Read only executable names and device FD links, never command lines or memory.
function processVideo(procRoot='/proc',executables=['gfn-armada-electron','chromium','chromium-browser','chrome']) {
  let entries;try{entries=fs.readdirSync(procRoot)}catch(e){return {status:'unavailable',error:e.code,processes:[]}}
  const processes=[];
  for(const pid of entries.filter(p=>/^\d+$/.test(p))) {
    const base=path.join(procRoot,pid);let executable;
    try{executable=path.basename(fs.readlinkSync(path.join(base,'exe'))).replace(/ \(deleted\)$/,'')}catch{continue}
    if(!executables.includes(executable)) continue;
    const devices=[];let status='readable';
    try {
      for(const fd of fs.readdirSync(path.join(base,'fd'))) {
        try {
          const target=fs.readlinkSync(path.join(base,'fd',fd));
          if(/^\/dev\/(video\d+|media\d+|dri\/(renderD\d+|card\d+))$/.test(target)) devices.push({fd,target});
        }catch{}
      }
    }catch{status='unreadable-or-exited'}
    processes.push({pid:Number(pid),executable,fdStatus:status,devices});
  }
  return {timestamp:new Date().toISOString(),status:'sampled',processes,
    note:'A device FD is access evidence, not proof of decoding. No FD in a snapshot does not establish software decoding; sandbox permissions and races can hide access.'};
}
module.exports={processVideo};
