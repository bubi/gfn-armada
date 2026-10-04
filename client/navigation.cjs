function allowed(value) {
  try {
    const u=new URL(value);
    return u.protocol==='https:'&&!u.username&&!u.password&&(
      u.hostname==='play.geforcenow.com'||
      u.hostname==='nvidia.com'||u.hostname.endsWith('.nvidia.com')||
      u.hostname==='nvidia.cn'||u.hostname.endsWith('.nvidia.cn')||
      u.hostname==='appleid.apple.com'
    );
  }catch{return false}
}
function origin(value) {try{return new URL(value).origin}catch{return 'invalid'}}
module.exports={allowed,origin};
