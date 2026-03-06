# ActuationBoard.py
# Host-side driver for ESP32 Serial1API protocol.
# Requests (host->device):  AA 55 <LEN=CMD+payload> <CMD> [PAYLOAD...] <CHK>
# Responses (device->host): AA 55 <LEN=payload>     <RSP> [PAYLOAD...] <CHK>
# CHK is XOR of bytes from LEN through last payload byte.

import serial
import struct
import time
from typing import Optional, Tuple

# === SERIAL CONFIG ===
PORT = '/dev/ttyAMA1'
BAUD = 115200
TIMEOUT = 0.5
ser: Optional[serial.Serial] = None

# Toggle for ad-hoc debugging
DEBUG_RAW = False  # set True to print raw frames

# === COMMANDS (host -> device) ===
MODE_SET   = 0x01
STOP_ALL   = 0x02
DRIVE_F    = 0x03
DRIVE_B    = 0x04
DRIVE_MIX  = 0x07
STATUS_Q   = 0x0A
LOCK       = 0x40  # optional payload: uint16 LE hold_ms
UNLOCK     = 0x41

# === RESPONSES (device -> host) ===
RSP_ACK    = 0x80
RSP_ERR    = 0x81
RSP_STATUS = 0x82

# === INTERNAL HELPERS ===

def _make_frame(cmd: int, payload: bytes = b'') -> bytes:
    """
    Build a request frame. For requests, firmware expects LEN = CMD + payload.
    """
    length = len(payload) + 1  # includes CMD
    body = bytes([length, cmd]) + payload
    chk = 0
    for b in body:
        chk ^= b
    return b'\xAA\x55' + body + bytes([chk])

def _read_response(max_wait: float = 0.6) -> Tuple[Optional[int], bytes]:
    """
    Read exactly one response frame:
      AA 55 LEN RSP [PAYLOAD-bytes = LEN] CHK
    Returns (rsp_code, payload_bytes) or (None, b'') on timeout/bad frame.
    """
    global ser
    if ser is None or not ser.is_open:
        return (None, b'')

    deadline = time.time() + max_wait
    buf = bytearray()

    while time.time() < deadline:
        chunk = ser.read(64)
        if chunk:
            buf.extend(chunk)

            start = buf.find(b'\xAA\x55')
            if start == -1:
                # keep accumulating
                continue

            # Need header + LEN + CMD at minimum
            if len(buf) < start + 4:
                continue

            ln = buf[start + 2]               # payload length (RESPONSES ONLY)
            # total bytes = hdr(2) + LEN(1) + CMD(1) + payload(ln) + CHK(1)
            total_len = 2 + 1 + 1 + ln + 1
            if len(buf) < start + total_len:
                continue  # wait for the rest

            frame = bytes(buf[start : start + total_len])

            if DEBUG_RAW:
                try:
                    import binascii
                    print("RAW<-", binascii.hexlify(frame))
                except Exception:
                    pass

            # Parse response frame
            ln_resp   = frame[2]              # payload length
            rsp_code  = frame[3]              # RSP byte
            payload   = frame[4 : 4 + ln_resp]
            chk_byte  = frame[4 + ln_resp]    # checksum byte

            # Verify XOR over [LEN..payload] (LEN, RSP, payload)
            x = 0
            for b in frame[2:-1]:  # from LEN to last payload byte
                x ^= b
            if x != chk_byte:
                return (None, b'')  # checksum mismatch

            return (rsp_code, payload)

        else:
            time.sleep(0.005)

    return (None, b'')

def _send(cmd: int, payload: bytes = b'', wait: float = 0.12) -> bool:
    """
    Send a command frame and return True on ACK.
    If ERR, prints error code and returns False.
    """
    global ser
    if ser is None or not ser.is_open:
        return False
    try:
        frame = _make_frame(cmd, payload)
        ser.reset_input_buffer()   # drop stale bytes
        ser.write(frame)
        ser.flush()
        time.sleep(wait)
        rsp_code, pl = _read_response()
        if rsp_code == RSP_ACK:
            return True
        if rsp_code == RSP_ERR:
            err = pl[0] if pl else 0
            # 1 E_BAD_ARG, 2 E_BAD_MODE, 3 E_NOT_IN_CAR, 4 E_UNKNOWN
            print(f"Board returned ERR code {err}")
            return False
        # STATUS_Q replies with RSP_STATUS, not ACK
        return False
    except Exception as e:
        print(f"Error in _send: {e}")
        return False

def _send_for_status(wait: float = 0.12):
    """
    Send STATUS_Q and parse RSP_STATUS payload into a dict.
    Returns dict or None on failure.
    """
    global ser
    if ser is None or not ser.is_open:
        return None
    try:
        ser.reset_input_buffer()
        ser.write(_make_frame(STATUS_Q, b''))  # request uses LEN=CMD+payload (1)
        ser.flush()
        time.sleep(wait)
        rsp_code, pl = _read_response()
        if rsp_code != RSP_STATUS or not pl:
            return None
        # Payload (6 bytes): mode u8, active u8, turn u8, dmax u16 LE, reserved u8
        if len(pl) < 6:
            return None
        mode     = pl[0]
        active   = pl[1]
        turn     = pl[2]
        dmax     = pl[3] | (pl[4] << 8)
        reserved = pl[5]
        return {
            "mode": mode,          # 0 none, 1 car, 2 drone
            "active": bool(active),
            "turn_mode": turn,     # 0 SAME_SIGN, 1 TANK
            "dmax_us": dmax,
            "reserved": reserved,
        }
    except Exception as e:
        print(f"Error in _send_for_status: {e}")
        return None

# === PUBLIC API ===

def Connect() -> bool:
    """Open serial connection. Returns True if successful."""
    global ser
    try:
        ser = serial.Serial(PORT, BAUD, timeout=TIMEOUT)
        return ser.is_open
    except Exception as e:
        print(f"Connect error: {e}")
        ser = None
        return False

def Close():
    """Close the serial port, if open."""
    global ser
    try:
        if ser and ser.is_open:
            ser.close()
    finally:
        ser = None

def ChangeToCarMode() -> bool:
    """Switch to CAR mode (1)."""
    ok = _send(MODE_SET, bytes([1]))
    if ok:
        time.sleep(10)  # allow mechanisms to settle
    return ok

def ChangeToDroneMode() -> bool:
    """Switch to DRONE mode (2)."""
    ok = _send(MODE_SET, bytes([2]))
    if ok:
        time.sleep(10)
    return ok

def DriveForward(pct: int) -> bool:
    """Drive forward (0–100)."""
    pct = max(0, min(100, int(pct)))
    return _send(DRIVE_F, bytes([pct]))

def DriveBackward(pct: int) -> bool:
    """Drive backward (0–100)."""
    pct = max(0, min(100, int(pct)))
    return _send(DRIVE_B, bytes([pct]))

def DriveMixed(left: int, right: int) -> bool:
    """Differential drive mix (-100..100 for each)."""
    left = max(-100, min(100, int(left)))
    right = max(-100, min(100, int(right)))
    payload = struct.pack('bb', left, right)  # signed bytes
    return _send(DRIVE_MIX, payload)

def StopAll() -> bool:
    """Stop all motors."""
    return _send(STOP_ALL)

def QueryStatus(parse: bool = True):
    """
    If parse=True, returns a dict from RSP_STATUS (or None on failure).
    If parse=False, returns True/False depending on receiving any status frame.
    """
    if parse:
        return _send_for_status()
    else:
        global ser
        if ser is None or not ser.is_open:
            return False
        ser.reset_input_buffer()
        ser.write(_make_frame(STATUS_Q, b''))
        ser.flush()
        time.sleep(0.12)
        rsp_code, _ = _read_response()
        return rsp_code == RSP_STATUS

def Lock(hold_ms: Optional[int] = None) -> bool:
    """
    Engage lock. Optional hold_ms (0..65535) sent little-endian.
    If hold_ms is None, send no payload (firmware uses default, typically 1000 ms).
    """
    if hold_ms is None:
        payload = b''
    else:
        hold = max(0, min(65535, int(hold_ms)))
        payload = struct.pack('<H', hold)
    return _send(LOCK, payload)

def Unlock() -> bool:
    """Release lock immediately."""
    return _send(UNLOCK)
