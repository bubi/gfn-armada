const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const TOML = require('@iarna/toml');
const defaults = Object.freeze({codec:'auto', resolution:'native', fps:120, bitrate:'auto', hardware_decode:true, steam_integration:true, fullscreen:true, compatibility_user_agent:true});
function paths(env=process.env) {
  const home = os.homedir();
  return {config:path.join(env.XDG_CONFIG_HOME || path.join(home,'.config'),'gfn-armada'),
    data:path.join(env.XDG_DATA_HOME || path.join(home,'.local/share'),'gfn-armada'),
    state:path.join(env.XDG_STATE_HOME || path.join(home,'.local/state'),'gfn-armada')};
}
function loadConfig(file=path.join(paths().config,'config.toml')) {
  const raw = fs.existsSync(file) ? TOML.parse(fs.readFileSync(file,'utf8')) : {};
  for (const k of Object.keys(raw)) if (!(k in defaults)) throw new Error(`Unknown config key: ${k}`);
  const cfg = {...defaults,...raw};
  if (!['auto','h264','hevc','av1'].includes(cfg.codec)) throw new Error('Invalid codec preference');
  for (const k of ['hardware_decode','steam_integration','fullscreen','compatibility_user_agent'])
    if (typeof cfg[k] !== 'boolean') throw new Error(`${k} must be boolean`);
  if (!Number.isInteger(cfg.fps) || cfg.fps < 1 || cfg.fps > 360) throw new Error('fps must be 1..360');
  if (typeof cfg.resolution !== 'string' || typeof cfg.bitrate !== 'string') throw new Error('resolution/bitrate must be strings');
  return cfg;
}
module.exports={paths,loadConfig,defaults};
