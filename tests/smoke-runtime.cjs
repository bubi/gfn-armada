// Optional real Electron GUI/network smoke test. Not part of npm test.
// Set all XDG roots to disposable directories when invoking this script.
const {app}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
process.argv=[process.argv[0],path.resolve(__dirname,'..'),'login'];
const timer=setTimeout(()=>{console.error('SMOKE: timeout');app.exit(1)},45000);
app.on('browser-window-created',(_event,win)=>{
  win.hide();
  win.webContents.once('did-finish-load',()=>{
    try {
      assert.equal(new URL(win.webContents.getURL()).origin,'https://play.geforcenow.com');
      const prefs=win.webContents.getLastWebPreferences();
      assert.equal(prefs.sandbox,true);assert.equal(prefs.contextIsolation,true);assert.equal(prefs.nodeIntegration,false);
      console.log('SMOKE: GFN main document loaded, renderer sandboxed, profile='+app.getPath('userData'));
      clearTimeout(timer);app.quit();
    }catch(e){console.error(e);app.exit(1)}
  });
});
require('../client/main.cjs');
