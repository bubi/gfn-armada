// Diagnostic entry point. Chromium consumes logging flags on native startup;
// the production launcher must continue rejecting arbitrary runtime flags.
// Run only in an isolated test bundle whose package main points here.
const {app}=require('electron');
if(!process.argv.includes('--gfn-armada-native-helper')) {
  // Select the normal launch command after native startup has consumed argv.
  process.argv=[process.execPath,...(app.isPackaged?[]:[require('node:path').join(__dirname,'..')]),'launch'];
}
require('../client/main.cjs');
