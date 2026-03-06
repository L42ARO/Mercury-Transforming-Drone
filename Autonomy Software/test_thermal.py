import cv2
import time

# Try index 4 (video4)
IDX = 4

print(f"Attempting to open index {IDX}...")
cap = cv2.VideoCapture(IDX, cv2.CAP_V4L2)

# CRITICAL for Topdon/InfiRay: Disable RGB conversion immediately
cap.set(cv2.CAP_PROP_CONVERT_RGB, 0.0)

if not cap.isOpened():
    print(f"FAILED to open index {IDX}")
    # Try index 5 just in case 4 was the metadata node
    print("Trying index 5...")
    cap = cv2.VideoCapture(5, cv2.CAP_V4L2)
    cap.set(cv2.CAP_PROP_CONVERT_RGB, 0.0)

if cap.isOpened():
    print("SUCCESS! Camera opened.")
    ret, frame = cap.read()
    if ret:
        print(f"Frame captured! Shape: {frame.shape}")
        # Topdon frames should look like (384, 256, 2) or (192, 256, 2) depending on raw format
    else:
        print("Camera opened, but failed to read frame.")
    cap.release()
else:
    print("Could not open device on 4 or 5.")