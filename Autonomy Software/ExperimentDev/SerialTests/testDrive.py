import serial
import struct
import time

# === serial config ===
PORT = '/dev/ttyAMA1'     # or '/dev/serial0' depending on your Pi model
BAUD = 115200
ser = serial.Serial(PORT, BAUD, timeout=0.2)

# === helpers ===
def make_frame(cmd, payload=b''):
    """Constructs an AA55 frame."""
    length = len(payload) + 1
    body = bytes([length, cmd]) + payload
    chk = 0
    for b in body:
        chk ^= b
    return b'\xAA\x55' + body + bytes([chk])

def send(cmd, payload=b'', wait=0.0, label=None):
    """Send a frame and optionally print/debug."""
    name = label or f"CMD 0x{cmd:02X}"
    frame = make_frame(cmd, payload)
    print(f"\n➡️  Sending {name}: {frame.hex(' ')}")
    ser.write(frame)
    time.sleep(wait)
    resp = ser.read(64)
    if resp:
        print(f"⬅️  Received ({len(resp)} bytes): {resp.hex(' ')}")
    else:
        print("⬅️  No response (timeout)")
    return resp

# === commands (matches firmware spec) ===
MODE_SET  = 0x01
STOP_ALL  = 0x02
DRIVE_F   = 0x03
DRIVE_B   = 0x04
DRIVE_L   = 0x05
DRIVE_R   = 0x06
DRIVE_MIX = 0x07
TURNMODE  = 0x08
DMAX_SET  = 0x09
STATUS_Q  = 0x0A

# === demo sequence ===
print("Starting ESP32 Serial1 test sequence...\n")

# 1. enter CAR mode (10-second transform)
send(MODE_SET, bytes([1]), wait=0.1, label="MODE CAR")
print("🕐 waiting ~10 s for CAR transformation to finish...\n")
time.sleep(10.5)

# 2. drive forward 50% for 3 seconds
send(DRIVE_F, bytes([50]), wait=0.1, label="DRIVE FORWARD 50%")
print("🕐 driving forward for 3 s...\n")
time.sleep(3.0)

# 3. stop
send(STOP_ALL, wait=0.1, label="STOP_ALL")
time.sleep(0.5)

# 4. mixed control: left=-30, right=+60 for 2 seconds
payload = struct.pack('bb', -30, 60)

send(DRIVE_MIX, payload, wait=0.1, label="DRIVE_MIX (-30,+60)")
print("🕐 mixed drive for 2 s...\n")
time.sleep(2.0)

# 5. stop again
send(STOP_ALL, wait=0.1, label="STOP_ALL")

# 6. switch to DRONE mode
send(MODE_SET, bytes([2]), wait=0.1, label="MODE DRONE")
print("🕐 waiting ~10 s for DRONE transformation to finish...\n")
time.sleep(10.5)

# 7. request status
send(STATUS_Q, wait=0.2, label="STATUS_Q")

print("\n✅ sequence complete.")
