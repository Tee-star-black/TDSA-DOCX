"""Import verified, non-restricted source PDFs into ignored local storage."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('archive', help='Path to the supplied sop.zip')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
manifest = root / '.data/catalogue.json'
if not manifest.exists():
    raise SystemExit('Private catalogue missing. Extract the separately supplied source catalogue into the project root first.')
catalogue = json.loads(manifest.read_text())
dest = root / '.data/documents'
dest.mkdir(parents=True, exist_ok=True)
imported = skipped = 0
with zipfile.ZipFile(args.archive) as archive:
    if len(archive.infolist()) > 1000 or sum(i.file_size for i in archive.infolist()) > 50_000_000:
        raise SystemExit('Archive exceeds import limits')
    by_name = {i.filename: i for i in archive.infolist()}
    pending = []
    for doc in catalogue:
        if doc['restricted']:
            skipped += 1
            continue
        name = 'sop/' + doc['filename']
        if name not in by_name:
            raise SystemExit('Missing expected source: ' + doc['filename'])
        info = by_name[name]
        if info.file_size > 10_000_000:
            raise SystemExit('Document exceeds import size limit')
        data = archive.read(name)
        if not data.startswith(b'%PDF-') or hashlib.sha256(data).hexdigest() != doc['sha256']:
            raise SystemExit('Source hash mismatch: ' + doc['filename'])
        pending.append((dest / (doc['sha256'] + '.pdf'), data))
    # Validate every expected file before writing any document bytes.
    for path, data in pending:
        temp = path.with_suffix('.tmp')
        temp.write_bytes(data)
        temp.replace(path)
        imported += 1
print(f'Imported {imported} source entries. Restricted scans skipped: {skipped}.')
print('Source import does not approve or publish these documents.')
