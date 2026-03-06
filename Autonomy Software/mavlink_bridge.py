# mavlink_bridge.py
import threading
import time
import math
from typing import Optional, Tuple

from pymavlink import mavutil
from extensions import socketio  # same object you init in create_app()
from mission import (
    upload_mission as _upload_mission,
    download_mission as _download_mission,
    clear_mission as _clear_mission,
    set_mode_auto as _set_mode_auto,
    mission_start as _mission_start,
)

# ---------------- MAVLink constants ----------------

MAV_CMD_SET_MESSAGE_INTERVAL = 511
MAV_CMD_DO_REBOOT_SHUTDOWN = 245
MAV_CMD_PREFLIGHT_CALIBRATION = 241
MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN = 246
MICROSECONDS_PER_SECOND = 1_000_000

MAV_COMP_ID_AUTOPILOT1 = mavutil.mavlink.MAV_COMP_ID_AUTOPILOT1

# COMMAND_ACK success
_SUCCESS_CODES = {mavutil.mavlink.MAV_RESULT_ACCEPTED, mavutil.mavlink.MAV_RESULT_IN_PROGRESS}
_SUCCESS_NAMES = {"MAV_RESULT_ACCEPTED", "MAV_RESULT_IN_PROGRESS"}


def _deg(x_rad: float) -> float:
    return float(x_rad) * 180.0 / math.pi


def _socketio_ready() -> bool:
    return getattr(socketio, "server", None) is not None


class MAVLinkBridge(threading.Thread):
    """
    Reads MAVLink over UDP, keeps a rolling telemetry snapshot, and
    periodically emits it over Socket.IO to namespace `/telemetry`.
    """

    def __init__(self, udp_addr: str = "127.0.0.1", udp_port: int = 14550, emit_hz: int = 10):
        super().__init__(daemon=True)
        self.master: Optional[mavutil.mavfile] = None
        self.udp_addr = udp_addr
        self.udp_port = udp_port
        self.running = False
        self.emit_interval = 1.0 / float(emit_hz)
        self._last_emit = 0.0

        # Rolling telemetry state
        self.state = {
            "connected": False,
            "armed": False,
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

        # Keep the latest roll/pitch in radians for manual trim fallback
        self._last_roll_rad: Optional[float] = None
        self._last_pitch_rad: Optional[float] = None

    # ---------------- Connection & setup ----------------

    def _set_interval(self, msg_id: int, rate_hz: float):
        interval_us = int(MICROSECONDS_PER_SECOND / max(0.001, rate_hz))
        self.master.mav.command_long_send(
            self.master.target_system,
            self.master.target_component,
            MAV_CMD_SET_MESSAGE_INTERVAL,
            0, msg_id, interval_us, 0, 0, 0, 0, 0
        )

    def _request_streams(self):
        streams = [
            (mavutil.mavlink.MAVLINK_MSG_ID_ATTITUDE,            20),
            (mavutil.mavlink.MAVLINK_MSG_ID_GLOBAL_POSITION_INT, 10),
            (mavutil.mavlink.MAVLINK_MSG_ID_VFR_HUD,              5),
            (mavutil.mavlink.MAVLINK_MSG_ID_GPS_RAW_INT,          1),
            (mavutil.mavlink.MAVLINK_MSG_ID_SYS_STATUS,           1),
            (mavutil.mavlink.MAVLINK_MSG_ID_BATTERY_STATUS,       1),
            (mavutil.mavlink.MAVLINK_MSG_ID_HEARTBEAT,            1),
        ]
        for msg_id, hz in streams:
            try:
                self._set_interval(msg_id, hz)
            except Exception as e:
                print(f"[MAVLinkBridge] Failed to request msg {msg_id}: {e}")

    def connect(self):
        print(f"[MAVLinkBridge] Connecting to udp:{self.udp_addr}:{self.udp_port} ...")
        self.master = mavutil.mavlink_connection(f'udp:{self.udp_addr}:{self.udp_port}')
        self.master.wait_heartbeat(timeout=30)
        self.state["connected"] = True
        print(f"[MAVLinkBridge] Connected (sysid={self.master.target_system}, compid={self.master.target_component})")
        self._request_streams()

        # Optional: wait a bit to let Socket.IO init if app boot races
        for _ in range(100):
            if _socketio_ready():
                break
            time.sleep(0.05)

        self.running = True

    def stop(self, join_timeout: float = 1.0):
        self.running = False
        if self.master:
            try:
                self.master.close()
            except Exception:
                pass
        if self.is_alive():
            self.join(timeout=join_timeout)
        self.state["connected"] = False
        print("[MAVLinkBridge] Stopped")

    # ---------------- Internal helpers ----------------

    def _maybe_emit(self):
        if not _socketio_ready():
            return
        now = time.monotonic()
        if (now - self._last_emit) >= self.emit_interval:
            socketio.emit("telemetry", self.state, namespace="/telemetry")
            self._last_emit = now

    def _decode_mode(self, hb):
        try:
            if hb.type == mavutil.mavlink.MAV_TYPE_QUADROTOR:
                _ = mavutil.mode_mapping_acm
            elif hb.type in (mavutil.mavlink.MAV_TYPE_FIXED_WING,):
                _ = mavutil.mode_mapping_apm
            else:
                _ = mavutil.mode_mapping_ardurover

            mode = mavutil.mode_string_v10(hb)
            self.state["vehicle_type"] = int(hb.type)
            self.state["mode"] = mode

            # Armed bit
            armed_flag = (hb.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED) != 0
            self.state["armed"] = bool(armed_flag)
        except Exception:
            self.state["mode"] = None
            self.state["armed"] = False

    # ---------------- Main loop ----------------

    def run(self):
        print("[MAVLinkBridge] Listening for MAVLink messages...")
        while self.running:
            msg = self.master.recv_match(blocking=False)
            if msg is None:
                time.sleep(0.01)
                self._maybe_emit()
                continue

            mtype = msg.get_type()

            if mtype == "HEARTBEAT":
                self._decode_mode(msg)

            elif mtype == "ATTITUDE":
                # Save both telemetry snapshot (deg) and raw radians for trims
                self.state["timestamp"] = int(getattr(msg, "time_boot_ms", 0))
                self.state["attitude"] = {
                    "roll_deg": _deg(msg.roll),
                    "pitch_deg": _deg(msg.pitch),
                    "yaw_deg": _deg(msg.yaw),
                }
                self._last_roll_rad = float(msg.roll)
                self._last_pitch_rad = float(msg.pitch)

            elif mtype == "GLOBAL_POSITION_INT":
                self.state["timestamp"] = int(getattr(msg, "time_boot_ms", 0))
                self.state["position"]["lat"] = msg.lat / 1e7 if msg.lat else None
                self.state["position"]["lon"] = msg.lon / 1e7 if msg.lon else None
                self.state["position"]["alt_m"] = msg.alt / 1000.0
                self.state["position"]["rel_alt_m"] = msg.relative_alt / 1000.0
                self.state["vel"]["vx_ms"] = msg.vx / 100.0
                self.state["vel"]["vy_ms"] = msg.vy / 100.0
                self.state["vel"]["vz_ms"] = msg.vz / 100.0
                self.state["heading_deg"] = (msg.hdg / 100.0) if msg.hdg != 65535 else None

            elif mtype == "VFR_HUD":
                self.state["vel"]["groundspeed_ms"] = float(msg.groundspeed)

            elif mtype == "GPS_RAW_INT":
                self.state["gps_sats"] = int(getattr(msg, "satellites_visible", 0))

            elif mtype == "SYS_STATUS":
                br = int(getattr(msg, "battery_remaining", -1))
                self.state["battery_pct"] = None if br < 0 else br

            elif mtype == "BATTERY_STATUS" and self.state.get("battery_pct") is None:
                perc = int(getattr(msg, "battery_remaining", -1))
                self.state["battery_pct"] = None if perc < 0 else perc

            self._maybe_emit()

    # ---------------- Public helpers ----------------

    def send_command_long(
        self, command, param1=0, param2=0, param3=0, param4=0, param5=0, param6=0, param7=0
    ):
        if not self.master:
            print("[MAVLinkBridge] Not connected yet")
            return
        self.master.mav.command_long_send(
            self.master.target_system,
            self.master.target_component,
            command,
            0,
            param1, param2, param3, param4, param5, param6, param7,
        )
        print(f"[MAVLinkBridge] Sent command {command}")

    def wait_heartbeat(self, timeout: float = 30.0) -> bool:
        if not self.master:
            raise RuntimeError("Not connected")
        start = time.monotonic()
        while time.monotonic() - start < timeout:
            msg = self.master.recv_match(type="HEARTBEAT", blocking=True, timeout=1.0)
            if msg:
                self._decode_mode(msg)
                return True
        return False

    # --------- COMMAND_ACK helpers ---------

    def _ack_tuple(self, ack) -> Tuple[int, str]:
        try:
            code = int(getattr(ack, "result", mavutil.mavlink.MAV_RESULT_FAILED))
        except Exception:
            code = mavutil.mavlink.MAV_RESULT_FAILED
        try:
            name = mavutil.mavlink.enums["MAV_RESULT"][code].name
        except Exception:
            name = str(code)
        return code, name

    def _send_cmd_and_wait_ack(self, command: int, params: tuple, timeout: float = 2.0):
        if not self.master:
            raise RuntimeError("Not connected")
        self.master.mav.command_long_send(
            self.master.target_system,
            MAV_COMP_ID_AUTOPILOT1,
            command, 0, *params
        )
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            ack = self.master.recv_match(type="COMMAND_ACK", blocking=True, timeout=timeout)
            if not ack:
                break
            try:
                if int(getattr(ack, "command", -1)) != int(command):
                    continue
            except Exception:
                pass
            return self._ack_tuple(ack)
        return None, "TIMEOUT"

    def _ack_success(self, code: Optional[int], name: str) -> bool:
        return (code in _SUCCESS_CODES) or (name in _SUCCESS_NAMES)

    # --------- Reboot (FCU) ---------

    def reboot_autopilot(self, wait_seconds: float = 2.0, heartbeat_timeout: float = 45.0) -> bool:
        """
        Reboot the FLIGHT CONTROLLER only (not the companion Pi).
        Your firmware is currently returning DENIED/UNSUPPORTED; we try all common variants,
        and return False if the FCU disallows it (which seems to be your case).
        """
        if not self.master:
            raise RuntimeError("Not connected")

        attempts = [
            (MAV_CMD_DO_REBOOT_SHUTDOWN,         (0, 1, 0, 0, 0, 0, 0), "DO reboot p2=1"),
            (MAV_CMD_DO_REBOOT_SHUTDOWN,         (1, 0, 0, 0, 0, 0, 0), "DO reboot p1=1"),
            (MAV_CMD_DO_REBOOT_SHUTDOWN,         (1, 1, 0, 0, 0, 0, 0), "DO reboot p1=1 p2=1"),
            (MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN,  (0, 1, 0, 0, 0, 0, 0), "PREFLIGHT reboot p2=1"),
        ]

        for cmd, params, label in attempts:
            code, name = self._send_cmd_and_wait_ack(cmd, params, timeout=2.0)
            if self._ack_success(code, name):
                print(f"[MAVLinkBridge] Reboot ACK: {label} -> {name} ({code})")
                time.sleep(wait_seconds)
                ok = self.wait_heartbeat(timeout=heartbeat_timeout)
                if ok:
                    try:
                        self._request_streams()
                    except Exception as e:
                        print(f"[MAVLinkBridge] post-reboot stream request failed: {e}")
                return ok
            else:
                print(f"[MAVLinkBridge] Reboot not accepted: {label} -> {name} ({code})")

        print("[MAVLinkBridge] Reboot command rejected by FCU (DENIED/UNSUPPORTED).")
        return False

    # --------- Manual "level" fallback via PARAM_SET ---------

    def _assert_disarmed(self):
        if self.state.get("armed"):
            raise RuntimeError("Calibration requires vehicle DISARMED")

    def _param_set_and_wait(self, name: str, value: float, ptype=mavutil.mavlink.MAV_PARAM_TYPE_REAL32, timeout: float = 2.0) -> bool:
        """
        Set a parameter and wait for PARAM_VALUE echo.
        """
        if not self.master:
            raise RuntimeError("Not connected")

        # Send
        self.master.mav.param_set_send(
            self.master.target_system,
            MAV_COMP_ID_AUTOPILOT1,
            name.encode("ascii"),
            float(value),
            ptype,
        )
        # Wait echo
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            pv = self.master.recv_match(type="PARAM_VALUE", blocking=True, timeout=timeout)
            if not pv:
                break
            try:
                pid = getattr(pv, "param_id", b"")
                if isinstance(pid, (bytes, bytearray)):
                    pid = pid.decode("ascii", errors="ignore").rstrip("\x00")
                if pid != name:
                    continue
                # If we got the right param name back, consider it success
                return True
            except Exception:
                continue
        return False

    def manual_level_from_current_attitude(self) -> bool:
        """
        Fallback for stacks that don't support PREFLIGHT_CALIBRATION board-level (param7=1).
        Writes AHRS_TRIM_X/Y to cancel the current roll/pitch (expects radians).
        """
        self._assert_disarmed()
        if self._last_roll_rad is None or self._last_pitch_rad is None:
            print("[MAVLinkBridge] manual_level: no recent ATTITUDE; cannot compute trims")
            return False

        # ArduPilot AHRS_TRIM_X = roll trim [radians], AHRS_TRIM_Y = pitch trim [radians]
        # To "zero" current attitude, use negative of the measured angles.
        trim_x = -self._last_roll_rad
        trim_y = -self._last_pitch_rad

        okx = self._param_set_and_wait("AHRS_TRIM_X", trim_x)
        oky = self._param_set_and_wait("AHRS_TRIM_Y", trim_y)
        if okx and oky:
            print(f"[MAVLinkBridge] manual_level: set AHRS_TRIM_X={trim_x:.6f}, AHRS_TRIM_Y={trim_y:.6f}")
            return True
        print("[MAVLinkBridge] manual_level: PARAM_SET echo failed")
        return False

    # --------- Preflight calibration helpers ---------

    def preflight_level(self) -> bool:
        """
        Try board-level calibration; if UNSUPPORTED/DENIED, fall back to manual AHRS trims.
        """
        self._assert_disarmed()
        code, name = self._send_cmd_and_wait_ack(
            MAV_CMD_PREFLIGHT_CALIBRATION,
            (0, 0, 0, 0, 0, 0, 1),  # param7=1 => board level
            timeout=3.0
        )
        if self._ack_success(code, name):
            print("[MAVLinkBridge] Requested board-level calibration")
            return True

        print(f"[MAVLinkBridge] preflight_level rejected by FCU: {name} ({code}); trying manual trims...")
        return self.manual_level_from_current_attitude()

    def preflight_accel(self) -> bool:
        """
        Accelerometer calibration (your FCU accepts this).
        DISARMED only.
        """
        self._assert_disarmed()
        code, name = self._send_cmd_and_wait_ack(
            MAV_CMD_PREFLIGHT_CALIBRATION,
            (0, 0, 0, 0, 1, 0, 0),  # param5=1 => accel cal
            timeout=3.0
        )
        if not self._ack_success(code, name):
            print(f"[MAVLinkBridge] preflight_accel rejected: {name} ({code})")
            return False
        print("[MAVLinkBridge] Requested accelerometer calibration")
        return True

    def preflight_gyro(self) -> bool:
        """
        Gyro re-calibration (your FCU accepts this).
        DISARMED only.
        """
        self._assert_disarmed()
        code, name = self._send_cmd_and_wait_ack(
            MAV_CMD_PREFLIGHT_CALIBRATION,
            (1, 0, 0, 0, 0, 0, 0),  # param1=1 => gyro cal
            timeout=3.0
        )
        if not self._ack_success(code, name):
            print(f"[MAVLinkBridge] preflight_gyro rejected: {name} ({code})")
            return False
        print("[MAVLinkBridge] Requested gyro calibration")
        return True

    # ---------------- Snapshot & mission ----------------

    def get_snapshot(self):
        return dict(self.state)

    def mission_upload(self, waypoints):
        if not self.master:
            raise RuntimeError("Not connected")
        return _upload_mission(self.master, waypoints)

    def mission_download(self):
        if not self.master:
            raise RuntimeError("Not connected")
        return _download_mission(self.master)

    def mission_clear(self):
        if not self.master:
            raise RuntimeError("Not connected")
        return _clear_mission(self.master)

    def set_mode_auto(self):
        if not self.master:
            raise RuntimeError("Not connected")
        return _set_mode_auto(self.master)

    def mission_start(self):
        if not self.master:
            raise RuntimeError("Not connected")
        return _mission_start(self.master)


# Global singleton so you can `from mavlink_bridge import mav_bridge`
mav_bridge = MAVLinkBridge()
