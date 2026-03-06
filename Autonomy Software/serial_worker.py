# serial_worker.py
import threading, time
from queue import Queue, Empty
import ActuationBoard as AB  # must expose Connect(), StopAll(), Drive..., and AB.ser

class SerialWorker(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.cmd_q = Queue()
        self.connected = False
        self._lock = threading.Lock()
        self._latest_drive = None
        self._drive_event = threading.Event()
        self._last_applied_drive = None
        self._min_drive_apply_interval = 0.015  # ~66 Hz

    def _ensure_connected(self):
        try:
            if getattr(AB, "ser", None) is None or not AB.ser.is_open:
                self.connected = bool(AB.Connect())
            else:
                self.connected = True
        except Exception:
            self.connected = False
        return self.connected

    def run(self):
        last_drive_time = 0.0
        while True:
            did_drive = False
            if self._drive_event.is_set():
                now = time.time()
                if now - last_drive_time >= self._min_drive_apply_interval:
                    self._apply_latest_drive()
                    self._drive_event.clear()
                    last_drive_time = now
                    did_drive = True
            if did_drive:
                continue
            try:
                name, args, kwargs, reply_q = self.cmd_q.get(timeout=0.01)
            except Empty:
                continue

            ok = False
            try:
                if self._ensure_connected():
                    func = getattr(AB, name)
                    with self._lock:
                        ok = func(*args, **kwargs)
                if reply_q:
                    reply_q.put(bool(ok))
            except Exception:
                if reply_q:
                    reply_q.put(False)

    def _apply_latest_drive(self):
        item = self._latest_drive
        if not item:
            return
        name = item[0]
        if item == self._last_applied_drive:
            return
        try:
            if self._ensure_connected():
                func = getattr(AB, name)
                with self._lock:
                    if name == "DriveMixed":
                        _, left, right = item
                        func(left, right)
                    elif name in ("DriveForward", "DriveBackward"):
                        _, speed = item
                        func(speed)
                    elif name == "StopAll":
                        func()
                self._last_applied_drive = item
        except Exception:
            pass

    def call(self, name, *args, timeout=2.0, **kwargs):
        reply_q = Queue(maxsize=1)
        self.cmd_q.put((name, args, kwargs, reply_q))
        try:
            return reply_q.get(timeout=timeout)
        except Empty:
            return False

    def set_drive_mixed(self, left: int, right: int):
        left = max(-100, min(100, int(left)))
        right = max(-100, min(100, int(right)))
        self._latest_drive = ("DriveMixed", left, right)
        self._drive_event.set()
        return True

    def set_drive_forward(self, speed: int):
        speed = max(0, min(100, int(speed)))
        self._latest_drive = ("DriveForward", speed)
        self._drive_event.set()
        return True

    def set_drive_backward(self, speed: int):
        speed = max(0, min(100, int(speed)))
        self._latest_drive = ("DriveBackward", speed)
        self._drive_event.set()
        return True

    def set_stop(self):
        self._latest_drive = ("StopAll",)
        self._drive_event.set()
        return True

# single global worker instance
worker = SerialWorker()
