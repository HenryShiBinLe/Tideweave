"""Portable save data shared by the HTTP application and rule tests."""
import json
from pathlib import Path
import sys

def project_root():
    return Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent

class Progress:
    def __init__(self, path=None):
        self.path = Path(path) if path else project_root() / 'data' / 'progress.json'
        self.stars = [0] * 10
        self.last = 0
        self.sound = False
        self.motion = True
        self.error = ''
        try:
            if self.path.exists():
                data = json.loads(self.path.read_text(encoding='utf-8'))
                if not isinstance(data, dict):
                    raise ValueError('Invalid save')
                values = data.get('stars', [])
                if isinstance(values, list):
                    self.stars = [min(3, max(0, values[i])) if i < len(values) and type(values[i]) is int else 0 for i in range(10)]
                last = data.get('last', 0)
                self.last = last if type(last) is int and 0 <= last < 10 else 0
                self.sound = data.get('sound', False) is True
                self.motion = data.get('motion', True) is True
        except (OSError, ValueError, TypeError):
            self.error = '旧存档无法读取，已恢复默认进度。'

    def save(self):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix('.tmp')
            tmp.write_text(json.dumps(dict(version=1, stars=self.stars, last=self.last, sound=self.sound, motion=self.motion), ensure_ascii=False), encoding='utf-8')
            tmp.replace(self.path)
            self.error = ''
            return True
        except OSError:
            self.error = '存档未能写入；本次成绩仍保留在窗口中。'
            return False
