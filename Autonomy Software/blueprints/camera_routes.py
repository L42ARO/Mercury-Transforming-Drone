# blueprints/camera_routes.py
from flask import Blueprint, jsonify, Response
import threading
import camera

bp = Blueprint("camera", __name__)

@bp.post("/camera/start")
def start_camera():
    ok = camera.start_camera()
    status = camera.get_camera_status()
    return jsonify(ok=ok, **status)

@bp.post("/camera/stop")
def stop_camera():
    # Return immediately; perform teardown in background to avoid request timeout.
    def _bg():
        try:
            camera.stop_camera()
        except Exception:
            pass
    threading.Thread(target=_bg, daemon=True).start()
    status = camera.get_camera_status()
    return jsonify(ok=True, **status)

@bp.get("/camera/status")
def camera_status():
    status = camera.get_camera_status()
    return jsonify(ok=True, **status)

@bp.get("/camera/feed")
def video_feed():
    # MJPEG (fast path). Closes when camera stops.
    return Response(
        camera.video_feed_generator(),
        mimetype='multipart/x-mixed-replace; boundary=frame',
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    )

@bp.get("/camera/frame")
def get_frame():
    frame_bytes = camera.camera_manager.get_frame()
    return Response(frame_bytes, mimetype='image/jpeg')

@bp.post("/camera/record/start")
def record_start():
    ok = camera.start_recording()
    return jsonify(ok=ok, recording=camera.get_recording_status())

@bp.post("/camera/record/stop")
def record_stop():
    camera.stop_recording()
    return jsonify(ok=True, recording=camera.get_recording_status())

@bp.get("/camera/record/status")
def record_status():
    return jsonify(ok=True, recording=camera.get_recording_status())
