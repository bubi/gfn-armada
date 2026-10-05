const MODES=['linux','windows','macos','chromeos'];
function identity({mode=process.env.GFN_ARMADA_BROWSER_IDENTITY,chrome,arch=process.arch}={}) {
  if(mode===undefined)return null;
  if(!MODES.includes(mode))throw new Error('GFN_ARMADA_BROWSER_IDENTITY must be linux, windows, macos or chromeos');
  if(!/^\d+\.\d+\.\d+\.\d+$/.test(chrome))throw new Error('Invalid Chromium version for browser identity');
  const major=chrome.split('.')[0];
  const platforms={linux:['X11; Linux aarch64','Linux aarch64','Linux',''],
    windows:['Windows NT 10.0; Win64; x64','Win32','Windows','10.0.0'],
    macos:['Macintosh; Intel Mac OS X 10_15_7','MacIntel','macOS','10.15.7'],
    chromeos:['X11; CrOS aarch64 16093.0.0','Linux aarch64','Chrome OS','16093.0.0']};
  const [uaPlatform,platform,hintPlatform,platformVersion]=platforms[mode];
  return {mode,userAgent:`Mozilla/5.0 (${uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`,platform,
    hints:{brands:[{brand:'Chromium',version:major},{brand:'Google Chrome',version:major}],mobile:false,
      platform:hintPlatform,platformVersion,architecture:arch==='arm64'?'arm':'x86',bitness:'64',model:'',
      fullVersionList:[{brand:'Chromium',version:chrome},{brand:'Google Chrome',version:chrome}],uaFullVersion:chrome,wow64:false}};
}
function requestHeaders(headers,id) {
  const result={...headers};
  const values={'user-agent':id.userAgent,'sec-ch-ua':id.hints.brands.map(b=>`"${b.brand}";v="${b.version}"`).join(', '),
    'sec-ch-ua-platform':JSON.stringify(id.hints.platform),'sec-ch-ua-mobile':'?0',
    'sec-ch-ua-platform-version':JSON.stringify(id.hints.platformVersion),'sec-ch-ua-arch':JSON.stringify(id.hints.architecture),
    'sec-ch-ua-bitness':'"64"','sec-ch-ua-model':'""','sec-ch-ua-full-version':JSON.stringify(id.hints.uaFullVersion),
    'sec-ch-ua-full-version-list':id.hints.fullVersionList.map(b=>`"${b.brand}";v="${b.version}"`).join(', '),'sec-ch-ua-wow64':'?0'};
  for(const key of Object.keys(result))if(key.toLowerCase() in values)result[key]=values[key.toLowerCase()];
  for(const key of ['User-Agent','Sec-CH-UA','Sec-CH-UA-Platform','Sec-CH-UA-Mobile']) {
    if(!Object.keys(result).some(k=>k.toLowerCase()===key.toLowerCase()))result[key]=values[key.toLowerCase()];
  }
  return result;
}
module.exports={identity,requestHeaders};
