"""Compile only (never upload). All configuration, cache and output stay here.

python firmware/build.py
python firmware/build.py --reuse-toolchain C:/path/to/previous/firmware/.toolchain
Reuse reads installed packages and executables, never installs into shared packages.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1]
FIRMWARE=ROOT/'firmware'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install-core',action='store_true')
    parser.add_argument('--ports',action='store_true')
    parser.add_argument('--reuse-toolchain',type=Path)
    parser.add_argument('--huge-app',action='store_true',help='Require 4MB flash, Huge APP 3MB partition')
    options=parser.parse_args()
    cache=FIRMWARE/'.toolchain'; cache.mkdir(parents=True,exist_ok=True)
    reuse=options.reuse_toolchain
    settings=cache/'reuse-toolchain.json'
    if reuse:
        reuse=reuse.resolve()
        settings.write_text(json.dumps({'readOnlyToolchain':str(reuse)},indent=2))
    elif settings.exists(): reuse=Path(json.loads(settings.read_text())['readOnlyToolchain'])
    if reuse and options.install_core:
        raise SystemExit('Refusing install into reused read-only packages. Use a fresh local toolchain.')
    data=cache/'data'; data.mkdir(exist_ok=True)
    if reuse:
        for source in (reuse/'data').iterdir():
            if source.is_file() and not (data/source.name).exists(): shutil.copyfile(source,data/source.name)
        packages=data/'packages'
        if not packages.exists():
            # Arduino CLI cannot reliably follow Windows junctions. Private
            # package directory, hardlinked immutable ESP tools/core, copied
            # builtin tools (CLI can automatically update builtins).
            def copy_package(source,target):
                if 'builtin' in Path(source).parts: return shutil.copy2(source,target)
                os.link(source,target)
                return target
            shutil.copytree(reuse/'data/packages',packages,copy_function=copy_package)
    local=cache/'arduino/arduino-cli.exe'
    cli=str(local) if local.exists() else shutil.which('arduino-cli')
    if not cli and reuse: cli=str(reuse/'arduino/arduino-cli.exe')
    if not cli: raise SystemExit('Install Arduino CLI on PATH or firmware/.toolchain/arduino; see firmware/README.md.')
    config=cache/'arduino-cli.yaml'
    directories={k:(cache/v).as_posix() for k,v in [('data','data'),('downloads','downloads'),('user','user')]}
    config.write_text('board_manager:\n  additional_urls:\n    - https://espressif.github.io/arduino-esp32/package_esp32_index.json\n'+
        'build_cache:\n  path: "'+(cache/'build-cache').as_posix()+'"\n'+
        'directories:\n'+''.join(f'  {k}: "{v}"\n' for k,v in directories.items()),encoding='utf-8')
    base=[cli,'--config-file',str(config)]
    if options.ports:
        subprocess.run(base+['board','list'],check=True); return
    if options.install_core:
        subprocess.run(base+['core','update-index'],check=True)
        subprocess.run(base+['core','install','esp32:esp32@3.3.2'],check=True)
    subprocess.run([sys.executable,str(ROOT/'tools/embed-web.py')],check=True)
    manifest=json.loads((FIRMWARE/'web-assets.json').read_text())
    sources=[x['path'] for x in manifest]+['firmware/HeadSafe/HeadSafe.ino','firmware/HeadSafe/alarm_core.h','firmware/HeadSafe/config.h','firmware/HeadSafe/web_assets.h','firmware/web-assets.json','tools/embed-web.py']
    sha=lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    source_hashes={name:sha(ROOT/name) for name in sources}
    fqbn='esp32:esp32:esp32'+(':PartitionScheme=huge_app' if options.huge_app else '')
    command=base+['compile','--fqbn',fqbn,'--warnings','all','--build-path',str(FIRMWARE/'.build'),'--output-dir',str(FIRMWARE/'build'),str(FIRMWARE/'HeadSafe')]
    provenance=FIRMWARE/'build/build-provenance.json'
    provenance.unlink(missing_ok=True)
    result=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace')
    (FIRMWARE/'compile.log').write_text(result.stdout,encoding='utf-8')
    print(result.stdout,end='')
    if result.returncode: raise SystemExit(result.returncode)
    changed=[name for name,digest in source_hashes.items() if sha(ROOT/name)!=digest]
    if changed: raise SystemExit('Sources changed while compiling; rerun build before release: '+', '.join(changed))
    report={'fqbn':fqbn,'readOnlyToolchain':str(reuse) if reuse else None,
            'sources':source_hashes,
            'binaries':{p.name:{'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted((FIRMWARE/'build').glob('*.bin'))}}
    (FIRMWARE/'build/build-provenance.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
if __name__=='__main__': main()
