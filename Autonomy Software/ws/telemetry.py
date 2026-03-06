# ws/telemetry.py
import time
from flask_socketio import Namespace
from extensions import socketio
from mavlink_bridge import mav_bridge

class TelemetryNamespace(Namespace):
    """Broadcasts a telemetry snapshot at a fixed rate to all clients on /telemetry."""
    _thread = None

    def on_connect(self):
        # send an immediate snapshot to the connecting client
        try:
            snap = mav_bridge.get_snapshot()
        except Exception:
            snap = {
                "connected": False,
                "armed":False,
                "mode": None,
                "vehicle_type": None,
                "attitude": {"roll_deg": 0.0, "pitch_deg": 0.0, "yaw_deg": 0.0},
                "position": {"lat": None, "lon": None, "alt_m": None, "rel_alt_m": None},
                "vel": {"vx_ms": 0.0, "vy_ms": 0.0, "vz_ms": 0.0, "groundspeed_ms": 0.0},
                "heading_deg": None,
                "gps_sats": None,
                "battery_pct": None,
                "timestamp": 0,
            }
        socketio.emit("telemetry", snap, namespace="/telemetry", to=request.sid if hasattr(self, 'request') else None)

        # start background broadcast loop once per process
        if TelemetryNamespace._thread is None:
            TelemetryNamespace._thread = socketio.start_background_task(self._broadcast_loop)

    @staticmethod
    def _broadcast_loop():
        # 10 Hz broadcast
        period = 0.1
        while True:
            try:
                snap = mav_bridge.get_snapshot()
                socketio.emit("telemetry", snap, namespace="/telemetry", broadcast=True)
            except Exception:
                # keep going even if snapshot fails occasionally
                pass
            time.sleep(period)
