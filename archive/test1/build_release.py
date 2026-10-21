"""Reproducible Windows release. Requires PyInstaller and Pillow only to build."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parent
def main():
    work=ROOT/'.build';work.mkdir(exist_ok=True)
    temp=work/'temp';temp.mkdir(exist_ok=True)
    env=dict(os.environ, PYINSTALLER_CONFIG_DIR=str(work/'cache'), TEMP=str(temp), TMP=str(temp), PYTHONDONTWRITEBYTECODE='1')
    assets=ROOT/'assets';assets.mkdir(exist_ok=True)
    im=Image.new('RGBA',(256,256),(242,237,228,255));d=ImageDraw.Draw(im)
    d.ellipse((50,28,224,202),outline='#111111',width=25)
    d.polygon(((18,209),(198,64),(142,225)),fill='#D92B2B')
    d.polygon(((147,25),(239,4),(242,18),(151,39)),fill='#111111')
    im.save(assets/'icon.png');im.save(assets/'icon.ico',sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
    subprocess.run([sys.executable,'-B','-m','unittest','-v','test_rules','test_http'],cwd=ROOT,env=env,check=True)
    subprocess.run([sys.executable,'-B','-m','PyInstaller','--noconfirm','--clean','--onedir','--windowed','--name','GraphLab',
                    '--icon',str(assets/'icon.ico'),'--add-data',str(ROOT/'web')+';web','--distpath',str(work/'dist'),
                    '--workpath',str(work/'work'),'--specpath',str(work),'app.py'],cwd=ROOT,env=env,check=True)
    bundled=work/'dist'/'GraphLab'
    runtime=ROOT/'_internal'
    if runtime.exists():
        if runtime.is_symlink() or runtime.resolve().parent!=ROOT.resolve():raise RuntimeError('Unexpected runtime path')
        shutil.rmtree(runtime)
    shutil.copytree(bundled/'_internal',runtime)
    shutil.copy2(bundled/'GraphLab.exe',ROOT/'GraphLab.exe')
    exe=ROOT/'GraphLab.exe'
    info={'file':'GraphLab.exe','bytes':exe.stat().st_size,'sha256':hashlib.sha256(exe.read_bytes()).hexdigest(),'tests':19,'ui_levels':10,'network':'loopback-http-only','interface':'constructivist HTML/CSS/SVG with text markers','palette':'#D92B2B #111111 #F2EDE4 #1E3A5F','layout':'portable-directory','runtime':'_internal','save':'data/progress.json'}
    (ROOT/'verification').mkdir(exist_ok=True)
    (ROOT/'verification'/'release.json').write_text(json.dumps(info,indent=2),encoding='utf-8')
    print(json.dumps(info))
    # This folder is exclusively created by this build script under this project.
    resolved=work.resolve()
    if resolved.parent!=ROOT.resolve() or work.is_symlink():raise RuntimeError('Unexpected build path')
    shutil.rmtree(resolved)

if __name__=='__main__':main()
