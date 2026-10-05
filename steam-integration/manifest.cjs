const {gameKey}=require('../launcher/mapping.cjs');
function manifest(rows) {
  return {schemaVersion:1,mode:'review-only',steamFilesModified:false,
    shortcuts:rows.map(r=>({name:r.name,gameKey:gameKey(r),steamAppId:r.steamAppId||null,eligible:r.bookmarked===true&&r.owned===true,executable:'gfn-armada',arguments:['launch',gameKey(r)],controller:'Use Steam Input gamepad layout; verify standard mapping in GFN',artwork:r.artwork || null}))};
}
module.exports={manifest};
