import cv2
import sys
import time
import numpy as np
import os
import struct
import signal

# --- CONFIG ---
SENSOR_WIDTH = 256
SENSOR_HEIGHT = 192
OUTPUT_WIDTH = 768
OUTPUT_HEIGHT = 576
ALPHA = 1.0       # Contrast
BLUR_RADIUS = 2  # Blur factor

# Force standard V4L2
os.environ["OPENCV_VIDEOIO_PRIORITY_MSMF"] = "0"

# Global flag for clean exit
RUNNING = True

def handle_signal(signum, frame):
    """Catch kill signals to ensure camera release"""
    global RUNNING
    RUNNING = False

# Register signals (SIGINT = Ctrl+C, SIGTERM = kill command)
signal.signal(signal.SIGINT, handle_signal)
signal.signal(signal.SIGTERM, handle_signal)

def main():
    global RUNNING
    
    # Debug message to stderr (so it shows in main console)
    sys.stderr.write("[thermal_worker] Process started. Searching for camera...\n")
    sys.stderr.flush()
    
    # 1. Open Camera (Hardcoded index 4)
    cap = None
    for i in range(5):
        if not RUNNING: return
        # Try index 4 first
        cap = cv2.VideoCapture(4, cv2.CAP_V4L2)
        if cap.isOpened():
            sys.stderr.write("[thermal_worker] Locked on /dev/video4\n")
            break
        # Fallback to 5 immediately if 4 failed
        cap = cv2.VideoCapture(5, cv2.CAP_V4L2)
        if cap.isOpened():
            sys.stderr.write("[thermal_worker] Locked on /dev/video5\n")
            break
        time.sleep(1.0)
    
    if not cap or not cap.isOpened():
        sys.stderr.write("[thermal_worker] Critical: Failed to open device 4 or 5\n")
        return

    # 2. Configure Raw Mode (CRITICAL)
    cap.set(cv2.CAP_PROP_CONVERT_RGB, 0.0)
    
    # 3. Stream Loop
    while RUNNING:
        try:
            ret, raw_frame = cap.read()
            if not ret or raw_frame is None:
                time.sleep(0.01)
                continue

            # --- Les Wright Processing Logic ---
            h, w = raw_frame.shape[:2]
            
            # Handle flat buffers (driver quirk)
            if h == 1 and w > 1000:
                raw_frame = raw_frame.reshape(384, 256, 2)
                h, w = 384, 256

            if h == 384:
                # Split (Top=Video, Bottom=Temp)
                imdata, thdata = np.array_split(raw_frame, 2)
                
                # Convert YUYV -> BGR (Fixes "Stretched Purple")
                bgr = cv2.cvtColor(imdata, cv2.COLOR_YUV2BGR_YUYV)
                
                # Process
                if ALPHA != 1.0:
                    bgr = cv2.convertScaleAbs(bgr, alpha=ALPHA)
                
                bgr = cv2.resize(bgr, (OUTPUT_WIDTH, OUTPUT_HEIGHT), interpolation=cv2.INTER_CUBIC)
                
                if BLUR_RADIUS > 0:
                    bgr = cv2.blur(bgr, (BLUR_RADIUS, BLUR_RADIUS))

                # Color map
                heatmap = cv2.applyColorMap(bgr, cv2.COLORMAP_PLASMA)
                
                # --- ROTATION FIX ---
                # Rotate 90 degrees Counter-Clockwise
                heatmap = cv2.rotate(heatmap, cv2.ROTATE_90_COUNTERCLOCKWISE)
                # --------------------
                
                # Encode to JPEG
                ok, buf = cv2.imencode(".jpg", heatmap, [cv2.IMWRITE_JPEG_QUALITY, 80])
                if ok:
                    data = buf.tobytes()
                    # Write Packet: [FRAME] [LEN] [DATA]
                    sys.stdout.buffer.write(b'FRAME')
                    sys.stdout.buffer.write(struct.pack('<L', len(data)))
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
        except BrokenPipeError:
            # Parent process died, exit immediately
            RUNNING = False
        except Exception:
            pass

    # Cleanup
    if cap: 
        cap.release()

if __name__ == "__main__":
    main()