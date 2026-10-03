#!/usr/bin/env python3
"""Archive an already-built portable bundle with normalized metadata."""
import gzip
import hashlib
import json
from pathlib import Path
import tarfile

root = Path(__file__).resolve().parent.parent
bundle = root / 'dist/gfn-armada-linux-arm64'
if not (bundle / 'gfn-armada-electron').is_file():
    raise SystemExit('Build the portable ARM64 bundle first with ./scripts/package')
version = json.loads((root / 'package.json').read_text())['version']
output = root / f'dist/gfn-armada-{version}-linux-arm64.tar.gz'
with output.open('wb') as raw:
    with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=6) as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as archive:
            for file in [bundle, *sorted(bundle.rglob('*'))]:
                name = str(file.relative_to(bundle.parent))
                info = archive.gettarinfo(str(file), arcname=name)
                info.uid = info.gid = 0
                info.uname = info.gname = ''
                info.mtime = 0
                if info.isfile():
                    with file.open('rb') as source:
                        archive.addfile(info, source)
                else:
                    archive.addfile(info)
digest = hashlib.sha256()
with output.open('rb') as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b''):
        digest.update(chunk)
checksum = digest.hexdigest()
output.with_suffix(output.suffix + '.sha256').write_text(f'{checksum}  {output.name}\n')
print(output)
print(checksum)
