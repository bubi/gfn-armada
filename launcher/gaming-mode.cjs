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
module.exports={environment,preferences};
