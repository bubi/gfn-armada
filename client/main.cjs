// The native helper gets its own Electron main/GPU processes and temporary profile.
if(process.argv.includes('--gfn-armada-native-helper')) require('./native-helper.cjs');
else require('./application.cjs');
