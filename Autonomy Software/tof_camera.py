import cv2, glob, os, time, csv, traceback
import numpy as np
import ArducamDepthCamera as ac
from typing import Dict, Any, Generator, Optional, Tuple
from datetime import datetime, timedelta

# --- EVENTLET FIX ---
try:
    import eventlet.patcher
    _real_threading = eventlet.patcher.original('threading')
    _real_queue = eventlet.patcher.original('queue')
    
    Thread = _real_threading.Thread
    Event = _real_threading.Event
    Lock = _real_threading.Lock
    Queue = _real_queue.Queue
    Empty = _real_queue.Empty
    Full = _real_queue.Full
except (ImportError, AttributeError):
    from threading import Thread, Event, Lock
    from queue import Queue, Empty, Full

# --- Global Configuration ---
MAX_DISTANCE = 4000
DEFAULT_CONFIDENCE = 30
STREAM_FPS = 30 
STREAM_DELAY = 1.0 / STREAM_FPS 
RECORD_BASE_DIR = os.path.join(os.getcwd(), "tof_recordings") 
SESSION_GAP = timedelta(minutes=5)
FOURCC_MP4V = cv2.VideoWriter_fourcc(*'mp4v') 

def _ensure_dir(path: str):
    try: os.makedirs(path, exist_ok=True)
    except Exception: pass

def _ts(fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    return datetime.now().strftime(fmt)

def _session_name(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d_%H-%M")

# --- RecordingManager Class (Standard) ---
class RecordingManager:
    def __init__(self):
        self._q = Queue(maxsize=200) # Real Queue
        self._thr: Optional[Thread] = None
        self._stop_ev = Event()
        self._writing_lock = Lock()
        
        self._is_recording = False
        self._session_dir: Optional[str] = None
        self._session_started_at: Optional[datetime] = None
        self._last_stopped_at: Optional[datetime] = None
        self._segment_started_at: Optional[datetime] = None
        self._writer: Optional[cv2.VideoWriter] = None
        self._fps = STREAM_FPS 
        self._size = (640, 480) 
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
        except Exception: traceback.print_exc() 

    def _append_session_log(self, text: str):
        try:
            if not self._session_dir: return
            with open(os.path.join(self._session_dir, "session.log"), "a") as f:
                f.write(f"[{_ts()}] {text}\n")
        except Exception: traceback.print_exc()

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
                try: fps_val = float(fps) if fps and fps > 1 else float(STREAM_FPS)
                except Exception: fps_val = float(STREAM_FPS)
                self._fps = fps_val
                self._size = (int(size[0]), int(size[1])) if size and size[0] and size[1] else (640, 480)
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
                    self._writer = None; raise RuntimeError(f"VideoWriter open failed")
                
                if not self._thr or not self._thr.is_alive():
                    self._stop_ev.clear()
                    self._thr = Thread(target=self._run, name="RecordingWriter", daemon=True)
                    self._thr.start()
                
                self._is_recording = True
                self._append_log({"time": _ts(), "event": "start_segment", "session_dir": self._session_dir, "segment_file": seg_name, "fps": f"{self._fps:.2f}", "size": f"{self._size}", "note": ""})
                self._append_session_log(f"Started segment {seg_name} @ {self._fps:.2f} FPS {self._size}")
                print(f"[recording] Started recording to {seg_path}")
                return True
            except Exception as e:
                self._is_recording = False
                self._writer = None
                self._append_log({"time": _ts(), "event": "error_start", "session_dir": self._session_dir or "", "segment_file": "", "fps": f"{getattr(self, '_fps', STREAM_FPS)}", "size": f"{getattr(self, '_size', (640,480))}", "note": f"{e}"})
                traceback.print_exc()
                return False

    def stop(self):
        with self._writing_lock:
            try:
                self._is_recording = False
                self._last_stopped_at = datetime.now()
                if self._writer:
                    try: self._writer.release()
                    except Exception: traceback.print_exc()
                self._writer = None
                self._append_log({"time": _ts(), "event": "stop_segment", "session_dir": self._session_dir or "", "segment_file": "", "fps": f"{self._fps:.2f}", "size": f"{self._size}", "note": ""})
                self._append_session_log("Stopped segment.")
                print("[recording] Stopped recording segment.")
            except Exception: traceback.print_exc()
            finally:
                try:
                    while not self._q.empty(): self._q.get_nowait()
                except Exception: pass

    def _run(self):
        while not self._stop_ev.is_set():
            try: frame, ts = self._q.get(timeout=0.25) 
            except Empty: continue 
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
                except Exception: traceback.print_exc()
                self._writer = None
                self._append_log({"time": _ts(), "event": "error_write", "session_dir": self._session_dir or "", "segment_file": "", "fps": f"{self._fps:.2f}", "size": f"{self._size}", "note": f"{e}"})
                traceback.print_exc()

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

# --- Image Processing Function ---
def get_depth_image_for_processing(depth_buf, confidence_buf, max_range, confidence_threshold):
    result_image = (depth_buf * (255.0 / max_range)).astype(np.uint8)
    result_image = cv2.applyColorMap(result_image, cv2.COLORMAP_RAINBOW)
    mask = confidence_buf < confidence_threshold
    if len(result_image.shape) == 3 and len(mask.shape) == 2:
        result_image[mask] = (0, 0, 0)
    elif len(result_image.shape) == 2 and len(mask.shape) == 2:
        result_image[mask] = 0
    return result_image

# ---------------- TOF Camera Manager ----------------

class ToFCameraManager:
    def __init__(self):
        self.cam: Optional[ac.ArducamCamera] = None
        self.is_running = False
        self.lock = Lock()
        
        # Current Frame State
        self.frame_for_display: bytes = self._placeholder_jpeg() 
        self.frame_for_recording: Optional[np.ndarray] = None    
        
        # Raw buffers for dynamic confidence adjustment
        self.raw_data_lock = Lock()
        self.cached_depth: Optional[np.ndarray] = None
        self.cached_conf: Optional[np.ndarray] = None
        
        self.max_range: int = MAX_DISTANCE
        self.default_confidence: int = DEFAULT_CONFIDENCE
        self.recorder = RecordingManager()
        
        self._worker_thread = None
        self._worker_stop_event = Event()

    def _placeholder_jpeg(self) -> bytes:
        img = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.putText(img, 'ToF Camera Not Available', (120, 220), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return buf.tobytes() if ok else b""

    def _worker(self):
        print("[tof_camera] Worker thread started (REAL THREAD).")
        while not self._worker_stop_event.is_set():
            if not self.cam:
                time.sleep(0.1)
                continue
            
            try:
                frame = self.cam.requestFrame(200)
                if frame is not None and isinstance(frame, ac.DepthData):
                    depth_buf = frame.depth_data
                    confidence_buf = frame.confidence_data

                    # 1. Save RAW copies safely for get_frame() usage
                    with self.raw_data_lock:
                        self.cached_depth = depth_buf.copy()
                        self.cached_conf = confidence_buf.copy()

                    # 2. Process standard frame (using default confidence) for recording/default stream
                    processed_bgr = get_depth_image_for_processing(
                        depth_buf, 
                        confidence_buf, 
                        self.max_range, 
                        self.default_confidence
                    )
                    
                    self.frame_for_recording = processed_bgr
                    ok, buf = cv2.imencode(".jpg", processed_bgr, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    if ok:
                        self.frame_for_display = buf.tobytes()
                    
                    self.recorder.enqueue(processed_bgr)
                    self.cam.releaseFrame(frame)
                else:
                    time.sleep(0.01)
            except Exception as e:
                print(f"[tof_camera] Worker error: {e}")
                time.sleep(0.5) 
        print("[tof_camera] Worker thread exiting.")

    def start(self) -> bool:
        with self.lock:
            if self.is_running: return True
            
            print("[tof_camera] Starting Arducam Depth Camera...")
            try:
                cam = ac.ArducamCamera()
                success = False
                possible_idx = [0,1,2,3,6,7,8,9,10,11,12,13,14,15]
                for idx in possible_idx:
                    ret = cam.open(ac.Connection.CSI, idx) 
                    if ret != 0:
                        print(f"[tof_camera] Index {idx} open -> {ret}")
                    else:
                        success = True
                        print(f"[tof_camera] *** SUCCESS at Index {idx} ***")
                        break
                
                if not success:
                    print(f"[tof_camera] No working index found")
                    return False

                ret = cam.start(ac.FrameType.DEPTH)
                if ret != 0:
                    print(f"[tof_camera] Failed to start camera. Error code: {ret}")
                    cam.close()
                    return False
                
                cam.setControl(ac.Control.RANGE, self.max_range)
                self.max_range = cam.getControl(ac.Control.RANGE)

                self.cam = cam
                self.is_running = True
                
                self._worker_stop_event.clear()
                self._worker_thread = Thread(target=self._worker, daemon=True)
                self._worker_thread.start()
                
                print("[tof_camera] Camera started successfully.")
                return True
            except Exception as e:
                print(f"[tof_camera] Error during startup: {e}")
                self.is_running = False
                self.cam = None
                return False

    def stop(self):
        with self.lock:
            if not self.is_running: return
            
            self.is_running = False
            
            self._worker_stop_event.set()
            if self._worker_thread:
                self._worker_thread.join(timeout=2.0)
            
            self.recorder.stop()
            
            if self.cam:
                try:
                    self.cam.stop()
                    self.cam.close()
                except Exception as e:
                    print(f"[tof_camera] Error during release: {e}")
            self.cam = None
            self.cached_depth = None
            self.cached_conf = None
            self.frame_for_display = self._placeholder_jpeg()
            self.frame_for_recording = None
            print("[tof_camera] Camera released.")

    def get_frame(self, confidence_threshold: Optional[int]) -> bytes:
        if not self.is_running: return self._placeholder_jpeg()

        # CASE 1: Default confidence. Return the pre-processed cached frame (Fast)
        if confidence_threshold is None or confidence_threshold == self.default_confidence:
             return self.frame_for_display

        # CASE 2: Custom confidence. Re-process from raw data (Dynamic)
        with self.raw_data_lock:
            d = self.cached_depth
            c = self.cached_conf
        
        if d is not None and c is not None:
            try:
                processed = get_depth_image_for_processing(d, c, self.max_range, confidence_threshold)
                ok, buf = cv2.imencode(".jpg", processed, [cv2.IMWRITE_JPEG_QUALITY, 80])
                if ok:
                    return buf.tobytes()
            except Exception:
                pass

        return self.frame_for_display

    def get_status(self) -> Dict[str, Any]:
        s = {
            "running": self.is_running,
            "max_range_mm": self.max_range,
            "default_confidence_threshold": self.default_confidence,
            "frame_available": self.frame_for_display != self._placeholder_jpeg()
        }
        try: s["recording"] = self.recorder.status()
        except Exception: s["recording"] = {"recording": False}
        return s

    def start_recording(self) -> bool:
        try:
            if not self.is_running:
                print("[tof_camera] Cannot start recording: camera not running.")
                return False
            
            if self.frame_for_recording is not None:
                h, w = self.frame_for_recording.shape[:2]
                current_size = (w, h)
            else:
                current_size = (640, 480) 

            return self.recorder.start(STREAM_FPS, current_size)
        except Exception:
            traceback.print_exc()
            return False

    def stop_recording(self):
        try: self.recorder.stop()
        except Exception: traceback.print_exc()

# ---- module-level helpers ----
tof_camera_manager = ToFCameraManager()

def start_camera() -> bool: return tof_camera_manager.start()
def stop_camera(): tof_camera_manager.stop()
def get_camera_status() -> Dict[str, Any]: return tof_camera_manager.get_status()
def video_feed_generator(confidence_threshold: int) -> Generator[bytes, None, None]:
    boundary = b'--frame\r\nContent-Type: image/jpeg\r\n\r\n'
    while True:
        if not tof_camera_manager.is_running: break
        frame_bytes = tof_camera_manager.get_frame(confidence_threshold)
        yield boundary + frame_bytes + b'\r\n'
        time.sleep(STREAM_DELAY)
def start_recording() -> bool: return tof_camera_manager.start_recording()
def stop_recording(): tof_camera_manager.stop_recording()
def get_recording_status() -> Dict[str, Any]:
    try: return tof_camera_manager.recorder.status()
    except Exception: return {"recording": False}