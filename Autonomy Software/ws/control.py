# ws/control.py
from flask_socketio import Namespace, emit
from serial_worker import worker

def _parse_drive_payload(data):
    cmd = (data.get("cmd") or "").lower()
    if cmd in ("forward", "f"):
        speed = max(0, min(100, int(data.get("speed", 50))))
        return ("DriveForward", speed)
    if cmd in ("backward", "reverse", "b"):
        speed = max(0, min(100, int(data.get("speed", 50))))
        return ("DriveBackward", speed)
    if cmd in ("left", "l"):
        speed = max(0, min(100, int(data.get("speed", 50))))
        return ("DriveMixed", -speed, -speed)
    if cmd in ("right", "r"):
        speed = max(0, min(100, int(data.get("speed", 50))))
        return ("DriveMixed", speed, speed)
    if cmd in ("mix", "differential"):
        left = max(-100, min(100, int(data.get("left", 0))))
        right = max(-100, min(100, int(data.get("right", 0))))
        return ("DriveMixed", left, -right)  # keep your right inversion
    if cmd in ("stop", "s"):
        return ("StopAll",)
    return None

class ControlNamespace(Namespace):
    def on_connect(self):
        emit("hello", {"ok": True})

    def on_drive(self, data):
        parsed = _parse_drive_payload(data or {})
        if not parsed:
            emit("drive_ack", {"ok": False, "error": "bad cmd"})
            return
        name = parsed[0]
        if name == "DriveMixed":
            _, left, right = parsed
            worker.set_drive_mixed(left, right)
        elif name == "DriveForward":
            worker.set_drive_forward(parsed[1])
        elif name == "DriveBackward":
            worker.set_drive_backward(parsed[1])
        elif name == "StopAll":
            worker.set_stop()
        emit("drive_ack", {"ok": True})

    def on_stop(self):
        worker.set_stop()
        emit("stop_ack", {"ok": True})

    def on_mode(self, data):
        mode = (data or {}).get("mode", "").lower()
        if mode in ("car", "ground"):
            ok = worker.call("ChangeToCarMode", timeout=3.0)
        elif mode in ("drone", "air", "flight"):
            ok = worker.call("ChangeToDroneMode", timeout=3.0)
        else:
            emit("mode_ack", {"ok": False, "error": "mode must be 'car' or 'drone'"})
            return
        emit("mode_ack", {"ok": bool(ok), "mode": mode})
