const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {paths} = require('./config.cjs');
const HOME = 'https://play.geforcenow.com/';
function gameKey(row) {
  const store=row.store||'steam';
  const id=row.storeGameId||row.steamAppId;
  if(!['steam','epic','gog','xbox'].includes(store)||typeof id!=='string'||!(/^[A-Za-z0-9._-]{1,128}$/).test(id)) throw new Error('Invalid store game identifier');
  if(['steam','gog'].includes(store)&&!/^\d+$/.test(id)) throw new Error('Steam/GOG game identifiers must be numeric');
  if(store==='steam'&&row.steamAppId&&row.steamAppId!==id) throw new Error('Conflicting Steam identifiers');
  return `${store}:${id}`;
}
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
    const key=gameKey(row);
    if (!row.name || typeof row.name !== 'string' || /[\r\n\0]/.test(row.name)) throw new Error('Invalid game mapping');
    if (ids.has(key)) throw new Error('Duplicate Steam AppID or store game identifier');
    ids.add(key);
    for(const field of ['bookmarked','owned']) if(row[field]!==undefined&&typeof row[field]!=='boolean') throw new Error(`${field} must be boolean`);
    validatedURL(row.launchURL);
  }
  return rows;
}
function resolveGame(target, rows=readMappings()) {
  if (!target) return {url:HOME,game:null};
  const isKey=/^(steam|epic|gog|xbox):/.test(target);
  const candidates=isKey ? rows.filter(r=>gameKey(r)===target) : rows.filter(r=>r.name.toLowerCase()===target.toLowerCase());
  if (candidates.length!==1) throw new Error(`No unique verified mapping for ${target}. Add a captured launch URL to games.json; no GFN ID is guessed.`);
  return {url:validatedURL(candidates[0].launchURL),game:candidates[0].name};
}
function saveMapping(row,file=path.join(paths().config,'games.json')) {
  const url=validatedURL(row.launchURL);
  const key=gameKey(row);
  if(typeof row.name!=='string' || !row.name || /[\r\n\0]/.test(row.name)) throw new Error('Invalid game mapping');
  for(const field of ['bookmarked','owned']) if(row[field]!==undefined&&typeof row[field]!=='boolean') throw new Error(`${field} must be boolean`);
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const existing=readMappings(file);
  const rows=existing.filter(r=>gameKey(r)!==key);
  const old=existing.find(r=>gameKey(r)===key)||{};
  rows.push({...old,...row,name:row.name,launchURL:url});
  if(fs.existsSync(file)) fs.copyFileSync(file,`${file}.backup-${Date.now()}-${randomUUID()}`,fs.constants.COPYFILE_EXCL);
  const temporary=`${file}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(temporary,JSON.stringify(rows,null,2)+'\n',{flag:'wx',mode:0o600});
  try {fs.renameSync(temporary,file)} finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary)}
  return rows;
}
module.exports={HOME,validatedURL,readMappings,resolveGame,saveMapping,gameKey};
