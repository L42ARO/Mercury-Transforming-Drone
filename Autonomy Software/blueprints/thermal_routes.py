# blueprints/thermal_routes.py
from flask import Blueprint, jsonify, Response
import threading
import thermal_cam  # Importing the new module

bp = Blueprint("thermal", __name__)

@bp.post("/thermal/start")
def start_thermal():
    ok = thermal_cam.start_camera()
    status = thermal_cam.get_status()
    return jsonify(ok=ok, **status)

@bp.post("/thermal/stop")
def stop_thermal():
    # Teardown in background to prevent blocking request
    def _bg():
        try: thermal_cam.stop_camera()
        except Exception: pass
    threading.Thread(target=_bg, daemon=True).start()
    return jsonify(ok=True)

@bp.get("/thermal/status")
def thermal_status():
    status = thermal_cam.get_status()
    return jsonify(ok=True, **status)

@bp.get("/thermal/feed")
def thermal_feed():
    return Response(
        thermal_cam.video_feed_generator(),
        mimetype='multipart/x-mixed-replace; boundary=frame',
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    )

@bp.get("/thermal/frame")
def thermal_frame():
    frame_bytes = thermal_cam.thermal_manager.get_frame()
    return Response(frame_bytes, mimetype='image/jpeg')

@bp.post("/thermal/record/start")
def record_start():
    ok = thermal_cam.start_recording()
    return jsonify(ok=ok, recording=thermal_cam.thermal_manager.recorder.status())

@bp.post("/thermal/record/stop")
def record_stop():
    thermal_cam.stop_recording()
    return jsonify(ok=True, recording=thermal_cam.thermal_manager.recorder.status())
