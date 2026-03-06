# ws/camera.py
from flask_socketio import Namespace, emit, join_room, leave_room
from extensions import socketio
import camera
import time

ROOM = "camera"
TARGET_FPS = 20
MIN_INTERVAL = 1.0 / TARGET_FPS

_subscribers = 0
_bg_started = False  # ensure we start the loop only once

def _emit_loop():
    """Background task: emit latest JPEG to subscribers; drop intermediate frames."""
    last = 0.0
    while True:
        socketio.sleep(0.001)  # yield to event loop
        if _subscribers <= 0:
            continue
        now = time.time()
        if now - last < MIN_INTERVAL:
            continue
        try:
            frame = camera.camera_manager.get_frame()  # bytes of a JPEG
            if frame:
                socketio.emit("frame", frame, namespace="/camera", room=ROOM, binary=True)
                last = now
        except Exception:
            # avoid tight error loop
            last = now

class CameraNamespace(Namespace):
    def on_connect(self):
        emit("hello", {"ok": True})

    def on_subscribe(self):
        global _subscribers, _bg_started
        join_room(ROOM)
        _subscribers += 1
        emit("subscribed", {"ok": True})

        # start camera if not running (best-effort)
        try:
            camera.start_camera()
        except Exception:
            pass

        # ensure the background frame loop runs once
        if not _bg_started:
            socketio.start_background_task(_emit_loop)
            _bg_started = True

    def on_unsubscribe(self):
        global _subscribers
        leave_room(ROOM)
        _subscribers = max(0, _subscribers - 1)
        emit("unsubscribed", {"ok": True})
        # You may stop the camera when no one is watching (optional):
        # if _subscribers == 0:
        #     try: camera.stop_camera()
        #     except Exception: pass

    def on_disconnect(self):
        self.on_unsubscribe()
