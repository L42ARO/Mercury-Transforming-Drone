# ACTUATION BOARD API

This document describes how to communicate with the ESP32-S3 controller from a Raspberry Pi using the **binary Serial 1 protocol** on `/dev/ttyAMA1`.
The API lets the Pi switch modes and drive the robot efficiently via framed byte packets (no strings).

---

## ⚙️ Serial setup

| Parameter            | Value                  |
| -------------------- | ---------------------- |
| Port                 | `/dev/ttyAMA1`         |
| Baud rate            | **115 200 bps**        |
| Data format          | 8 N 1                  |
| TX / RX (Pi → ESP32) | ESP32 TX = D6, RX = D7 |
| Logic voltage        | 3.3 V (direct UART)    |

Python example:

```python
import serial
ser = serial.Serial('/dev/ttyAMA1', 115200, timeout=0.2)
```

---

## 🧱 Frame structure

Every packet (both directions) follows:

```
AA 55 <LEN> <CMD> <PAYLOAD…> <CHK>
```

| Field       | Description                                             |
| ----------- | ------------------------------------------------------- |
| `AA 55`     | Sync header                                             |
| `<LEN>`     | Payload + 1 byte for CMD                                |
| `<CMD>`     | Command ID                                              |
| `<PAYLOAD>` | Command-specific data                                   |
| `<CHK>`     | XOR of all bytes from `<LEN>` through last payload byte |

Example:
`AA 55 01 02 03` → `STOP_ALL` (len = 1, cmd = 0x02, chk = 0x03)

---

## 🧭 Command table (Pi → ESP32)

| CMD (HEX) | Name          | Payload                            | Notes                               |
| --------- | ------------- | ---------------------------------- | ----------------------------------- |
| `0x01`    | **MODE_SET**  | `u8 mode` → 0 NONE  1 CAR  2 DRONE | Starts 10 s transform for CAR/DRONE |
| `0x02`    | **STOP_ALL**  | –                                  | Stops all motors immediately        |
| `0x03`    | **DRIVE_F**   | `u8 pct (0-100)`                   | Forward (CAR mode only)             |
| `0x04`    | **DRIVE_B**   | `u8 pct (0-100)`                   | Backward                            |
| `0x05`    | **DRIVE_L**   | `u8 pct (0-100)`                   | Left                                |
| `0x06`    | **DRIVE_R**   | `u8 pct (0-100)`                   | Right                               |
| `0x07`    | **DRIVE_MIX** | `i8 left, i8 right` (-100..100)    | Mixed differential drive            |
| `0x08`    | **TURNMODE**  | `u8 mode` → 0 SAME 1 TANK          | Optional steering style             |
| `0x09`    | **DMAX_SET**  | `u16 delta_us (LE)`                | Servo range 200-500 µs              |
| `0x0A`    | **STATUS_Q**  | –                                  | Requests current status frame       |

---

## 📡 Responses (ESP32 → Pi)

| Type       | CMD ID | Payload                                          | Meaning                                    |
| ---------- | ------ | ------------------------------------------------ | ------------------------------------------ |
| **ACK**    | `0x80` | `0x01`                                           | OK                                         |
| **ERR**    | `0x81` | `u8 code`                                        | 1 BadArg  2 BadMode  3 NotInCar  4 Unknown |
| **STATUS** | `0x82` | `mode u8 active u8 turn u8 dmax u16 reserved u8` | 6-byte status payload                      |

All responses use the same `AA 55 <LEN> <CMD> … <CHK>` format.

---

## ⏱ Timing guidelines

| Command type                   | Recommended wait before next                 |
| ------------------------------ | -------------------------------------------- |
| `MODE_SET` (CAR/DRONE)         | ~ 10 s  (physical transform duration)        |
| Drive commands (`F/B/L/R/MIX`) | Wait until motion finishes (typically 2-3 s) |
| `STOP_ALL` / `STATUS_Q`        | 0.1 s                                        |

---

## 🧪 Example Python usage

```python
import serial, struct, time
ser = serial.Serial('/dev/ttyAMA1', 115200, timeout=0.2)

def frame(cmd, payload=b''):
    body = bytes([len(payload)+1, cmd]) + payload
    chk = 0
    for x in body: chk ^= x
    return b'\xAA\x55' + body + bytes([chk])

def send(cmd, payload=b'', wait=0.0, label=''):
    print(f"➡️  {label or hex(cmd)}")
    ser.write(frame(cmd, payload))
    resp = ser.read(64)
    if resp: print("⬅️ ", resp.hex(' '))
    else:    print("⬅️  (no response)")
    time.sleep(wait)

# --- sample sequence ---
send(0x01, bytes([1]), 0.1, "MODE CAR")
print("waiting 10 s for transformation…")
time.sleep(10)

send(0x03, bytes([50]), 0.1, "DRIVE FORWARD 50%")
time.sleep(3)
send(0x02, b'', 0.1, "STOP_ALL")

payload = struct.pack('bb', -30, 60)
send(0x07, payload, 0.1, "DRIVE_MIX (-30,+60)")
time.sleep(2)
send(0x02, b'', 0.1, "STOP_ALL")

send(0x01, bytes([2]), 0.1, "MODE DRONE")
time.sleep(10)
send(0x0A, b'', 0.2, "STATUS_Q")
```

---

## 🪪 Quick reference (hex examples)

| Action              | Frame                  |
| ------------------- | ---------------------- |
| MODE CAR            | `AA 55 02 01 01 03`    |
| STOP_ALL            | `AA 55 01 02 03`       |
| DRIVE F 50%         | `AA 55 02 03 32 31`    |
| DRIVE MIX (-30,+60) | `AA 55 03 07 E2 3C 18` |
| STATUS_Q            | `AA 55 01 0A 0B`       |

---

## 🧰 Debugging tips

* Use `minicom` or `screen /dev/ttyAMA1 115200` to verify bytes.
* Every valid frame begins with `AA 55`.
* `0x80` ACK → success; `0x81` ERR → check payload for error code.
* If you get no response, ensure grounds are common and TX/RX aren’t swapped.

---

**Author:** Mercurius Robotics
**Purpose:** Efficient serial bridge for Pi ↔ ESP32 differential-drive controller.
