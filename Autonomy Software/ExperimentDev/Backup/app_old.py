# Main Flask app entrypoint (modularized)

import json
import time
from drone import mavutil
import sys
import signal
from flask import Flask, Response, render_template, request, jsonify, stream_with_context
from drone import (
	master, state_lock, state, set_drone_mode, _set_mission_status, _haversine_m, _ensure_guided, _arm_if_needed, _takeoff_to, _goto, _hover, _land_and_wait, _guided_land_at, _waitfor, _set_wpnav_speed, _do_change_speed, DEFAULT_SPEED_MPS, Task, MissionRunner, _mission_runner
)
app = Flask(__name__)
from ui_state import ui_state, ui_lock, _ui_update, ui_action
from camera import cap, _start_recording_internal, _stop_recording_internal, video_feed_generator
import camera

@app.route('/start_stream', methods=['POST'])
def start_stream():
	if cap is None:
		return jsonify(ok=False, msg="No camera available"), 503
	camera.streaming_on = True
	return jsonify(ok=True, msg="Streaming started")

@app.route('/stop_stream', methods=['POST'])
def stop_stream():
	camera.streaming_on = False
	return jsonify(ok=True, msg="Streaming stopped")

@app.route('/start_recording', methods=['POST'])
def start_recording():
	ok, msg = _start_recording_internal()
	return jsonify(ok=ok, msg=msg)

@app.route('/stop_recording', methods=['POST'])
def stop_recording():
	ok, saved = _stop_recording_internal()
	return jsonify(ok=ok, saved=saved)

@app.route('/sr_status')
def sr_status():
	return jsonify(streaming=bool(camera.streaming_on), recording=bool(camera.recording_on))

@app.route('/video_feed')
def video_feed():
	if not camera.streaming_on or camera.cap is None:
		return Response(status=503)
	gen = video_feed_generator()
	return Response(gen(), mimetype='multipart/x-mixed-replace; boundary=frame',
					headers={"Cache-Control":"no-cache, no-store, must-revalidate","Pragma":"no-cache"})


# ================= Drone endpoints =================
@app.route('/set_mode', methods=['POST'])
def handle_set_mode():
	try:
		mode = request.json.get('mode')
		set_drone_mode(mode)
		return jsonify({'status': 'ok'})
	except Exception as e:
		return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/arm_disarm', methods=['POST'])
def handle_arm_disarm():
	try:
		with state_lock:
			armed_now = state["armed"]
		if not armed_now:
			try:
				set_drone_mode("GUIDED")
			except Exception as e:
				return jsonify({'status':'error','message': f'Failed to set GUIDED: {e}'}), 400
		# Toggle arm state
		arm_value = 0 if armed_now else 1
		master.mav.command_long_send(
			master.target_system, master.target_component,
			mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0, arm_value,0,0,0,0,0,0
		)
		return jsonify({'status':'ok','armed': not armed_now})
	except Exception as e:
		return jsonify({'status':'error','message':str(e)}), 500

@app.route('/takeoff', methods=['POST'])
def handle_takeoff():
	try:
		data = request.get_json()
		altitude = max(1.0, float(data.get('altitude', 5)))  # min 1 m
		set_drone_mode("GUIDED")
		master.mav.command_long_send(
			master.target_system, master.target_component,
			mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0, 1,0,0,0,0,0,0
		)
		master.mav.command_long_send(
			master.target_system, master.target_component,
			mavutil.mavlink.MAV_CMD_NAV_TAKEOFF, 0,0,0,0,0,0,0,altitude
		)
		return jsonify({'status':'ok','altitude':altitude})
	except Exception as e:
		return jsonify({'status':'error','message':str(e)}), 500

@app.route('/telemetry', methods=['GET'])
def telemetry():
	with state_lock:
		if None in (state["lat"], state["lon"], state["alt"]):
			return jsonify({"error": "No telemetry yet"}), 204
		response = {
			"lat": state["lat"], "lon": state["lon"],
			"alt": round(state["alt"], 2)
		}
		if state["yaw"] is not None:
			response["yaw"] = round(state["yaw"], 1)
		if state["pitch"] is not None:
			response["pitch"] = round(state["pitch"], 1)
		if state["roll"] is not None:
			response["roll"] = round(state["roll"], 1)
		return jsonify(response)

@app.route('/arm_status', methods=['GET'])
def arm_status():
	with state_lock:
		return jsonify({'armed': bool(state["armed"])})

@app.route('/mode_status', methods=['GET'])
def mode_status():
	with state_lock:
		return jsonify({"mode": state["mode"]})

# ================ Mission endpoints ================
@app.route('/mission/upload', methods=['POST'])
def mission_upload():
	try:
		data = request.get_json(force=True) or {}
		alt = float(data.get("altitude", 5))
		if not (1 <= alt <= 10):
			return jsonify(status="error", message="Altitude must be 1..10 m"), 400
		steps = data.get("steps") or []
		if not isinstance(steps, list) or not steps:
			return jsonify(status="error", message="No mission steps"), 400
		speed_mps = float(data.get("speed", DEFAULT_SPEED_MPS))
		try:
			_set_wpnav_speed(speed_mps)
			_do_change_speed(speed_mps)
		except Exception as se:
			print(f"[WARN] Failed to set speed: {se}")
		if _mission_runner.thread and _mission_runner.thread.is_alive():
			_mission_runner.request_stop(None)
			_mission_runner.thread.join(timeout=2.5)
		_mission_runner.start(steps, alt)
		def mut(s):
			s["mp"]["steps"] = steps
			s["mp"]["alt"] = alt
		_ui_update(mut, by="server")
		return jsonify(status="ok")
	except Exception as e:
		return jsonify(status="error", message=str(e)), 500

@app.route('/mission/stop', methods=['POST'])
def mission_stop():
	_mission_runner.request_stop(None)
	return jsonify(status="ok")

@app.route('/mission/stop_land', methods=['POST'])
def mission_stop_land():
	try:
		_mission_runner.request_stop(None)
		set_drone_mode("LAND")
		return jsonify(status="ok")
	except Exception as e:
		return jsonify(status="error", message=str(e)), 500

@app.route('/mission/stop_rtl', methods=['POST'])
def mission_stop_rtl():
	try:
		_mission_runner.request_stop(None)
		set_drone_mode("RTL")
		return jsonify(status="ok")
	except Exception as e:
		return jsonify(status="error", message=str(e)), 500

@app.route('/mission/clear', methods=['POST'])
def mission_clear():
	_mission_runner.request_stop(None)
	_set_mission_status(running=False, step_index=-1, total=0, current=None, error=None)
	return jsonify(status="ok")

@app.route('/mission/status')
def mission_status():
	with state_lock:
		return jsonify(state.get("mission", {}))

# ================ Drive Mode endpoints ================
@app.route('/drive/cmd', methods=['POST'])
def drive_cmd():
	"""
	Enhanced drive command with speed control for ESP32S3 servo steering
	Body: {"cmd": "F|B|L|R|S|T", "speed": 50}  (speed 0-100%)
	"""
	from drive import ser, ser_lock
	if ser is None:
		return jsonify(ok=False, err="serial unavailable"), 503
	try:
		data = request.get_json(force=True) or {}
		cmd = (data.get("cmd") or "S").strip().upper()
		speed = max(0, min(100, int(data.get("speed", 50))))  # Clamp speed 0-100%
		
		if cmd not in ("F", "B", "L", "R", "S", "T"):
			return jsonify(ok=False, err="bad cmd"), 400
		
		# Format command with speed: "F50" = Forward at 50% speed
		if cmd in ("F", "B", "L", "R"):
			command_str = f"{cmd}{speed:02d}"  # e.g., "F50", "L25", "R75"
		else:
			command_str = cmd  # S and T don't need speed
		
		with ser_lock:
			ser.write(command_str.encode("ascii"))
			ser.flush()
		
		print(f"[Drive] Sent command: {command_str}")
		return jsonify(ok=True, command=command_str, speed=speed)
	except Exception as e:
		return jsonify(ok=False, err=str(e)), 500

@app.route('/drive/status', methods=['GET'])
def drive_status():
	"""
	Get current drive system status
	"""
	from drive import ser
	return jsonify({
		"connected": ser is not None and ser.is_open if ser else False,
		"port": getattr(ser, 'port', None) if ser else None
	})

@app.route('/drive/enter', methods=['POST'])
def drive_enter():
	"""
	Ensure drone is stopping/landing before driving.
	"""
	try:
		_mission_runner.request_stop(None)
		set_drone_mode("LAND")
		return jsonify(status="ok")
	except Exception as e:
		try:
			set_drone_mode("LAND")
		except Exception:
			pass
		return jsonify(status="error", message=str(e)), 500

# ================ SSE: telemetry + mission ================
@app.route('/events')
def events():
	def gen():
		while True:
			with state_lock:
				payload = {
					"mode": state["mode"],
					"armed": state["armed"],
					"lat": state["lat"], "lon": state["lon"],
					"alt": state["alt"], "yaw": state["yaw"],
					"ts": state["last_hb"],
					"mission": state.get("mission", {})
				}
			with ui_lock:
				payload["ui"] = dict(ui_state)
			yield f"data: {json.dumps(payload)}\n\n"
			time.sleep(0.1)
	headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
	return Response(stream_with_context(gen()), mimetype='text/event-stream', headers=headers)

# ================ UI ================
@app.route('/')
def index():
	return render_template('index.html', app_title="Mission Controller")

# ================ Run Server & shutdown ================
def shutdown_handler(*_):
	global stopping, recording_on, writer
	stopping = True
	try:
		if recording_on and writer is not None:
			writer.release()
	except: pass
	try:
		if cap: cap.release()
	except: pass
	try:
		from drive import ser
		if ser and ser.is_open:
			ser.close()
	except: pass
	sys.exit(0)

signal.signal(signal.SIGINT, shutdown_handler)
signal.signal(signal.SIGTERM, shutdown_handler)

if __name__ == '__main__':
	try:
		app.run(host='0.0.0.0', port=8080, threaded=True)
	finally:
		try:
			if cap: cap.release()
		except: pass
		try:
			from drive import ser
			if ser and ser.is_open:
				ser.close()
		except: pass
