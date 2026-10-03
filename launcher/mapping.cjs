const fs = require('node:fs');
const path = require('node:path');
const {paths} = require('./config.cjs');
const HOME = 'https://play.geforcenow.com/';
function validatedURL(value) {
  const u = new URL(value);
  if (u.origin !== 'https://play.geforcenow.com' || u.username || u.password) throw new Error('Launch URL must use the official GFN origin');
  // Only the upstream-observed route; never invent IDs or carry auth parameters.
  if (u.pathname !== '/mall/' || !/^#\/streamer\?/.test(u.hash) || u.search) throw new Error('Expected a captured GFN streamer URL');
  if(u.hash.split('?').length!==2) throw new Error('Malformed streamer fragment');
  const q=new URLSearchParams(u.hash.split('?')[1]);
  if([...q].length!==2) throw new Error('Expected exactly two launch parameters');
  if (!/^\d+$/.test(q.get('cmsId') || '') || q.get('launchSource') !== 'GeForceNOW' || [...q.keys()].some(k=>!['cmsId','launchSource'].includes(k))) throw new Error('Unsupported launch URL parameters');
  return u.href;
}
function readMappings(file=path.join(paths().config,'games.json')) {
  if (!fs.existsSync(file)) return [];
  const rows=JSON.parse(fs.readFileSync(file,'utf8'));
  if (!Array.isArray(rows)) throw new Error('games.json must contain an array');
  const ids=new Set();
  for (const row of rows) {
    if (!/^\d+$/.test(row.steamAppId) || !row.name || typeof row.name !== 'string' || /[\r\n\0]/.test(row.name)) throw new Error('Invalid game mapping');
    if (ids.has(row.steamAppId)) throw new Error('Duplicate Steam AppID');
    ids.add(row.steamAppId);
    validatedURL(row.launchURL);
  }
  return rows;
}
function resolveGame(target, rows=readMappings()) {
  if (!target) return {url:HOME,game:null};
  const match=/^steam:(\d+)$/.exec(target);
  const candidates=match ? rows.filter(r=>r.steamAppId===match[1]) : rows.filter(r=>r.name.toLowerCase()===target.toLowerCase());
  if (candidates.length!==1) throw new Error(`No unique verified mapping for ${target}. Add a captured launch URL to games.json; no GFN ID is guessed.`);
  return {url:validatedURL(candidates[0].launchURL),game:candidates[0].name};
}
function saveMapping(row,file=path.join(paths().config,'games.json')) {
  const url=validatedURL(row.launchURL);
  if(typeof row.steamAppId!=='string' || !/^\d+$/.test(row.steamAppId) || typeof row.name!=='string' || !row.name || /[\r\n\0]/.test(row.name)) throw new Error('Invalid game mapping');
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const existing=readMappings(file);
  const rows=existing.filter(r=>r.steamAppId!==row.steamAppId);
  rows.push({steamAppId:row.steamAppId,name:row.name,launchURL:url});
  if(fs.existsSync(file)) fs.copyFileSync(file,`${file}.backup-${Date.now()}`,fs.constants.COPYFILE_EXCL);
  const temporary=`${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary,JSON.stringify(rows,null,2)+'\n',{flag:'wx',mode:0o600});
  try {fs.renameSync(temporary,file)} finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary)}
  return rows;
}
module.exports={HOME,validatedURL,readMappings,resolveGame,saveMapping};
