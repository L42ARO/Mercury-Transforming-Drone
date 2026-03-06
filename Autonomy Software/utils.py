
# Shared utility functions for RatbirdUI

import datetime
import itertools
import cv2
from math import radians, sin, cos, asin, sqrt

def encode_jpeg_bgr(frame, USE_TURBO=False, _jpeg=None, JPEG_QUALITY=85, TJSAMP_420=None, TJPF_BGR=None):
	"""
	Encode a BGR frame to JPEG. If USE_TURBO and _jpeg are provided, use TurboJPEG, else fallback to OpenCV.
	"""
	if USE_TURBO and _jpeg and TJSAMP_420 and TJPF_BGR:
		try:
			return _jpeg.encode(frame, quality=JPEG_QUALITY, jpeg_subsample=TJSAMP_420, pixel_format=TJPF_BGR)
		except TypeError:
			try:
				return _jpeg.encode(frame, quality=JPEG_QUALITY, pixel_format=TJPF_BGR)
			except Exception:
				pass
	ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
	return buf.tobytes() if ok else None

def unique_record_path(RECORD_DIR, ext=".mp4"):
	ts = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
	base = RECORD_DIR / f"rec_{ts}{ext}"
	if not base.exists():
		return base
	for i in itertools.count(1):
		cand = RECORD_DIR / f"rec_{ts}_{i}{ext}"
		if not cand.exists():
			return cand

def haversine_m(lat1, lon1, lat2, lon2):
	R = 6371000.0
	dlat, dlon = radians(lat2-lat1), radians(lon2-lon1)
	a = sin(dlat/2)**2 + cos(radians(lat1))*cos(radians(lat2))*sin(dlon/2)**2
	return 2*R*asin(sqrt(a))

