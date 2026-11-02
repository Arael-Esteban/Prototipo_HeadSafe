"""Compile and execute real portable C++ firmware logic, plus asset tests."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import json
ROOT=Path(__file__).resolve().parents[1]
cache=ROOT/'firmware/.toolchain'
cache.mkdir(parents=True,exist_ok=True)
zig=cache/'zig/ziglang/zig.exe'
settings=cache/'reuse-toolchain.json'
if not zig.exists() and settings.exists():
    zig=Path(json.loads(settings.read_text())['readOnlyToolchain'])/'zig/ziglang/zig.exe'
os.environ['ZIG_GLOBAL_CACHE_DIR']=str(cache/'zig-global-cache')
os.environ['ZIG_LOCAL_CACHE_DIR']=str(cache/'zig-local-cache')
compiler=os.environ.get('CXX') or shutil.which('g++') or shutil.which('clang++')
if compiler:
    command=[compiler]
elif zig.exists():
    command=[str(zig),'c++','-fno-exceptions','-fno-unwind-tables']
else:
    raise SystemExit('Set CXX to a native C++ compiler or install g++/clang++. See firmware/README.md.')
executable=cache/('firmware_test.exe' if os.name=='nt' else 'firmware_test')
subprocess.run(command+['-std=c++17','-Wall','-Wextra','-Werror',str(ROOT/'tests/firmware_core.cpp'),'-o',str(executable)],check=True,cwd=ROOT)
subprocess.run([str(executable)],check=True,cwd=ROOT)
subprocess.run([sys.executable,str(ROOT/'tests/firmware_assets.py')],check=True,cwd=ROOT)
subprocess.run([sys.executable,str(ROOT/'tests/firmware_source.py')],check=True,cwd=ROOT)
print('PASS: native firmware logic and embedded asset tests')
