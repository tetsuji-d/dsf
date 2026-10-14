"""Independent standard-library verification of actual DSF ZIP files."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parents[2] / 'outputs' / 'writing-w1'
results = []
base_bytes = None
for name in ('original', 'editable', 'shared'):
    with ZipFile(root / (name + '.dsf')) as archive:
        assert archive.testzip() is None
        assert archive.namelist()[0] == 'mimetype'
        assert archive.read('mimetype') == b'application/vnd.dsf.content+zip'
        manifest = json.loads(archive.read('manifest.json'))
        assert set(archive.namelist()) == {'manifest.json'} | {f['path'] for f in manifest['files']}
        for entry in manifest['files']:
            payload = archive.read(entry['path'])
            assert len(payload) == entry['byteLength']
            assert hashlib.sha256(payload).hexdigest() == entry['sha256']
        original = {f['path']: archive.read(f['path']) for f in json.loads(archive.read('base.json'))['entries']}
        if base_bytes is None:
            base_bytes = original
        assert original == base_bytes
        results.append({'file': name + '.dsf', 'entries': len(archive.namelist()), 'crcAndHashes': True, 'baseIdentical': True})
record = {'implementation': 'Python standard library zipfile', 'ok': True, 'results': results}
(root / 'independent-zip-verification.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
print(json.dumps(record, indent=2))
