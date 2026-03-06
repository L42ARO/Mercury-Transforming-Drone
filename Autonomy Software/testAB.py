# test_actuation.py
import time
import datetime as dt
import sys

import ActuationBoard as AB  # uses your existing file

DWELL_SEC = 10          # time to hold each command
SPEED = 40              # % for forward/back (0..100)
TURN_SPEED = 40         # % each side for pivot (mix)

def ts():
    return dt.datetime.now().strftime("%H:%M:%S")

def log(msg):
    print(f"[{ts()}] {msg}", flush=True)

def do(label, fn, *args, dwell=DWELL_SEC):
    log(f">>> {label} ...")
    ok = False
    try:
        ok = fn(*args)
    except Exception as e:
        log(f"ERROR during '{label}': {e}")
    log(f"<<< {label} -> {'OK' if ok else 'FAILED'}")
    if dwell > 0:
        time.sleep(dwell)
    return ok

def main():
    log(f"Using serial port {getattr(AB, 'PORT', 'UNKNOWN')} @ {getattr(AB, 'BAUD', 'UNKNOWN')}")

    # Connect
    if not do("Connect", AB.Connect, dwell=0):
        log("Could not open serial. Check /dev/ttyAMA1, wiring, and user in 'dialout' group.")
        sys.exit(1)

    try:
        # Quick status ping
        do("QueryStatus", AB.QueryStatus, dwell=0)

        # Set CAR mode (AB.ChangeToCarMode already sleeps ~10s internally)
        do("ChangeToCarMode", AB.ChangeToCarMode, dwell=0)

        # Forward
        do(f"DriveForward({SPEED}%)", AB.DriveForward, SPEED)

        # Stop
        do("StopAll", AB.StopAll)

        # Backward
        do(f"DriveBackward({SPEED}%)", AB.DriveBackward, SPEED)

        # Stop
        do("StopAll", AB.StopAll)

        # Pivot LEFT in place (mix: left negative, right positive)
        do(f"DriveMixed(-{TURN_SPEED}, {TURN_SPEED})", AB.DriveMixed, -TURN_SPEED, TURN_SPEED)

        # Stop
        do("StopAll", AB.StopAll)

        # Pivot RIGHT in place
        do(f"DriveMixed({TURN_SPEED}, -{TURN_SPEED})", AB.DriveMixed, TURN_SPEED, -TURN_SPEED)

        # Final Stop
        do("StopAll", AB.StopAll)

        # Final status
        do("QueryStatus", AB.QueryStatus, dwell=0)

    except KeyboardInterrupt:
        log("Interrupted by user.")
    finally:
        # Safety stop on exit
        try:
            AB.StopAll()
        except Exception:
            pass
        log("Test sequence complete. Motors should be stopped.")

if __name__ == "__main__":
    main()
