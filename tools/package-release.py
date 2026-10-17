from pathlib import Path
import subprocess,zipfile,hashlib
root=Path(__file__).resolve().parent.parent
subprocess.run(['node',str(root/'addons/arturia/build.mjs')],cwd=root,check=True)
import json
version=json.loads((root/'catalog.json').read_text('utf-8'))['strategies']['arturia']['version']
name='AI-Arturia-v'+version
bundle=root/'dist'/name
archive=root/'dist'/(name+'.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for f in sorted(bundle.rglob('*')):
        if not f.is_file():continue
        info=zipfile.ZipInfo(name+'/'+f.relative_to(bundle).as_posix(),date_time=(2026,10,17,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
        z.writestr(info,f.read_bytes())
checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.zip.sha256').write_text(checksum+'  '+archive.name+'\n',encoding='utf-8')
print(archive,checksum)
