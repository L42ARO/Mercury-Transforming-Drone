# blueprints/tof_routes.py
from flask import Blueprint, jsonify, Response, request
import threading
import tof_camera

bp = Blueprint("tof_camera", __name__)

@bp.post("/tof_camera/start")
def start_tof_camera():
    ok = tof_camera.start_camera()
    status = tof_camera.get_camera_status()
    return jsonify(ok=ok, **status)

@bp.post("/tof_camera/stop")
def stop_tof_camera():
    # Return immediately; perform teardown in background to avoid request timeout.
    def _bg():
        try:
            tof_camera.stop_camera()
        except Exception:
            pass # Log this if necessary, but don't fail the request
    threading.Thread(target=_bg, daemon=True).start()
    status = tof_camera.get_camera_status()
    return jsonify(ok=True, **status)

@bp.get("/tof_camera/status")
def tof_camera_status():
    status = tof_camera.get_camera_status()
    return jsonify(ok=True, **status)

@bp.get("/tof_camera/feed")
def tof_video_feed():
    # Read confidence_threshold from query parameters, defaulting to DEFAULT_CONFIDENCE.
    try:
        confidence_threshold = int(request.args.get("confidence", tof_camera.DEFAULT_CONFIDENCE))
    except ValueError:
        confidence_threshold = tof_camera.DEFAULT_CONFIDENCE # Default if conversion fails
    
    return Response(
        tof_camera.video_feed_generator(confidence_threshold),
        mimetype='multipart/x-mixed-replace; boundary=frame',
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    )

@bp.get("/tof_camera/frame")
def get_tof_frame():
    # This endpoint gets a single frame using the current default_confidence
    frame_bytes = tof_camera.tof_camera_manager.get_frame(None) 
    return Response(frame_bytes, mimetype='image/jpeg')

@bp.post("/tof_camera/confidence/<int:value>")
def set_default_confidence(value):
    if 0 <= value <= 255:
        tof_camera.tof_camera_manager.default_confidence = value
        return jsonify(ok=True, confidence=value)
    return jsonify(ok=False, error="Confidence value must be between 0 and 255."), 400


# --- Recording Routes ---
@bp.post("/tof_camera/record/start")
def record_start():
    ok = tof_camera.start_recording()
    return jsonify(ok=ok, recording=tof_camera.get_recording_status())

@bp.post("/tof_camera/record/stop")
def record_stop():
    tof_camera.stop_recording()
    return jsonify(ok=True, recording=tof_camera.get_recording_status())

@bp.get("/tof_camera/record/status")
def record_status():
    return jsonify(ok=True, recording=tof_camera.get_recording_status())