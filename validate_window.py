"""Verify the actual packaged browser window and window-close server lifecycle."""
import ctypes
from ctypes import wintypes as W
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT=Path(__file__).resolve().parent
kernel=ctypes.windll.kernel32
user=ctypes.windll.user32
class ProcessEntry(ctypes.Structure):
    _fields_=[('dwSize',W.DWORD),('cntUsage',W.DWORD),('th32ProcessID',W.DWORD),('th32DefaultHeapID',ctypes.c_size_t),('th32ModuleID',W.DWORD),('cntThreads',W.DWORD),('th32ParentProcessID',W.DWORD),('pcPriClassBase',W.LONG),('dwFlags',W.DWORD),('szExeFile',W.WCHAR*260)]
kernel.CreateToolhelp32Snapshot.argtypes=[W.DWORD,W.DWORD];kernel.CreateToolhelp32Snapshot.restype=W.HANDLE
kernel.Process32FirstW.argtypes=[W.HANDLE,ctypes.POINTER(ProcessEntry)]
kernel.Process32NextW.argtypes=[W.HANDLE,ctypes.POINTER(ProcessEntry)]
kernel.CloseHandle.argtypes=[W.HANDLE]
user.GetWindowThreadProcessId.argtypes=[W.HWND,ctypes.POINTER(W.DWORD)]
user.GetWindowTextW.argtypes=[W.HWND,W.LPWSTR,ctypes.c_int]
user.IsWindowVisible.argtypes=[W.HWND]
user.PostMessageW.argtypes=[W.HWND,W.UINT,W.WPARAM,W.LPARAM]
CALLBACK=ctypes.WINFUNCTYPE(W.BOOL,W.HWND,W.LPARAM)
user.EnumWindows.argtypes=[CALLBACK,W.LPARAM]

def descendants(pid):
    snapshot=kernel.CreateToolhelp32Snapshot(2,0);entry=ProcessEntry();entry.dwSize=ctypes.sizeof(entry);parents={}
    try:
        ok=kernel.Process32FirstW(snapshot,ctypes.byref(entry))
        while ok:
            parents[entry.th32ProcessID]=entry.th32ParentProcessID
            ok=kernel.Process32NextW(snapshot,ctypes.byref(entry))
    finally:kernel.CloseHandle(snapshot)
    result={pid}
    while True:
        expanded=result|{child for child,parent in parents.items() if parent in result}
        if expanded==result:return result
        result=expanded

def run():
    ctypes.windll.shcore.SetProcessDpiAwareness(1)
    with tempfile.TemporaryDirectory(dir=ROOT,prefix='.window-test-') as tmp:
        folder=Path(tmp);exe=folder/'GraphLab.exe'
        shutil.copy2(ROOT/'GraphLab.exe',exe);shutil.copytree(ROOT/'_internal',folder/'_internal')
        process=subprocess.Popen([str(exe)],cwd=ROOT)
        windows=[]
        try:
            deadline=time.monotonic()+30
            while time.monotonic()<deadline and not windows:
                assert process.poll() is None,'Launcher exited before its window'
                owned=descendants(process.pid)
                @CALLBACK
                def visit(hwnd,_):
                    pid=W.DWORD();user.GetWindowThreadProcessId(hwnd,ctypes.byref(pid))
                    if pid.value in owned and user.IsWindowVisible(hwnd):
                        text=ctypes.create_unicode_buffer(512);user.GetWindowTextW(hwnd,text,512)
                        if 'GraphLab' in text.value:windows.append(hwnd)
                    return True
                user.EnumWindows(visit,0);time.sleep(.2)
            assert windows,'No owned GraphLab browser window'
            time.sleep(1)
            # Chromium window capture may be black with GPU composition; the
            # packaged page screenshot is captured by validate_exe via Playwright.
            user.PostMessageW(windows[0],0x0010,0,0)
            assert process.wait(timeout=15)==0,'Service did not exit with browser window'
            assert not (folder/'data'/'runtime.json').exists()
            assert (folder/'data'/'browser').exists()
            time.sleep(1)
            report=dict(packaged_window='passed',window_close_stops_http=True,browser_profile_inside_project=True)
            (ROOT/'verification'/'window-results.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
            print(json.dumps(report))
        finally:
            if process.poll() is None:
                for hwnd in windows:user.PostMessageW(hwnd,0x0010,0,0)
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.terminate();process.wait(timeout=5)

if __name__=='__main__':run()
