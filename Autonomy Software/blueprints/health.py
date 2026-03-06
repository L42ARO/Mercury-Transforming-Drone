# blueprints/health.py
import ActuationBoard as AB
from flask import Blueprint, jsonify
import camera
from serial_worker import worker

bp = Blueprint("health", __name__)

@bp.get("/health")
def health():
    is_open = bool(getattr(AB, "ser", None) and AB.ser.is_open)
    camera_status = camera.get_camera_status()
    return jsonify(ok=True, connected=is_open, camera=camera_status)

@bp.get("/status")
def status():
    is_open = bool(getattr(AB, "ser", None) and AB.ser.is_open)
    camera_status = camera.get_camera_status()
    return jsonify(ok=is_open, connected=is_open, camera=camera_status)

@bp.post("/connect")
def connect():
    ok = worker.call("Connect", timeout=3.0)
    is_open = bool(getattr(AB, "ser", None) and AB.ser.is_open)
    return jsonify(ok=ok, connected=is_open)
