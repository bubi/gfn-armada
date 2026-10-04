const propertyNames=new Set(['kVideoDecoderName','kIsPlatformVideoDecoder','video_decoder','is_platform_video_decoder']);
function decoderProperties(params) {
  if(!params||!Array.isArray(params.properties)) return null;
  const properties=params.properties.filter(p=>propertyNames.has(p.name)&&typeof p.value==='string'&&p.value.length<=128)
    .map(({name,value})=>({name,value}));
  return properties.length?{playerId:params.playerId,properties}:null;
}
function attachMediaDiagnostics(contents,report) {
  try {
    contents.debugger.attach('1.3');
    contents.debugger.on('message',(_event,method,params)=>{
      if(method!=='Media.playerPropertiesChanged') return;
      const data=decoderProperties(params);if(data) report(data);
    });
    contents.debugger.sendCommand('Media.enable').catch(()=>report({status:'unavailable'}));
    contents.debugger.on('detach',()=>report({status:'detached'}));
  }catch{report({status:'unavailable'})}
}
module.exports={decoderProperties,attachMediaDiagnostics};
