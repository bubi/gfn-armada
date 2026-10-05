// Exercise the actual ARM64 AppImage runtime, bundled Electron/Node and CLI.
// No real Steam data, account credentials, compositor or NVIDIA session used.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const file=path.resolve('dist',`gfn-armada-${require('../package.json').version}-aarch64.AppImage`);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'gfn-appimage-smoke-'));
const config=path.join(root,'config'),user=path.join(root,'Steam/userdata/1234');
const env={...process.env,HOME:root,XDG_CONFIG_HOME:config,XDG_DATA_HOME:path.join(root,'data'),XDG_STATE_HOME:path.join(root,'state')};
function invoke(args,success=true){
  const r=spawnSync(file,['--appimage-extract-and-run',...args],{env,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
  if(r.error)throw r.error;
  assert.equal(r.status,success?0:1,r.stderr);
  return r.stdout;
}
try{
  assert.equal(process.arch,'arm64');assert.equal(process.platform,'linux');assert.notEqual(process.getuid(),0);
  assert.match(invoke(['help']),/steam-restore/);
  assert.equal(JSON.parse(invoke(['diagnostics'])).architecture,'arm64');
  assert.match(invoke(['config']),/gfn-armada/);
  invoke(['launch','steam:999999999'],false);
  fs.mkdirSync(path.join(config,'gfn-armada'),{recursive:true});fs.mkdirSync(path.join(user,'config'),{recursive:true});
  fs.writeFileSync(path.join(config,'gfn-armada/games.json'),JSON.stringify([
    {store:'epic',storeGameId:'synthetic-test',name:'Synthetic smoke game',bookmarked:true,owned:true,launchURL:'https://play.geforcenow.com/mall/#/streamer?launchSource=GeForceNOW&cmsId=123'},
    {store:'gog',storeGameId:'456',name:'Not owned',bookmarked:true,owned:false,launchURL:'https://play.geforcenow.com/mall/#/streamer?launchSource=GeForceNOW&cmsId=123'}
  ]));
  const args=['sync','--steam-user',user],review=JSON.parse(invoke(args));
  assert.equal(review.mode,'review-only');assert.equal(review.changes.length,1);assert.equal(review.skipped.length,1);
  assert.equal(review.changes[0].launchOptions,'--appimage-extract-and-run launch epic:synthetic-test');
  assert.equal(fs.existsSync(path.join(user,'config/shortcuts.vdf')),false);
  const applied=JSON.parse(invoke([...args,'--apply']));assert.equal(applied.steamFilesModified,true);
  assert.equal(JSON.parse(invoke(args)).changes.length,0);
  assert.equal(JSON.parse(invoke(['steam-restore',applied.backup])).restored,true);
  assert.equal(fs.existsSync(path.join(user,'config/shortcuts.vdf')),false);
  console.log(JSON.stringify({architecture:process.arch,uid:process.getuid(),appImage:file,help:true,diagnostics:true,config:true,unknownMappingRejected:true,steamReviewApplyIdempotenceRestore:true,gui:'not-tested',gamescope:'not-tested'}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
