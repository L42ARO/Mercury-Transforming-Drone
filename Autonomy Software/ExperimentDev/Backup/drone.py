
import time
import threading
from threading import Thread, Lock, Event
from typing import NamedTuple, Dict, Any, List, Optional
from utils import haversine_m
from pymavlink import mavutil

print("Connecting to the drone via MAVLink...")
master = mavutil.mavlink_connection("udp:127.0.0.1:14550")
master.wait_heartbeat()
print("Drone connected!")

state_lock = Lock()
state = {
	"mode": "UNKNOWN",
	"armed": False,
	"lat": None, "lon": None, "alt": None,
	"yaw": None, "pitch": None, "roll": None,
	"last_hb": 0.0,
	"mission": {
		"running": False,
		"step_index": -1,
		"total": 0,
		"current": None,
		"error": None
	}
}

def _is_armed(base_mode: int) -> bool:
	return bool(base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)

def set_message_rate(msgid: int, hz: int):
	try:
		us = int(1e6 / max(1, hz))
		master.mav.command_long_send(
			master.target_system, master.target_component,
			mavutil.mavlink.MAV_CMD_SET_MESSAGE_INTERVAL, 0,
			msgid, us, 0, 0, 0, 0, 0
		)
	except Exception as e:
		print(f"[WARN] set_message_rate({msgid}, {hz}) failed: {e}")

for mid in (0, 33, 30):
	set_message_rate(mid, 10)

def mav_reader():
	while True:
		try:
			msg = master.recv_match(blocking=True, timeout=1.0)
		except Exception:
			msg = None
		if not msg:
			continue
		tname = msg.get_type()
		t = time.time()
		with state_lock:
			if tname == "HEARTBEAT":
				state["armed"] = _is_armed(msg.base_mode)
				human = mavutil.mode_string_v10(msg)
				if human and human != "UNKNOWN":
					state["mode"] = human
				state["last_hb"] = t
			elif tname == "GLOBAL_POSITION_INT":
				state["lat"] = msg.lat / 1e7
				state["lon"] = msg.lon / 1e7
				state["alt"] = msg.relative_alt / 1000.0
			elif tname == "ATTITUDE":
				yaw = msg.yaw * 180.0 / 3.14159265
				pitch = msg.pitch * 180.0 / 3.14159265
				roll = msg.roll * 180.0 / 3.14159265
				state["yaw"] = yaw + 360 if yaw < 0 else yaw
				state["pitch"] = pitch
				state["roll"] = roll

Thread(target=mav_reader, daemon=True).start()

def set_drone_mode(mode: str) -> bool:
	mapping = master.mode_mapping()
	if mode not in mapping:
		raise ValueError(f"Unknown mode: {mode}")
	custom = mapping[mode]
	master.mav.set_mode_send(
		master.target_system,
		mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
		custom
	)
	return True

def _set_mission_status(**kw):
	with state_lock:
		m = state.get("mission", {})
		m.update(kw)
		state["mission"] = m

def _haversine_m(lat1, lon1, lat2, lon2):
	return haversine_m(lat1, lon1, lat2, lon2)

def _ensure_guided():
	mapping = master.mode_mapping()
	if "GUIDED" not in mapping:
		raise RuntimeError("GUIDED mode not available")
	master.mav.set_mode_send(
		master.target_system,
		mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
		mapping["GUIDED"]
	)

def _arm_if_needed(timeout=15):
	with state_lock:
		armed = bool(state["armed"])
	if not armed:
		master.mav.command_long_send(
			master.target_system, master.target_component,
			mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0, 1,0,0,0,0,0,0
		)
		t0 = time.time()
		while time.time()-t0 < timeout:
			msg = master.recv_match(type='HEARTBEAT', blocking=True, timeout=1)
			if msg and (msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED):
				return
		raise TimeoutError("Arming timeout")

def _takeoff_to(alt):
	target = max(1.0, float(alt))
	master.mav.command_long_send(
		master.target_system, master.target_component,
		mavutil.mavlink.MAV_CMD_NAV_TAKEOFF, 0,0,0,0,0,0,0,target
	)
	def reached_alt():
		with state_lock:
			a = state["alt"]
		return (a is not None) and (a >= target - 0.2)
	if not _waitfor(reached_alt, timeout=90, poll=0.2, ok_samples=3):
		raise TimeoutError("Takeoff did not reach target altitude (+/-0.2 m)")

def _goto(lat, lon, alt, reach_m=3.0, timeout=120):
	master.mav.mission_item_send(
		master.target_system, master.target_component,
		0,
		mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT,
		mavutil.mavlink.MAV_CMD_NAV_WAYPOINT,
		2, 0, 0, 0, 0, 0,
		float(lat), float(lon), float(alt)
	)
	t0 = time.time()
	while time.time() - t0 < timeout:
		if _mission_runner.stop_event.is_set():
			return False
		with state_lock:
			cur_lat, cur_lon = state["lat"], state["lon"]
		if isinstance(cur_lat, (int, float)) and isinstance(cur_lon, (int, float)):
			if _haversine_m(cur_lat, cur_lon, lat, lon) <= reach_m:
				return True
		time.sleep(0.2)
	return False

def _hover(wait_s):
	t0 = time.time()
	while time.time()-t0 < wait_s:
		if _mission_runner.stop_event.is_set(): return False
		time.sleep(0.2)
	return True

def _land_and_wait(wait_s, timeout=180):
	try:
		set_drone_mode("LAND")
	except Exception:
		master.mav.command_long_send(
			master.target_system, master.target_component,
			mavutil.mavlink.MAV_CMD_NAV_LAND, 0,0,0,0,0,0,0,0
		)
	def on_ground_or_disarmed():
		with state_lock:
			armed = bool(state["armed"])
			alt   = state["alt"]
		return (not armed) or (isinstance(alt, (int,float)) and alt <= 0.25)
	if not _waitfor(on_ground_or_disarmed, timeout=timeout, poll=0.2, ok_samples=3):
		print("[LAND] Timeout waiting for touchdown/disarm")
	t0 = time.time()
	while time.time() - t0 < max(0, int(wait_s)):
		if _mission_runner.stop_event.is_set():
			return False
		time.sleep(0.2)
	return True

def _guided_land_at(lat, lon, timeout=180, wait_s=0):
	master.mav.mission_item_send(
		master.target_system, master.target_component,
		0,
		mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT,
		mavutil.mavlink.MAV_CMD_NAV_LAND,
		2, 0, 0, 0, 0, 0,
		float(lat), float(lon), 0.0
	)
	try: set_drone_mode("LAND")
	except Exception: pass
	return _land_and_wait(wait_s, timeout=timeout)

def _waitfor(predicate, timeout=60.0, poll=0.1, ok_samples=3):
	consec = 0
	t0 = time.time()
	while time.time() - t0 < timeout:
		if predicate():
			consec += 1
			if consec >= ok_samples:
				return True
		else:
			consec = 0
		time.sleep(poll)
	return False

def _set_wpnav_speed(speed_mps: float):
	cms = max(20, min(2000, int(speed_mps * 100)))
	master.mav.param_set_send(
		master.target_system, master.target_component,
		b'WPNAV_SPEED', float(cms), mavutil.mavlink.MAV_PARAM_TYPE_REAL32
	)
	t0 = time.time()
	while time.time() - t0 < 2.0:
		msg = master.recv_match(type='PARAM_VALUE', blocking=True, timeout=0.5)
		if not msg:
			continue
		pid = getattr(msg, 'param_id', b'')
		try:
			pid = pid.decode('ascii', 'ignore').rstrip('\x00')
		except Exception:
			pid = str(pid)
		if pid == 'WPNAV_SPEED':
			break

def _do_change_speed(speed_mps: float):
	master.mav.command_long_send(
		master.target_system, master.target_component,
		mavutil.mavlink.MAV_CMD_DO_CHANGE_SPEED, 0,
		1, float(speed_mps), 0, 0, 0, 0, 0
	)

DEFAULT_SPEED_MPS = 1.5

class Task(NamedTuple):
	kind: str
	args: Dict[str, Any]

class MissionRunner:
	def __init__(self):
		self.thread: Optional[Thread] = None
		self.lock = Lock()
		self.stop_event = Event()
		self.stop_mode: Optional[str] = None
		self.queue: List[Task] = []
		self.plan_steps: List[Dict[str, Any]] = []
		self.mission_alt: float = 5.0

	def _build_queue(self, steps: List[Dict[str, Any]], mission_alt: float) -> List[Task]:
		q: List[Task] = []
		q.append(Task("ENSURE_GUIDED", {}))
		q.append(Task("ARM_IF_NEEDED", {}))
		q.append(Task("TAKEOFF", {"alt": mission_alt}))
		n = len(steps)
		for i, s in enumerate(steps):
			lat, lon = float(s["lat"]), float(s["lon"])
			action = (s.get("action") or "hover").lower()
			wait = max(5, int(s.get("wait", 5)))
			q.append(Task("GOTO", {"lat": lat, "lon": lon, "alt": mission_alt, "i": i}))
			if action == "hover":
				q.append(Task("HOVER", {"wait": wait, "i": i}))
			else:
				q.append(Task("LAND", {"wait": wait, "i": i}))
				if i != n - 1:
					q.append(Task("ENSURE_GUIDED", {}))
					q.append(Task("ARM_IF_NEEDED", {}))
					q.append(Task("TAKEOFF", {"alt": mission_alt}))
		return q

	def start(self, steps: List[Dict[str, Any]], mission_alt: float):
		with self.lock:
			if self.thread and self.thread.is_alive():
				raise RuntimeError("Mission already running")
			for s in steps:
				s["wait"] = max(5, int(s.get("wait", 5)))
			self.plan_steps = steps[:]
			self.mission_alt = max(1.0, float(mission_alt))
			self.queue = self._build_queue(self.plan_steps, self.mission_alt)
			self.stop_event.clear()
			self.stop_mode = None
			_set_mission_status(
				running=True,
				step_index=-1,
				total=len(self.plan_steps),
				current=None,
				error=None
			)
			self.thread = Thread(target=self._run, daemon=True)
			self.thread.start()

	def request_stop(self, mode: Optional[str] = None):
		with self.lock:
			self.stop_mode = mode
			self.stop_event.set()

	def _apply_priority_stop(self):
		if not self.stop_mode:
			return
		try:
			if self.stop_mode == "LAND":
				set_drone_mode("LAND")
			elif self.stop_mode == "RTL":
				set_drone_mode("RTL")
		except Exception as e:
			print(f"[STOP] Failed to set {self.stop_mode}: {e}")

	def _run(self):
		try:
			for idx, task in enumerate(self.queue):
				if self.stop_event.is_set():
					self._apply_priority_stop()
					break
				if task.kind == "GOTO":
					i = int(task.args.get("i", -1))
					if 0 <= i < len(self.plan_steps):
						s = self.plan_steps[i]
						_set_mission_status(
							step_index=i,
							current={
								"lat": float(s["lat"]),
								"lon": float(s["lon"]),
								"action": (s.get("action") or "hover").lower(),
								"wait": int(s.get("wait", 5))
							}
						)
				if task.kind == "ENSURE_GUIDED":
					_ensure_guided()
				elif task.kind == "ARM_IF_NEEDED":
					_arm_if_needed()
				elif task.kind == "TAKEOFF":
					_takeoff_to(float(task.args["alt"]))
				elif task.kind == "GOTO":
					ok = _goto(task.args["lat"], task.args["lon"], task.args["alt"])
					if not ok:
						break
				elif task.kind == "HOVER":
					if not _hover(int(task.args["wait"])):
						break
				elif task.kind == "LAND":
					i = int(task.args.get("i", -1))
					if 0 <= i < len(self.plan_steps):
						s = self.plan_steps[i]
						_set_mission_status(step_index=i, current={
							"lat": float(s["lat"]), "lon": float(s["lon"]),
							"action": "land", "wait": int(s.get("wait", 5))
						})
					if not _land_and_wait(int(task.args["wait"])):
						break
				else:
					print(f"[WARN] Unknown task: {task.kind}")
				if self.stop_event.is_set():
					self._apply_priority_stop()
					break
			_set_mission_status(running=False)
		except Exception as e:
			_set_mission_status(running=False, error=str(e))

# single runner instance
_mission_runner = MissionRunner()

