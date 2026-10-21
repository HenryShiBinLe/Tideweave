"""Local HTTP host. All game assets and saves stay beside GraphLab.exe."""
from dataclasses import asdict
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from threading import Lock, Thread
import argparse
import json
import math
import os
import secrets
import subprocess
import sys
import time
import urllib.request
import webbrowser
from engine import LEVELS, CHAPTERS, Game, components
from persistence import Progress, project_root

WEB = Path(__file__).resolve().parent / 'web'

def clean(value):
    if isinstance(value, float) and math.isinf(value): return None
    if isinstance(value, dict): return {k: clean(v) for k, v in value.items()}
    if isinstance(value, (tuple, list, set)): return [clean(v) for v in value]
    return value

class Session:
    def __init__(self, save_path=None):
        self.progress = Progress(save_path)
        self.index = self.progress.last
        self.game = Game(LEVELS[self.index])
        self.revision = 0
        self.lock = Lock()
        self.last_seen = time.monotonic()

    def snapshot(self):
        s = self.game.state
        return clean(dict(index=self.index, level=asdict(self.game.level), state=asdict(s),
            revision=self.revision, message=self.game.message, alert=self.game.alert,
            conflicts=self.game.conflicts(), history=len(self.game.history), errors=self.game.errors,
            groups=len(set(components(self.game.level, s.selected))),
            progress=dict(stars=self.progress.stars, sound=self.progress.sound, motion=self.progress.motion),
            save_error=self.progress.error, chapters=CHAPTERS,
            levels=[dict(title=l.title, chapter=l.chapter, kind=l.kind) for l in LEVELS]))

    def action(self, data):
        if type(data.get('revision')) is not int or data['revision'] != self.revision:
            raise ValueError('画面已更新，请再操作一次。')
        action = data.get('action')
        n = data.get('index')
        if action in ('node', 'edge', 'level') and type(n) is not int:
            raise ValueError('无效的操作目标。')
        if action == 'level':
            if n not in range(10): raise ValueError('无效的关卡。')
            self.index = n
            self.game = Game(LEVELS[n])
            self.progress.last = n
            self.progress.save()
        elif action == 'node':
            color = data.get('color', 0)
            if type(color) is not int: raise ValueError('无效的颜色。')
            self.game.node(n, color)
        elif action == 'edge': self.game.edge(n)
        elif action == 'undo':
            if not self.game.state.finished: self.game.undo()
        elif action == 'hint': self.game.hint()
        elif action == 'reset': self.game = Game(LEVELS[self.index])
        elif action == 'submit': self.game.submit()
        elif action == 'settings':
            for key in ('sound', 'motion'):
                if key in data:
                    if type(data[key]) is not bool: raise ValueError('无效的设置。')
                    setattr(self.progress, key, data[key])
            self.progress.save()
        else: raise ValueError('未知操作。')
        if self.game.state.finished:
            self.progress.stars[self.index] = max(self.progress.stars[self.index], self.game.state.stars)
            self.progress.save()
        self.revision += 1
        return self.snapshot()

def create_server(save_path=None, port=0):
    session = Session(save_path)
    token = secrets.token_urlsafe(24)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def reply(self, code, body, mime='application/json; charset=utf-8'):
            raw = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False, allow_nan=False).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'")
            self.end_headers()
            try: self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError): pass
        def route(self):
            host = f'127.0.0.1:{self.server.server_port}'
            if self.headers.get('Host') != host: return None
            if not self.path.startswith('/' + token + '/'): return None
            return self.path[len(token)+2:].split('?', 1)[0]
        def do_GET(self):
            route = self.route()
            if route is None: return self.reply(404, {'error': 'Not found'})
            session.last_seen = time.monotonic()
            if route == 'api/state':
                with session.lock: return self.reply(200, session.snapshot())
            if route == 'api/ping': return self.reply(200, {'ok': True})
            files = {'': ('index.html', 'text/html; charset=utf-8'), 'app.js': ('app.js', 'text/javascript; charset=utf-8'), 'style.css': ('style.css', 'text/css; charset=utf-8'), 'paper.svg': ('paper.svg', 'image/svg+xml')}
            if route not in files: return self.reply(404, {'error': 'Not found'})
            name, mime = files[route]
            self.reply(200, (WEB / name).read_bytes(), mime)
        def do_POST(self):
            route = self.route()
            origin = self.headers.get('Origin')
            if route is None or (origin and origin != f'http://127.0.0.1:{self.server.server_port}'):
                return self.reply(403, {'error': '请求来源不匹配。'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 4096: raise ValueError('请求大小无效。')
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict): raise ValueError('请求格式无效。')
                session.last_seen = time.monotonic()
                if route == 'api/quit':
                    self.reply(200, {'ok': True})
                    Thread(target=self.server.shutdown, daemon=True).start()
                    return
                if route != 'api/action': return self.reply(404, {'error': 'Not found'})
                with session.lock: result = session.action(data)
                self.reply(200, result)
            except (ValueError, TypeError) as error: self.reply(400, {'error': str(error)})
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    server.session = session
    server.url = f'http://127.0.0.1:{server.server_port}/{token}/'
    return server

def open_window(url):
    root = project_root()
    candidates = [Path(os.environ.get(base, 'C:/')) / suffix for base, suffix in (
        ('PROGRAMFILES(X86)', 'Microsoft/Edge/Application/msedge.exe'),
        ('PROGRAMFILES', 'Microsoft/Edge/Application/msedge.exe'),
        ('PROGRAMFILES', 'Google/Chrome/Application/chrome.exe'))]
    for executable in candidates:
        if executable.exists():
            temp = root / 'data' / 'browser-temp'
            temp.mkdir(parents=True, exist_ok=True)
            return subprocess.Popen([str(executable), '--app=' + url,
                '--user-data-dir=' + str(root / 'data' / 'browser'), '--no-first-run',
                '--no-default-browser-check', '--disable-background-mode',
                '--disable-component-update', '--disable-sync', '--disable-background-networking',
                '--window-size=1440,940'], env=dict(os.environ, TEMP=str(temp), TMP=str(temp)))
    webbrowser.open(url)
    return None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--headless-service', action='store_true')
    args = parser.parse_args()
    root = project_root()
    runtime = root / 'data' / 'runtime.json'
    runtime.parent.mkdir(parents=True, exist_ok=True)
    if runtime.exists() and not args.headless_service:
        try:
            old = json.loads(runtime.read_text(encoding='utf-8'))
            url = old['url']
            if not url.startswith('http://127.0.0.1:'): raise ValueError('Invalid URL')
            with urllib.request.urlopen(url + 'api/ping', timeout=1) as response:
                if response.status == 200:
                    open_window(url)
                    return
        except (OSError, ValueError, KeyError): pass
    server = create_server()
    runtime.write_text(json.dumps({'url': server.url, 'pid': os.getpid()}), encoding='utf-8')
    server.session.progress.save()
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    browser = None
    try:
        if not args.headless_service: browser = open_window(server.url)
        while thread.is_alive():
            thread.join(.5)
            if browser is not None and browser.poll() is not None: break
            if not args.headless_service and time.monotonic() - server.session.last_seen > 180: break
    finally:
        server.shutdown()
        server.server_close()
        server.session.progress.save()
        try:
            if json.loads(runtime.read_text(encoding='utf-8')).get('pid') == os.getpid(): runtime.unlink()
        except (OSError, ValueError): pass

if __name__ == '__main__': main()
