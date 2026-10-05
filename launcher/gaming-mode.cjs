const fs=require('node:fs'),path=require('node:path');
// Use the compositor Steam already started; do not start another Gamescope.
function environment({env=process.env,platform=process.platform,io=fs}={}) {
 const next={...env};
 if(platform!=='linux'||next.WAYLAND_DISPLAY||next.GFN_ARMADA_OZONE==='x11')return next;
 const socket=next.GAMESCOPE_WAYLAND_DISPLAY,root=next.XDG_RUNTIME_DIR;
 if(typeof socket!=='string'||!/^gamescope-[0-9]+$/.test(socket)||!root||!path.isAbsolute(root))return next;
 try{if(io.statSync(path.join(root,socket)).isSocket())next.WAYLAND_DISPLAY=socket;}catch{}
 return next;
}
function preferences(env,cfg) {
 const next={...env};
 // A client negotiation experiment, not a NVIDIA settings parameter.
 if(cfg.codec==='hevc'&&next.GFN_ARMADA_HEVC_EXPERIMENT===undefined&&next.GFN_ARMADA_AV1_EXPERIMENT!=='1')next.GFN_ARMADA_HEVC_EXPERIMENT='1';
 return next;
}
function command({executable,args,env,platform=process.platform,io=fs}) {
 if(env.GFN_ARMADA_GAMESCOPE!=='nested')return {executable,args,env};
 if(platform!=='linux'||!env.DISPLAY||!env.SteamAppId)throw new Error('Nested Gamescope requires a Linux Steam launch with DISPLAY and SteamAppId');
 if(env.GFN_ARMADA_OZONE==='x11')throw new Error('Nested Gamescope client requires Wayland; remove GFN_ARMADA_OZONE=x11');
 const compositor='/usr/bin/gamescope';
 io.accessSync(compositor,fs.constants.X_OK);
 const next={...env,ENABLE_GAMESCOPE_WSI:'0',SDL_VIDEODRIVER:'x11'};
 // The outer SDL window must be visible to Steam's Xwayland window tracking.
 // Gamescope supplies its own Wayland socket to the child Chromium process.
 delete next.WAYLAND_DISPLAY;
 // Keep unrelated preload hooks. Exclude Steam's renderer injection for
 // this experimental native-Wayland path; its effect is not fully isolated.
 if(next.LD_PRELOAD)next.LD_PRELOAD=next.LD_PRELOAD.split(/[ :]+/).filter(p=>p&&!/(^|\/)gameoverlayrenderer\.so$/.test(p)).join(':');
 return {executable:compositor,args:['--expose-wayland','-f','-w','1920','-h','1080','-W','1920','-H','1080','--',executable,...args],env:next};
}
module.exports={environment,preferences,command};
