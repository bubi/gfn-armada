const fs=require('node:fs'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const patches=fs.readdirSync('/recipe/patches').filter(x=>/^000[1-4]-.*\.patch$/.test(x)).sort();
if(patches.length!==4)throw new Error('Expected all four validated Iris patches');
if(!fs.readFileSync('/driver/build/compile_commands.json','utf8').includes('IRIS_HAVE_GPU_COPY'))throw new Error('GPU copy support missing');
fs.writeFileSync('/out/manifest.json',JSON.stringify({schemaVersion:1,experimental:true,upstream:require('/recipe/sources.json').upstream,commit:require('/recipe/sources.json').commit,patches:patches.map(file=>({file,sha256:hash('/recipe/patches/'+file)})),moduleSha256:hash('/out/dri/v4l2_drv_video.so'),sourceSha256:hash('/out/patched-source.tar.gz'),architecture:process.arch,buildDistribution:'Debian bookworm ARM64',gpuCopyCompiled:true,packages:execFileSync('dpkg-query',['-W','-f=${Package}=${Version}\n'],{encoding:'utf8'}).trim().split('\n'),hardwareDecodeActive:'unknown',hevcValidated:false},null,2)+'\n');
