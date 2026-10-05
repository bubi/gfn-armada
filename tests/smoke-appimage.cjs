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
  assert.match(invoke(['help']),/gfn-armada library/);
  const diagnostics=JSON.parse(invoke(['diagnostics']));assert.equal(diagnostics.architecture,'arm64');assert.equal(diagnostics.bundledDecoder.bundled,true);assert.equal(diagnostics.bundledDecoder.selected,false);
  const extracted=spawnSync(file,['--appimage-extract'],{cwd:root,encoding:'utf8',timeout:60000});assert.equal(extracted.status,0,extracted.stderr);
  const driverRoot=path.join(root,'squashfs-root/usr/lib/gfn-armada/iris-driver'),driver=path.join(driverRoot,'dri/v4l2_drv_video.so');
  const manifest=JSON.parse(fs.readFileSync(path.join(driverRoot,'manifest.json')));
  assert.equal(manifest.patches.length,4);assert.equal(manifest.gpuCopyCompiled,true);
  assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(driver)).digest('hex'),manifest.moduleSha256);
  const deps=spawnSync('ldd',[driver],{encoding:'utf8'});assert.equal(deps.status,0,deps.stderr);assert.doesNotMatch(deps.stdout,/not found/);
  const load=spawnSync('python3',['-c','import ctypes,sys; ctypes.CDLL(sys.argv[1])',driver],{encoding:'utf8'});assert.equal(load.status,0,load.stderr);
  assert.match(invoke(['config']),/gfn-armada/);
  invoke(['launch','steam:999999999'],false);
  fs.mkdirSync(path.join(config,'gfn-armada'),{recursive:true});fs.mkdirSync(path.join(user,'config'),{recursive:true});
  fs.writeFileSync(path.join(config,'gfn-armada/games.json'),JSON.stringify([
    {store:'epic',storeGameId:'synthetic-test',name:'Synthetic smoke game',bookmarked:true,owned:true,launchURL:'https://play.geforcenow.com/mall/#/streamer?launchSource=GeForceNOW&cmsId=123'},
    {store:'gog',storeGameId:'456',name:'Not owned',bookmarked:true,owned:false,launchURL:'https://play.geforcenow.com/mall/#/streamer?launchSource=GeForceNOW&cmsId=123'}
  ]));
  const packagedCatalog=require(path.join(root,'squashfs-root/usr/lib/gfn-armada/resources/app/launcher/catalog.cjs'));
  const importedRows=packagedCatalog.normalizeApp({id:'synthetic-app',title:'Synthetic smoke game',library:{favorited:true},variants:[{id:'123',appStore:'EPIC',storeUrl:'https://store.epicgames.com/en-US/p/synthetic-test',gfn:{library:{status:'PLATFORM_SYNC'}}}]});
  const imported=packagedCatalog.importCatalog({complete:true,rows:importedRows,apps:1,fetchedAt:new Date().toISOString(),accountFingerprint:'synthetic-smoke'},path.join(config,'gfn-armada/games.json'));assert.equal(imported.imported,1);
  const args=['sync','--steam-user',user],review=JSON.parse(invoke(args));
  assert.equal(review.mode,'review-only');assert.equal(review.changes.length,1);assert.equal(review.skipped.length,1);
  assert.equal(review.changes[0].launchOptions,'--appimage-extract-and-run launch gfn:123');
  assert.equal(fs.existsSync(path.join(user,'config/shortcuts.vdf')),false);
  const applied=JSON.parse(invoke([...args,'--apply']));assert.equal(applied.steamFilesModified,true);
  assert.equal(JSON.parse(invoke(args)).changes.length,0);
  assert.equal(JSON.parse(invoke(['steam-restore',applied.backup])).restored,true);
  assert.equal(fs.existsSync(path.join(user,'config/shortcuts.vdf')),false);
  console.log(JSON.stringify({architecture:process.arch,uid:process.getuid(),appImage:file,driverSha256:manifest.moduleSha256,driverDlopen:true,driverPatches:4,help:true,diagnostics:true,config:true,unknownMappingRejected:true,catalogImportSynthetic:true,steamReviewApplyIdempotenceRestore:true,authenticatedCatalog:'not-tested',gui:'not-tested',gamescope:'not-tested',hardwareDecode:'unknown'}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
