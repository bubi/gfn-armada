function manifest(rows) {
  return {schemaVersion:1,mode:'review-only',steamFilesModified:false,
    shortcuts:rows.map(r=>({name:r.name,steamAppId:r.steamAppId,executable:'gfn-armada',arguments:['launch',`steam:${r.steamAppId}`],controller:'Use Steam Input gamepad layout; verify standard mapping in GFN',artwork:r.artwork || null}))};
}
module.exports={manifest};
