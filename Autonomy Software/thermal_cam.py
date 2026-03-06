import subprocess
import sys
import threading
import time
import struct
import numpy as np
import os
import signal
from typing import Dict, Any

# Standard imports from your project
from camera import RecordingManager, PREFERRED_FPS

class ThermalCameraManager:
    def __init__(self):
        self._proc = None
        self._thread = None
        self._running = False
        self._last_frame = None
        self.recorder = RecordingManager()
        self.lock = threading.Lock()

    def _kill_zombies(self):
        """Finds and kills any lingering thermal_worker.py processes"""
        try:
            # Use pgrep to find the PID of any python process running our worker script
            cmd = "pgrep -f thermal_worker.py"
            output = subprocess.check_output(cmd, shell=True).decode()
            pids = output.strip().split('\n')
            
            for pid in pids:
                if pid:
                    pid_int = int(pid)
                    print(f"[thermal] Killing zombie worker PID: {pid_int}")
                    try:
                        os.kill(pid_int, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    except Exception as e:
                        print(f"[thermal] Warning: Failed to kill {pid_int}: {e}")
                        
            time.sleep(0.5) # Allow OS to release file handles
        except subprocess.CalledProcessError:
            pass # No zombies found

    def start(self) -> bool:
        with self.lock:
            if self._running:
                return True
            
            # 1. Clean up any mess from before
            self._kill_zombies()
            
            print("[thermal] Launching thermal_worker.py subprocess...")
            try:
                # 2. Launch new worker
                # stderr=sys.stderr ensures errors print to your console for debugging
                self._proc = subprocess.Popen(
                    [sys.executable, 'thermal_worker.py'],
                    stdout=subprocess.PIPE,
                    stderr=sys.stderr, # Errors go directly to console
                    bufsize=0
                )
                self._running = True
                self._thread = threading.Thread(target=self._read_loop, daemon=True)
                self._thread.start()
                return True
            except Exception as e:
                print(f"[thermal] Failed to launch worker: {e}")
                return False

    def stop(self):
        with self.lock:
            self._running = False
            if self._proc:
                print("[thermal] sending SIGTERM to worker...")
                self._proc.terminate()
                try:
                    self._proc.wait(timeout=1.0)
                except subprocess.TimeoutExpired:
                    print("[thermal] worker refused to quit, SIGKILLing...")
                    self._proc.kill()
                self._proc = None
            
            # Double check nothing was left behind
            self._kill_zombies()
            self.recorder.stop()
            print("[thermal] Stopped.")

    def _read_loop(self):
        """Reads frames from the worker process stdout pipe"""
        while self._running and self._proc:
            try:
                # 1. Read Magic "FRAME" (5 bytes)
                magic = self._proc.stdout.read(5)
                if not magic: break 
                
                if magic != b'FRAME':
                    # Sync lost (shouldn't happen with flush), skip byte
                    self._proc.stdout.read(1)
                    continue

                # 2. Read Length (4 bytes)
                len_data = self._proc.stdout.read(4)
                if len(len_data) < 4: break
                length = struct.unpack('<L', len_data)[0]

                # 3. Read Image Data
                jpg_data = self._proc.stdout.read(length)
                if len(jpg_data) < length: break
                
                # Success
                self._last_frame = jpg_data
                
            except Exception:
                time.sleep(0.1)

    def get_frame(self) -> bytes:
        if self._last_frame:
            return self._last_frame
        return self._placeholder()

    def _placeholder(self) -> bytes:
        # Simple placeholder
        return b'' 

    def get_status(self) -> Dict[str, Any]:
        return {"running": self._running, "recording": {"recording": False}}

    def start_recording(self): return False
    def stop_recording(self): pass

# Singleton
thermal_manager = ThermalCameraManager()

# --- EXPORTS FOR FLASK (Copy ALL of this) ---
def start_camera(): return thermal_manager.start()
def stop_camera(): thermal_manager.stop()
def get_status(): return thermal_manager.get_status()
def start_recording(): return thermal_manager.start_recording()
def stop_recording(): thermal_manager.stop_recording()

def video_feed_generator():
    boundary = b'--frame\r\nContent-Type: image/jpeg\r\n\r\n'
    while True:
        if not thermal_manager.get_status()["running"]: 
             break
        frame = thermal_manager.get_frame()
        if frame:
            yield boundary + frame + b'\r\n'
        time.sleep(0.04)