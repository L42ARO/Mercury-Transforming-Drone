# blueprints/control.py
from flask import Blueprint, request, jsonify
from serial_worker import worker
from mavlink_bridge import mav_bridge
import time

bp = Blueprint("control", __name__)

# ---------------- Ground (ActuationBoard) controls ----------------

@bp.post("/mode")
def set_mode():
    print("MODE REQUEST RECEIVED")
    data = request.get_json(silent=True) or {}
    mode = (data.get("mode") or "").lower()
    if mode in ("car", "ground"):
        print("CAR")
        ok = worker.call("ChangeToCarMode", timeout=3.0)
    elif mode in ("drone", "air", "flight"):
        print("DRONE")
        ok = worker.call("ChangeToDroneMode", timeout=3.0)
    else:
        return jsonify(ok=False, error="mode must be 'car' or 'drone'"), 400
    return jsonify(ok=bool(ok), mode=mode)

@bp.post("/drive")
def drive():
    data = request.get_json(silent=True) or {}
    cmd = (data.get("cmd") or "").lower()
    speed = max(0, min(100, int(data.get("speed", 50))))

    if cmd in ("forward", "f"):
        ok = worker.call("DriveForward", speed, timeout=2.0)
    elif cmd in ("backward", "reverse", "b"):
        ok = worker.call("DriveBackward", speed, timeout=2.0)
    elif cmd in ("left", "l"):
        ok = worker.call("DriveMixed", -speed, -speed, timeout=2.0)
    elif cmd in ("right", "r"):
        ok = worker.call("DriveMixed", speed, speed, timeout=2.0)
    elif cmd in ("mix", "differential"):
        left = max(-100, min(100, int(data.get("left", 0))))
        right = max(-100, min(100, int(data.get("right", 0))))
        ok = worker.call("DriveMixed", left, -right, timeout=2.0)  # keep your right inversion
    elif cmd in ("stop", "s"):
        ok = worker.call("StopAll", timeout=2.0)
    else:
        return jsonify(ok=False, error="cmd must be one of forward, backward, left, right, mix, stop"), 400

    return jsonify(ok=bool(ok))

@bp.post("/stop")
def stop():
    ok = worker.call("StopAll", timeout=2.0)
    return jsonify(ok=bool(ok))

@bp.post("/lock")
def lock():
    data = request.get_json(silent=True) or {}
    hold_ms = data.get("hold_ms", None)
    if hold_ms is not None:
        try:
            hold_ms = int(hold_ms)
        except Exception:
            return jsonify(ok=False, error="hold_ms must be an integer (0..65535)"), 400
        if hold_ms < 0 or hold_ms > 65535:
            return jsonify(ok=False, error="hold_ms must be in range 0..65535"), 400
        ok = worker.call("Lock", timeout=2.0, hold_ms=hold_ms)
        return jsonify(ok=bool(ok), hold_ms=hold_ms)
    else:
        ok = worker.call("Lock", timeout=2.0)
        return jsonify(ok=bool(ok), hold_ms=None)

@bp.post("/unlock")
def unlock():
    ok = worker.call("Unlock", timeout=2.0)
    return jsonify(ok=bool(ok))

# ---------------- MAVLink helpers ----------------

def _ensure_connected():
    if not getattr(mav_bridge, "master", None):
        return False, jsonify(ok=False, error="MAVLink not connected"), 503
    return True, None

def _ensure_disarmed():
    # Defensive: if no state or armed unknown, let the bridge decide again
    if getattr(mav_bridge, "state", {}).get("armed", False):
        return False, jsonify(ok=False, error="Vehicle must be DISARMED for this action"), 409
    return True, None

# ---------------- MAVLink quick actions ----------------

@bp.post("/arm")
def arm():
    ok, resp = _ensure_connected()
    if not ok: return resp
    mav_bridge.send_command_long(400, 1, 0)  # MAV_CMD_COMPONENT_ARM_DISARM
    return jsonify(ok=True, action="arm")

@bp.post("/disarm")
def disarm():
    ok, resp = _ensure_connected()
    if not ok: return resp
    mav_bridge.send_command_long(400, 0, 21196)
    # mav_bridge.send_command_long(400, 0, 0)
    return jsonify(ok=True, action="disarm")

@bp.post("/takeoff")
def takeoff():
    ok, resp = _ensure_connected()
    if not ok: return resp

    data = request.get_json(silent=True) or {}
    try:
        alt = float(data.get("altitude", 2))
    except (TypeError, ValueError):
        alt = 2.0

    if alt < 0.5:
        alt = 0.5
    if alt > 100:
        alt = 100.0

    try:
        # 1) Go to STABILIZE
        print("[/takeoff] Setting mode STABILIZE")
        _set_mode_internal("STABILIZE")
        time.sleep(0.2)  # tweak as needed

        # 2) Arm
        print("[/takeoff] Arming")
        mav_bridge.send_command_long(400, 1, 0)  # MAV_CMD_COMPONENT_ARM_DISARM
        time.sleep(2)  # give the FCU a moment to arm

        # 3) Switch to GUIDED
        print("[/takeoff] Setting mode GUIDED")
        _set_mode_internal("GUIDED")
        time.sleep(0.5)

        # 4) Existing takeoff logic
        print(f"[/takeoff] Sending NAV_TAKEOFF to alt={alt}")
        # MAV_CMD_NAV_TAKEOFF = 22 (param7 used for altitude here)
        mav_bridge.send_command_long(22, 0, 0, 0, 0, 0, 0, alt)

        return jsonify(ok=True, action="takeoff", altitude=alt)

    except ValueError as ve:
        return jsonify(ok=False, error=str(ve)), 400
    except Exception as e:
        return jsonify(ok=False, error=f"takeoff sequence failed: {e}"), 500

@bp.post("/land")
def land():
    ok, resp = _ensure_connected()
    if not ok: return resp
    mav_bridge.send_command_long(21, 0, 0, 0, 0, 0, 0, 0)  # MAV_CMD_NAV_LAND
    return jsonify(ok=True, action="land")

# --------- New: FCU maintenance / calibration endpoints ---------

@bp.post("/fcu/reboot")
def fcu_reboot():
    ok, resp = _ensure_connected()
    if not ok: return resp
    try:
        success = mav_bridge.reboot_autopilot()
        return jsonify(ok=bool(success), action="reboot")
    except Exception as e:
        return jsonify(ok=False, error=f"reboot failed: {e}"), 500

@bp.post("/fcu/preflight/level")
def fcu_preflight_level():
    ok, resp = _ensure_connected()
    if not ok: return resp
    ok2, resp2 = _ensure_disarmed()
    if not ok2: return resp2
    try:
        mav_bridge.preflight_level()
        return jsonify(ok=True, action="preflight_level")
    except Exception as e:
        return jsonify(ok=False, error=f"preflight_level failed: {e}"), 500

@bp.post("/fcu/preflight/gyro")
def fcu_preflight_gyro():
    ok, resp = _ensure_connected()
    if not ok: return resp
    ok2, resp2 = _ensure_disarmed()
    if not ok2: return resp2
    try:
        mav_bridge.preflight_gyro()
        return jsonify(ok=True, action="preflight_gyro")
    except Exception as e:
        return jsonify(ok=False, error=f"preflight_gyro failed: {e}"), 500

@bp.post("/fcu/preflight/accel")
def fcu_preflight_accel():
    ok, resp = _ensure_connected()
    if not ok: return resp
    ok2, resp2 = _ensure_disarmed()
    if not ok2: return resp2
    try:
        mav_bridge.preflight_accel()
        return jsonify(ok=True, action="preflight_accel")
    except Exception as e:
        return jsonify(ok=False, error=f"preflight_accel failed: {e}"), 500

# Optional: expose a quick snapshot/status endpoint
@bp.get("/status")
def status():
    try:
        snap = mav_bridge.get_snapshot()
        return jsonify(ok=True, **snap)
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500

# ---------------- Flight mode handling (Copter) ----------------

_CANONICAL_NAMES = {
    "stabilize": "STABILIZE",
    "acro": "ACRO",
    "althold": "ALT_HOLD",
    "alt_hold": "ALT_HOLD",
    "alt hold": "ALT_HOLD",
    "loiter": "LOITER",
    "poshold": "POSHOLD",
    "position": "POSHOLD",
    "auto": "AUTO",
    "guided": "GUIDED",
    "rtl": "RTL",
    "land": "LAND",
}
_FLIGHT_MODE_MAP = {
    "STABILIZE": 0, "ACRO": 1, "ALT_HOLD": 2, "AUTO": 3, "GUIDED": 4,
    "LOITER": 5, "RTL": 6, "POSHOLD": 19, "LAND": 9,
}

def _set_mode_internal(canonical: str):
    """
    Internal helper to set mode by canonical name (e.g. 'STABILIZE', 'GUIDED').
    Uses mav_bridge.set_mode if available, otherwise falls back to DO_SET_MODE.
    """
    if canonical not in _FLIGHT_MODE_MAP and not hasattr(mav_bridge, "set_mode"):
        raise ValueError(
            f"Unsupported mode '{canonical}'. Allowed: {', '.join(sorted(set(_CANONICAL_NAMES.values())))}"
        )

    if hasattr(mav_bridge, "set_mode"):
        mav_bridge.set_mode(canonical)
    else:
        custom_mode = _FLIGHT_MODE_MAP[canonical]
        # MAV_CMD_DO_SET_MODE = 176
        # param1 = base_mode (1 = custom mode enabled, usually OK here)
        mav_bridge.send_command_long(176, 1, custom_mode, 0, 0, 0, 0, 0)

def _normalize_mode_name(s: str) -> str:
    key = (s or "").strip().lower().replace("_", "").replace("-", " ")
    key = key.replace("  ", " ")
    if s.upper() in _FLIGHT_MODE_MAP:
        return s.upper()
    if key in _CANONICAL_NAMES:
        return _CANONICAL_NAMES[key]
    return s.upper()

@bp.post("/flight_mode")
def set_flight_mode():
    ok, resp = _ensure_connected()
    if not ok: return resp

    data = request.get_json(silent=True) or {}
    raw = data.get("mode") or ""
    canonical = _normalize_mode_name(raw)

    try:
        _set_mode_internal(canonical)
    except ValueError as ve:
        return jsonify(ok=False, error=str(ve)), 400
    except Exception as e:
        return jsonify(ok=False, error=f"set flight mode failed: {e}"), 500
    return jsonify(ok=True, mode=canonical)

# ---------------- Mission API ----------------

@bp.get("/mission/download")
def mission_download():
    ok, resp = _ensure_connected()
    if not ok: return resp
    try:
        items = mav_bridge.mission_download()
        return jsonify(ok=True, count=len(items), items=items)
    except Exception as e:
        return jsonify(ok=False, error=f"download failed: {e}"), 500

@bp.post("/mission/upload")
def mission_upload():
    ok, resp = _ensure_connected()
    if not ok: return resp
    data = request.get_json(silent=True) or {}
    waypoints = data.get("waypoints") or data.get("items") or []
    if not isinstance(waypoints, list) or not waypoints:
        return jsonify(ok=False, error="Body must include non-empty 'waypoints' array"), 400
    try:
        mav_bridge.mission_upload(waypoints)
        return jsonify(ok=True, count=len(waypoints))
    except Exception as e:
        return jsonify(ok=False, error=f"upload failed: {e}"), 500

@bp.post("/mission/clear")
def mission_clear():
    ok, resp = _ensure_connected()
    if not ok: return resp
    try:
        mav_bridge.mission_clear()
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(ok=False, error=f"clear failed: {e}"), 500

@bp.post("/mission/auto")
def mission_auto():
    ok, resp = _ensure_connected()
    if not ok: return resp
    try:
        mav_bridge.set_mode_auto()
        return jsonify(ok=True, mode="AUTO")
    except Exception as e:
        return jsonify(ok=False, error=f"set mode AUTO failed: {e}"), 500

@bp.post("/mission/start")
def mission_start():
    ok, resp = _ensure_connected()
    if not ok: return resp
    try:
        mav_bridge.mission_start()
        return jsonify(ok=True, action="mission_start")
    except Exception as e:
        return jsonify(ok=False, error=f"mission start failed: {e}"), 500
