"""Lanzador de HeadSafe. Usar pythonw.exe para no abrir consola."""
import ctypes
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
URL='http://127.0.0.1:8767'


def is_our_server(state):
    return isinstance(state,dict) and state.get('mode')=='simulation' and state.get('deviceId')=='HEADSAFE-ORIGINAL-DESIGN-DEMO'


def status():
    try:
        with urllib.request.urlopen(URL+'/api/status',timeout=0.6) as response:
            return json.load(response)
    except (OSError,ValueError):
        return None


def main():
    if not is_our_server(status()):
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1',8767))==0:
                raise RuntimeError('El puerto 8767 está ocupado por otra aplicación. No se ha modificado ni cerrado.')
        node=shutil.which('node')
        if not node:
            raise RuntimeError('No se encuentra Node.js. Instala Node.js 22 o superior para usar el simulador.')
        run=ROOT/'.run'
        run.mkdir(exist_ok=True)
        with (run/'simulator.log').open('ab') as log:
            process=subprocess.Popen([node,str(ROOT/'server.mjs')],cwd=ROOT,stdout=log,stderr=log,stdin=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),env={**os.environ,'PORT':'8767'})
        (run/'simulator.pid').write_text(str(process.pid),encoding='utf-8')
        for _ in range(60):
            if is_our_server(status()):break
            if process.poll() is not None:raise RuntimeError('El simulador no pudo arrancar. Revisa .run/simulator.log.')
            time.sleep(0.1)
        else:raise RuntimeError('El simulador no respondió al iniciar. Revisa .run/simulator.log.')
    if os.environ.get('HEADSAFE_NO_BROWSER')!='1':
        brave=Path(os.environ.get('PROGRAMFILES','C:/Program Files'))/'BraveSoftware/Brave-Browser/Application/brave.exe'
        if brave.exists():subprocess.Popen([str(brave),'--new-tab',URL],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        else:
            import webbrowser
            webbrowser.open(URL)
    return URL

if __name__=='__main__':
    try:
        result=main()
        if os.environ.get('HEADSAFE_NO_BROWSER')=='1':print(result)
    except Exception as exc:
        if os.name=='nt' and os.environ.get('HEADSAFE_NO_BROWSER')!='1':ctypes.windll.user32.MessageBoxW(None,str(exc),'HeadSafe — No se pudo abrir',16)
        else:raise
