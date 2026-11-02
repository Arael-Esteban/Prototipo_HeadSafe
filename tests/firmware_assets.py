"""Contracts for deterministic gzip, strict allowlisting, and exact source bytes."""
from pathlib import Path
import gzip
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
class Assets(unittest.TestCase):
    def test_real_embedded_resources_match_source(self):
        header=(ROOT/'firmware/HeadSafe/web_assets.h').read_text()
        entries=json.loads((ROOT/'firmware/web-assets.json').read_text())
        for i,entry in enumerate(entries):
            match=re.search(rf'WEB_ASSET_{i}\[\] PROGMEM = \{{([^}}]+)\}}',header,re.S)
            self.assertIsNotNone(match,entry['path'])
            compressed=bytes(int(v,16) for v in re.findall(r'0x([0-9a-f]{2})',match.group(1)))
            self.assertEqual(gzip.decompress(compressed),(ROOT/entry['path']).read_bytes(),entry['path'])
        for obsolete in ('headsafe-blueprint','base-informativa.js','style.css','Manrope.woff2','sw.js'):
            self.assertNotIn('// '+obsolete,header)
    def test_gzip_roundtrip_manifest_fail_closed(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'firmware') as tmp:
            p=Path(tmp); web=p/'web'; web.mkdir()
            sources={'index.html':b'<html>Espa\xc3\xb1ol</html>', 'app.js':b'console.log(1)', 'image.webp':bytes(range(256))}
            for name,raw in sources.items(): (web/name).write_bytes(raw)
            entries=[{'path':name,'url':'/' if name=='index.html' else '/'+name,'mime':mime} for name,mime in [('index.html','text/html; charset=utf-8'),('app.js','application/javascript; charset=utf-8'),('image.webp','image/webp')]]
            manifest=p/'manifest.json'; manifest.write_text(json.dumps(entries))
            command=[sys.executable,str(ROOT/'tools/embed-web.py'),'--web-dir',str(web),'--manifest',str(manifest),'--output',str(p/'assets.h')]
            subprocess.run(command,check=True)
            first=(p/'assets.h').read_bytes()
            subprocess.run(command,check=True)
            self.assertEqual(first,(p/'assets.h').read_bytes())
            header=first.decode()
            for i,(name,raw) in enumerate(sources.items()):
                match=re.search(rf'WEB_ASSET_{i}\[\] PROGMEM = \{{([^}}]+)\}}',header,re.S)
                self.assertIsNotNone(match)
                compressed=bytes(int(v,16) for v in re.findall(r'0x([0-9a-f]{2})',match.group(1)))
                self.assertEqual(gzip.decompress(compressed),raw)
                self.assertIn(hashlib.sha256(raw).hexdigest(),header)
            (web/'app.js').unlink()
            self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)
            self.assertEqual(first,(p/'assets.h').read_bytes())
            entries[1]['path']='../secret'
            manifest.write_text(json.dumps(entries))
            self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)
            self.assertEqual(first,(p/'assets.h').read_bytes())
if __name__=='__main__': unittest.main()
