# camera.py
import cv2, glob, os, time, csv, traceback
import numpy as np
from typing import Dict, Any, Generator, Optional, Tuple
from datetime import datetime, timedelta

# --- EVENTLET / FLASK SOCKETIO FIX ---
# We must use REAL threads/queues. Eventlet monkey-patching causes cv2.read() 
# to block the main server loop if run in a greenlet.
try:
    import eventlet.patcher
    # Grab original, unpatched modules
    _real_threading = eventlet.patcher.original('threading')
    _real_queue = eventlet.patcher.original('queue')
    
    Thread = _real_threading.Thread
    Event = _real_threading.Event
    Lock = _real_threading.Lock
    Queue = _real_queue.Queue
    Empty = _real_queue.Empty
    Full = _real_queue.Full
except (ImportError, AttributeError):
    # Fallback if eventlet isn't running
    from threading import Thread, Event, Lock
    from queue import Queue, Empty, Full

# --- Global Configuration ---
PREFERRED_SIZE = (640, 480)
PREFERRED_FPS = 30
RECORD_BASE_DIR = os.path.join(os.getcwd(), "recordings")
SESSION_GAP = timedelta(minutes=5)
FOURCC_MP4V = cv2.VideoWriter_fourcc(*'mp4v')

def _ensure_dir(path: str):
    try: os.makedirs(path, exist_ok=True)
    except Exception: pass

def _ts(fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    return datetime.now().strftime(fmt)

def _session_name(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d_%H-%M")

def _usb_video_paths():
    by_id = sorted(glob.glob("/dev/v4l/by-id/*"))
    usb_first = [p for p in by_id if "usb" in p.lower()]
    resolved = []
    for p in usb_first + by_id:
        try:
            real = os.path.realpath(p)
            base = os.path.basename(real)
            # IGNORE 4 and 5 (Thermal)
            if base in ["video4", "video5"]: 
                continue
            if base.startswith("video"):
                resolved.append(real)
        except Exception: pass
    return resolved

def _all_video_nodes():
    nodes = sorted(glob.glob("/dev/video*"))
    # IGNORE 4 and 5 here too!
    return [n for n in nodes if "video4" not in n and "video5" not in n]

class RecordingManager:
    def __init__(self):
        # Use the "Real" Queue (bypassing eventlet)
        self._q = Queue(maxsize=200)
        self._thr: Optional[Thread] = None
        self._stop_ev = Event()
        self._writing_lock = Lock()

        self._is_recording = False
        self._session_dir: Optional[str] = None
        self._session_started_at: Optional[datetime] = None
        self._last_stopped_at: Optional[datetime] = None
        self._segment_started_at: Optional[datetime] = None
        self._writer: Optional[cv2.VideoWriter] = None
        self._fps = PREFERRED_FPS
        self._size = PREFERRED_SIZE
        self._segment_index = 0
        _ensure_dir(RECORD_BASE_DIR)
        self._global_log_path = os.path.join(RECORD_BASE_DIR, "recordings.log")

    def _append_log(self, row: Dict[str, Any]):
        try:
            exists = os.path.exists(self._global_log_path)
            with open(self._global_log_path, "a", newline="") as f:
                w = csv.DictWriter(f, fieldnames=["time", "event", "session_dir", "segment_file", "fps", "size", "note"])
                if not exists: w.writeheader()
                w.writerow(row)
        except Exception: pass

    def _append_session_log(self, text: str):
        try:
            if not self._session_dir: return
            with open(os.path.join(self._session_dir, "session.log"), "a") as f:
                f.write(f"[{_ts()}] {text}\n")
        except Exception: pass

    def _pick_session_dir(self) -> str:
        now = datetime.now()
        reuse = (self._session_dir is not None and self._last_stopped_at is not None and (now - self._last_stopped_at) <= SESSION_GAP)
        if reuse: return self._session_dir
        name = _session_name(now)
        path = os.path.join(RECORD_BASE_DIR, name)
        _ensure_dir(path)
        return path

    def start(self, fps: float, size: Tuple[int, int]) -> bool:
        with self._writing_lock:
            try:
                try: fps_val = float(fps) if fps and fps > 1 else float(PREFERRED_FPS)
                except Exception: fps_val = float(PREFERRED_FPS)
                self._fps = fps_val
                self._size = (int(size[0]), int(size[1])) if size and size[0] and size[1] else PREFERRED_SIZE
                self._session_dir = self._pick_session_dir()
                _ensure_dir(self._session_dir)
                if self._session_started_at is None or (self._last_stopped_at and (datetime.now() - self._last_stopped_at) > SESSION_GAP):
                    self._session_started_at = datetime.now()
                    self._segment_index = 0
                self._segment_index += 1
                seg_ts = datetime.now()
                self._segment_started_at = seg_ts
                seg_name = f"segment_{seg_ts.strftime('%Y%m%d_%H%M%S')}.mp4"
                seg_path = os.path.join(self._session_dir, seg_name)
                
                self._writer = cv2.VideoWriter(seg_path, FOURCC_MP4V, self._fps, self._size)
                if not self._writer or not self._writer.isOpened():
                    self._writer = None; raise RuntimeError("VideoWriter open failed")
                
                if not self._thr or not self._thr.is_alive():
                    self._stop_ev.clear()
                    # Use "Real" Thread
                    self._thr = Thread(target=self._run, name="RecordingWriter", daemon=True)
                    self._thr.start()
                
                self._is_recording = True
                self._append_log({"time": _ts(), "event": "start_segment", "session_dir": self._session_dir, "segment_file": seg_name, "fps": f"{self._fps:.2f}", "size": f"{self._size}", "note": ""})
                self._append_session_log(f"Started segment {seg_name} @ {self._fps:.2f} FPS {self._size}")
                return True
            except Exception as e:
                self._is_recording = False
                self._writer = None
                self._append_log({"time": _ts(), "event": "error_start", "session_dir": self._session_dir or "", "segment_file": "", "fps": "0", "size": "0", "note": f"{e}"})
                traceback.print_exc()
                return False

    def stop(self):
        with self._writing_lock:
            try:
                self._is_recording = False
                self._last_stopped_at = datetime.now()
                if self._writer:
                    try: self._writer.release()
                    except Exception: pass
                self._writer = None
                self._append_log({"time": _ts(), "event": "stop_segment", "session_dir": self._session_dir or "", "segment_file": "", "fps": f"{self._fps:.2f}", "size": f"{self._size}", "note": ""})
                self._append_session_log("Stopped segment.")
            except Exception: pass
            finally:
                try:
                    while not self._q.empty(): self._q.get_nowait()
                except Exception: pass

    def _run(self):
        while not self._stop_ev.is_set():
            try: 
                frame, ts = self._q.get(timeout=0.25)
            except Empty: 
                continue
            try:
                with self._writing_lock:
                    if self._is_recording and self._writer:
                        h, w = frame.shape[:2]
                        if (w, h) != self._size: frame = cv2.resize(frame, self._size)
                        self._writer.write(frame)
            except Exception as e:
                self._is_recording = False
                try:
                    if self._writer: self._writer.release()
                except Exception: pass
                self._writer = None
                self._append_log({"time": _ts(), "event": "error_write", "session_dir": self._session_dir or "", "segment_file": "", "fps": "0", "size": "0", "note": f"{e}"})

    def enqueue(self, frame: np.ndarray):
        if not self._is_recording: return
        try: self._q.put_nowait((frame, time.time()))
        except Full: pass

    def status(self) -> Dict[str, Any]:
        return {
            "recording": bool(self._is_recording),
            "session_dir": self._session_dir,
            "session_started_at": self._session_started_at.isoformat() if self._session_started_at else None,
            "segment_started_at": self._segment_started_at.isoformat() if self._segment_started_at else None,
            "fps": float(self._fps),
            "size": list(self._size),
            "queue_backlog": self._q.qsize(),
        }

# ---------------- Camera Manager ----------------

class CameraManager:
    def __init__(self):
        self.cap = None
        self.is_running = False
        self.lock = Lock() # Real lock
        self.frame = None
        self.dev_path = None
        self.recorder = RecordingManager()
        
        self._worker_thread = None
        self._worker_stop_event = Event() # Real event

    def _open_try(self, dev: str) -> bool:
        print(f"[camera] Trying {dev} with CAP_V4L2")
        cap = cv2.VideoCapture(dev, cv2.CAP_V4L2)
        if not cap or not cap.isOpened():
            print(f"[camera] Failed V4L2 open on {dev}, trying default backend…")
            cap = cv2.VideoCapture(dev)
            if not cap or not cap.isOpened():
                print(f"[camera] Could not open {dev}")
                return False

        cap.set(cv2.CAP_PROP_FRAME_WIDTH,  PREFERRED_SIZE[0])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, PREFERRED_SIZE[1])
        cap.set(cv2.CAP_PROP_FPS,          PREFERRED_FPS)
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
        try: cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception: pass
        
        ok, frame = cap.read()
        if not ok or frame is None:
            cap.release()
            return False

        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        print(f"[camera] Opened {dev} {w}x{h}")
        self.cap = cap
        self.dev_path = dev
        return True

    def _worker(self):
        print("[camera] Worker thread started (REAL THREAD).")
        while not self._worker_stop_event.is_set():
            if self.cap and self.cap.isOpened():
                # This call BLOCKS, but since we are in a Real Thread, it won't kill Flask
                ret, frame = self.cap.read()
                if ret and frame is not None:
                    self.frame = frame
                    self.recorder.enqueue(frame)
                else:
                    time.sleep(0.01)
            else:
                time.sleep(0.1)
        print("[camera] Worker thread exiting.")

    def start(self) -> bool:
        with self.lock:
            if self.is_running: return True
            
            candidates = _usb_video_paths()
            if not candidates:
                all_nodes = _all_video_nodes()
                candidates = [p for p in all_nodes if p.endswith(tuple(str(n) for n in range(8, 33)))] + all_nodes
            
            started = False
            tried = set()
            for dev in candidates:
                if dev in tried: continue
                tried.add(dev)
                if self._open_try(dev):
                    started = True
                    break
            
            if not started:
                print("[camera] No working camera found.")
                return False

            self.is_running = True
            
            # Start Worker in REAL Thread
            self._worker_stop_event.clear()
            self._worker_thread = Thread(target=self._worker, daemon=True)
            self._worker_thread.start()
            
            print(f"[camera] Camera started on {self.dev_path}")
            return True

    def stop(self):
        with self.lock:
            if not self.is_running: return
            
            print("[camera] Stopping...")
            self.is_running = False
            
            self._worker_stop_event.set()
            if self._worker_thread:
                self._worker_thread.join(timeout=2.0)
            
            try: self.recorder.stop()
            except Exception: traceback.print_exc()

            if self.cap:
                self.cap.release()
                self.cap = None
            
            self.frame = None
            self.dev_path = None
            print("[camera] Stopped.")

    def _placeholder_jpeg(self) -> bytes:
        img = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.putText(img, 'Camera Not Available', (120, 220), cv2.FONT_HERSHEY_SIMPLEX, 1, (255,255,255), 2)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return buf.tobytes() if ok else b""

    def get_frame(self) -> bytes:
        if not self.is_running: return self._placeholder_jpeg()
        current_frame = self.frame
        if current_frame is not None:
            ok, buf = cv2.imencode(".jpg", current_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if ok: return buf.tobytes()
        return self._placeholder_jpeg()

    def get_status(self) -> Dict[str, Any]:
        s = {
            "running": self.is_running,
            "camera_available": bool(self.cap and self.cap.isOpened()),
            "device": self.dev_path,
            "frame_available": self.frame is not None
        }
        try: s["recording"] = self.recorder.status()
        except Exception: s["recording"] = {"recording": False}
        return s

    def start_recording(self) -> bool:
        if not self.is_running or not self.cap: return False
        fps = self.cap.get(cv2.CAP_PROP_FPS) or PREFERRED_FPS
        w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or PREFERRED_SIZE[0]
        h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or PREFERRED_SIZE[1]
        return self.recorder.start(fps, (w, h))

    def stop_recording(self):
        self.recorder.stop()

# ---- module-level helpers ----
camera_manager = CameraManager()

def start_camera() -> bool: return camera_manager.start()
def stop_camera(): camera_manager.stop()
def video_feed_generator() -> Generator[bytes, None, None]:
    boundary = b'--frame\r\nContent-Type: image/jpeg\r\n\r\n'
    while True:
        if not camera_manager.is_running: break
        yield boundary + camera_manager.get_frame() + b'\r\n'
        time.sleep(0.033)
def get_camera_status() -> Dict[str, Any]: return camera_manager.get_status()
def start_recording() -> bool: return camera_manager.start_recording()
def stop_recording(): camera_manager.stop_recording()
def get_recording_status() -> Dict[str, Any]: return camera_manager.recorder.status()