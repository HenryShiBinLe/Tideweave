"""Smoke test copied executable's HTTP assets, rules, portable save and shutdown."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request

ROOT=Path(__file__).resolve().parent

def run():
    with tempfile.TemporaryDirectory(dir=ROOT,prefix='.exe-test-') as temp:
        folder=Path(temp);exe=folder/'GraphLab.exe'
        shutil.copy2(ROOT/'GraphLab.exe',exe);shutil.copytree(ROOT/'_internal',folder/'_internal')
        elsewhere=folder/'different-working-directory';elsewhere.mkdir()
        env=dict(os.environ,LOCALAPPDATA=str(folder/'appdata'),PYTHONDONTWRITEBYTECODE='1')
        process=subprocess.Popen([str(exe),'--headless-service'],cwd=elsewhere,env=env)
        runtime=folder/'data'/'runtime.json'
        try:
            deadline=time.monotonic()+25
            while not runtime.exists() and time.monotonic()<deadline:
                assert process.poll() is None,'Executable exited early';time.sleep(.1)
            assert runtime.exists(),'No local HTTP endpoint'
            url=json.loads(runtime.read_text())['url']
            def get(route):
                with urllib.request.urlopen(url+route,timeout=5) as r:return r.read()
            def post(route,data):
                req=urllib.request.Request(url+route,data=json.dumps(data).encode(),headers={'Content-Type':'application/json'},method='POST')
                with urllib.request.urlopen(req,timeout=5) as r:return json.load(r)
            assert b'GRAPH' in get('');assert b'clamp(' in get('style.css');assert b'WebSocket' not in get('app.js')
            browser_env=dict(os.environ,GRAPH_URL=url,GRAPH_TEST_DIR=str(folder),GRAPH_SMOKE_ONLY='1')
            subprocess.run(['node',str(ROOT/'verify_poster.cjs')],env=browser_env,cwd=ROOT,check=True)
            state=json.loads(get('api/state'))
            state=post('api/action',dict(action='node',index=1,revision=state['revision']))
            assert state['state']['current']==1
            post('api/quit',{})
            assert process.wait(timeout=10)==0
            assert (folder/'data'/'progress.json').exists()
            assert not (elsewhere/'data').exists();assert not runtime.exists()
            assert not (folder/'appdata'/'GraphLab').exists()
            report=dict(launch='passed',exit_code=0,http_assets='passed',game_action='passed',portable_runtime_copy=True,different_working_directory=True,save_relative_to_exe='data/progress.json',network='loopback HTTP',websocket=False)
            (ROOT/'verification'/'exe-results.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
        finally:
            if process.poll() is None:process.terminate();process.wait(timeout=5)

if __name__=='__main__':run()
