# mission.py
import math
import time
from typing import Iterable, Tuple, Dict, Any, List, Union

from pymavlink import mavutil

WpInput = Union[Tuple[float, float, float], Dict[str, Any]]

DEFAULT_FRAME = mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT
MISSION_TYPE = mavutil.mavlink.MAV_MISSION_TYPE_MISSION
CMD_WAYPOINT = mavutil.mavlink.MAV_CMD_NAV_WAYPOINT
CMD_TAKEOFF = mavutil.mavlink.MAV_CMD_NAV_TAKEOFF

def _to_float(x, *, default: float = None, allow_nan: bool = True) -> float:
    if x is None:
        return default
    try:
        v = float(x)
        if not allow_nan and (math.isnan(v) or math.isinf(v)):
            return default
        return v
    except Exception:
        return default

def _to_int01(x, *, default: int = 1) -> int:
    try:
        v = int(x)
    except Exception:
        v = default
    return 1 if v else 0

def _norm_items(waypoints: Iterable[WpInput]) -> List[Dict[str, Any]]:
    """Normalize tuples/dicts into mission items. Requires lat/lon/alt."""
    items: List[Dict[str, Any]] = []
    for i, wp in enumerate(waypoints):
        if isinstance(wp, dict):
            lat = _to_float(wp.get("lat"))
            lon = _to_float(wp.get("lon"))
            alt = _to_float(wp.get("alt"))
            if lat is None or lon is None or alt is None:
                raise ValueError(f"waypoint[{i}]: lat/lon/alt must be numbers")

            cmd = int(wp.get("cmd", CMD_WAYPOINT) or CMD_WAYPOINT)
            frame = int(wp.get("frame", DEFAULT_FRAME) or DEFAULT_FRAME)

            hold_s = _to_float(wp.get("hold_s"), default=0.0, allow_nan=False)
            accept_radius_m = _to_float(wp.get("accept_radius_m"), default=2.0, allow_nan=False)
            pass_radius_m = _to_float(wp.get("pass_radius_m"), default=0.0, allow_nan=False)
            yaw_deg = _to_float(wp.get("yaw_deg", None), default=float("nan"), allow_nan=True)
            autocontinue = _to_int01(wp.get("autocontinue"), default=1)
        else:
            try:
                lat, lon, alt = wp
            except Exception:
                raise ValueError(f"waypoint[{i}]: tuple must be (lat, lon, alt)")
            lat = _to_float(lat); lon = _to_float(lon); alt = _to_float(alt)
            if lat is None or lon is None or alt is None:
                raise ValueError(f"waypoint[{i}]: lat/lon/alt must be numbers")
            cmd = CMD_WAYPOINT
            frame = DEFAULT_FRAME
            hold_s, accept_radius_m, pass_radius_m = 0.0, 2.0, 0.0
            yaw_deg = float("nan")
            autocontinue = 1

        items.append({
            "seq": i,
            "lat": lat, "lon": lon, "alt": alt,
            "cmd": cmd, "frame": frame,
            "hold_s": hold_s, "accept_radius_m": accept_radius_m, "pass_radius_m": pass_radius_m,
            "yaw_deg": yaw_deg, "autocontinue": autocontinue,
        })

    if not items:
        raise ValueError("no waypoints provided")
    return items

def _shape_with_dummy_then_takeoff(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Workaround requested:
      seq 0: DUMMY WAYPOINT (copy of user first)  -> expected to be ignored
      seq 1: TAKEOFF at first lat/lon/alt
      seq 2..: user waypoints again (1st, 2nd, 3rd, ...)
    """
    if not items:
        return items

    first = items[0]
    # seq 0 dummy (copy of first)
    seq0 = {
        "seq": 0,
        "lat": first["lat"], "lon": first["lon"], "alt": first["alt"],
        "cmd": CMD_WAYPOINT,
        "frame": first.get("frame", DEFAULT_FRAME),
        "hold_s": 0.0, "accept_radius_m": 2.0, "pass_radius_m": 0.0,
        "yaw_deg": float("nan"), "autocontinue": 1,
    }
    # seq 1 takeoff
    takeoff_alt = first["alt"] if first["alt"] and first["alt"] > 0 else 10.0
    seq1 = {
        "seq": 1,
        "lat": first["lat"], "lon": first["lon"], "alt": takeoff_alt,
        "cmd": CMD_TAKEOFF,
        "frame": first.get("frame", DEFAULT_FRAME),
        "hold_s": 0.0, "accept_radius_m": 0.0, "pass_radius_m": 0.0,
        "yaw_deg": float("nan"), "autocontinue": 1,
    }
    # user items repeated from the beginning (the original first again)
    rest = []
    for it in items:
        rest.append({
            **it,
            # we'll resequence below
        })

    shaped = [seq0, seq1] + rest
    # resequence
    for i, it in enumerate(shaped):
        it["seq"] = i
    try:
        print(f"[mission] shaped mission: inserted dummy-WP@0 and TAKEOFF@1; user WPs start at 2")
    except Exception:
        pass
    return shaped

def clear_mission(master) -> None:
    master.mav.mission_clear_all_send(
        master.target_system, master.target_component, MISSION_TYPE
    )
    time.sleep(0.2)

def upload_mission(master, waypoints: Iterable[WpInput], *, timeout_s: float = 20.0) -> None:
    items = _norm_items(waypoints)
    items = _shape_with_dummy_then_takeoff(items)  # <--- apply workaround

    # announce count
    clear_mission(master)
    count = len(items)
    master.mav.mission_count_send(
        master.target_system, master.target_component, count, MISSION_TYPE
    )
    print(f"[mission] announced count={count}")

    start = time.time()
    sent: set[int] = set()

    while True:
        if (time.time() - start) > timeout_s:
            raise TimeoutError("mission upload timed out")

        msg = master.recv_match(
            type=["MISSION_REQUEST_INT", "MISSION_REQUEST", "MISSION_ACK"],
            blocking=True,
            timeout=1.0
        )
        if msg is None:
            continue

        t = msg.get_type()

        if t == "MISSION_ACK":
            # Start index should be TAKEOFF at 1
            try:
                idx = 1 if count > 1 else 0
                master.mav.mission_set_current_send(master.target_system, master.target_component, idx)
                print(f"[mission] MISSION_ACK; set current seq={idx}")
            except Exception as _e:
                print(f"[mission] set_current failed (non-fatal): {_e}")
            return

        if t in ("MISSION_REQUEST_INT", "MISSION_REQUEST"):
            seq = int(msg.seq)
            print(f"[mission] vehicle requested seq={seq}")
            if seq < 0 or seq >= count:
                raise ValueError(f"vehicle requested invalid seq {seq} (count={count})")
            if seq in sent:
                continue

            wp = items[seq]
            p1 = wp["hold_s"]; p2 = wp["accept_radius_m"]; p3 = wp["pass_radius_m"]; p4 = wp["yaw_deg"]
            frame = wp["frame"]; cmd = wp["cmd"]
            cur = 0  # per spec during upload
            auto = wp["autocontinue"]

            try:
                print(f"[mission] sending seq={seq} cmd={cmd} frame={frame} "
                      f"lat={wp['lat']:.7f} lon={wp['lon']:.7f} alt={wp['alt']}")
            except Exception:
                pass

            if t == "MISSION_REQUEST_INT":
                master.mav.mission_item_int_send(
                    master.target_system, master.target_component,
                    seq, frame, cmd, cur, auto,
                    p1, p2, p3, p4,
                    int(round(wp["lat"] * 1e7)),
                    int(round(wp["lon"] * 1e7)),
                    float(wp["alt"]), MISSION_TYPE
                )
            else:
                master.mav.mission_item_send(
                    master.target_system, master.target_component,
                    seq, frame, cmd, cur, auto,
                    p1, p2, p3, p4,
                    float(wp["lat"]), float(wp["lon"]), float(wp["alt"])
                )
            sent.add(seq)

def download_mission(master, *, timeout_s: float = 20.0) -> List[Dict[str, Any]]:
    master.mav.mission_request_list_send(
        master.target_system, master.target_component, MISSION_TYPE
    )
    start = time.time()
    count = None
    items: List[Dict[str, Any]] = []

    while (time.time() - start) < timeout_s:
        msg = master.recv_match(
            type=["MISSION_COUNT", "MISSION_ITEM_INT", "MISSION_ITEM", "MISSION_ACK"],
            blocking=True,
            timeout=1.0
        )
        if msg is None:
            continue

        t = msg.get_type()

        if t == "MISSION_COUNT":
            count = int(msg.count)
            print(f"[mission] download count={count}")
            master.mav.mission_request_int_send(
                master.target_system, master.target_component, 0, MISSION_TYPE
            )

        elif t in ("MISSION_ITEM_INT", "MISSION_ITEM"):
            if t == "MISSION_ITEM_INT":
                seq = int(msg.seq)
                lat = float(msg.x) / 1e7; lon = float(msg.y) / 1e7; alt = float(msg.z)
            else:
                seq = int(msg.seq)
                lat = float(msg.x); lon = float(msg.y); alt = float(msg.z)

            frame = int(msg.frame); cmd = int(msg.command)
            p1, p2, p3, p4 = (float(msg.param1), float(msg.param2), float(msg.param3), float(msg.param4))
            autocontinue = int(getattr(msg, "autocontinue", 1))

            while len(items) <= seq: items.append({})
            items[seq] = {
                "seq": seq, "lat": lat, "lon": lon, "alt": alt,
                "frame": frame, "cmd": cmd,
                "hold_s": p1, "accept_radius_m": p2, "pass_radius_m": p3, "yaw_deg": p4,
                "autocontinue": autocontinue,
            }

            next_seq = seq + 1
            if count is not None and next_seq < count:
                master.mav.mission_request_int_send(
                    master.target_system, master.target_component, next_seq, MISSION_TYPE
                )
            elif count is not None and next_seq == count:
                master.mav.mission_ack_send(
                    master.target_system, master.target_component,
                    mavutil.mavlink.MAV_MISSION_ACCEPTED, MISSION_TYPE
                )
                return [wp for wp in items if wp]

        elif t == "MISSION_ACK":
            return [wp for wp in items if wp]

    raise TimeoutError("mission download timed out")

def set_mode_auto(master) -> None:
    master.set_mode_auto()

def mission_start(master) -> None:
    master.mav.command_long_send(
        master.target_system, master.target_component,
        mavutil.mavlink.MAV_CMD_MISSION_START,
        0, 0, 0, 0, 0, 0, 0, 0
    )
