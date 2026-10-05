const {test}=require('node:test'),assert=require('node:assert/strict');
const {environment,preferences}=require('../launcher/gaming-mode.cjs');
const env={GAMESCOPE_WAYLAND_DISPLAY:'gamescope-0',XDG_RUNTIME_DIR:'/run/user/1000',DISPLAY:':1',SteamAppId:'123'};
test('Steam Gamescope socket selects native Wayland and retains Steam process environment',()=>{
 let probed;const result=environment({env,platform:'linux',io:{statSync:p=>(probed=p,{isSocket:()=>true})}});
 assert.equal(probed,'/run/user/1000/gamescope-0');assert.equal(result.WAYLAND_DISPLAY,'gamescope-0');assert.equal(result.SteamAppId,'123');assert.equal(result.DISPLAY,':1');assert.equal(env.WAYLAND_DISPLAY,undefined);
});
test('Gaming Mode respects existing display/explicit X11 and rejects missing or invalid sockets',()=>{
 for(const input of [{...env,WAYLAND_DISPLAY:'wayland-1'},{...env,GFN_ARMADA_OZONE:'x11'},{...env,GAMESCOPE_WAYLAND_DISPLAY:'../socket'}])assert.deepEqual(environment({env:input,platform:'linux',io:{statSync:()=>{throw Error('must not probe')}}}),input);
 assert.equal(environment({env,platform:'linux',io:{statSync:()=>({isSocket:()=>false})}}).WAYLAND_DISPLAY,undefined);
 assert.equal(environment({env,platform:'darwin'}).WAYLAND_DISPLAY,undefined);
});
test('HEVC config enables only opt-in codec preference and preserves explicit overrides',()=>{
 assert.equal(preferences({}, {codec:'hevc'}).GFN_ARMADA_HEVC_EXPERIMENT,'1');
 assert.equal(preferences({GFN_ARMADA_HEVC_EXPERIMENT:'0'}, {codec:'hevc'}).GFN_ARMADA_HEVC_EXPERIMENT,'0');
 assert.equal(preferences({GFN_ARMADA_AV1_EXPERIMENT:'1'}, {codec:'hevc'}).GFN_ARMADA_HEVC_EXPERIMENT,undefined);
 assert.deepEqual(preferences({}, {codec:'auto'}),{});
});
