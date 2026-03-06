# app.py
import os

# --- Enable eventlet WebSocket support early ---
try:
    import eventlet
    eventlet.monkey_patch()
except Exception:
    pass

from flask import Flask
from extensions import socketio, cors
from serial_worker import worker
from mavlink_bridge import mav_bridge

# Blueprints
from blueprints.health import bp as health_bp
from blueprints.control import bp as control_bp
from blueprints.camera_routes import bp as camera_bp
from blueprints.pages import bp as pages_bp   # ⬅️ NEW
from blueprints.tof_routes import bp as tof_bp
from blueprints.thermal_routes import bp as thermal_bp

# Socket.IO namespaces
from ws.control import ControlNamespace
from ws.telemetry import TelemetryNamespace  # ⬅️ NEW

USE_WS_CAMERA = os.getenv("USE_WS_CAMERA", "0") == "1"
if USE_WS_CAMERA:
    from ws.camera import CameraNamespace  # optional

def create_app():
    app = Flask(__name__)

    # CORS
    allow_origin = os.getenv("ALLOW_ORIGIN", "*")
    cors.init_app(app, resources={r"/*": {"origins": allow_origin}})

    # Blueprints
    app.register_blueprint(health_bp)                 # /health, /status, /connect
    app.register_blueprint(control_bp)                # /mode, /drive, /stop, /lock, /unlock, /arm, /disarm, /takeoff, /land, /flight_mode
    app.register_blueprint(camera_bp, url_prefix="")  # /camera/*
    app.register_blueprint(pages_bp)  # ⬅️ NEW
    app.register_blueprint(tof_bp)
    app.register_blueprint(thermal_bp)


    # Flask-SocketIO with eventlet
    socketio.init_app(
        app,
        cors_allowed_origins=allow_origin,
        async_mode="eventlet",
    )

    # Namespaces
    socketio.on_namespace(ControlNamespace("/"))
    socketio.on_namespace(TelemetryNamespace("/telemetry"))  # ⬅️ NEW
    if USE_WS_CAMERA:
        socketio.on_namespace(CameraNamespace("/camera"))

    return app


if __name__ == "__main__":
    # Start the single serial worker thread (one owner of the serial port)
    if not worker.is_alive():
        worker.start()

    mav_bridge.connect()
    mav_bridge.start()

    app = create_app()
    socketio.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
