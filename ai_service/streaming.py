"""
MJPEG streaming endpoint.
Reads latest_frame from CameraThread and serves as multipart JPEG stream.
"""

import cv2
import numpy as np
import time
from fastapi import Response
from fastapi.responses import StreamingResponse


def _get_blank_frame():
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(frame, "Connecting...", (220, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    ret, jpeg = cv2.imencode(".jpg", frame)
    return jpeg.tobytes()

_BLANK_JPEG = _get_blank_frame()

def generate_mjpeg(camera_thread):
    """Generator that yields MJPEG frames from a camera thread. Broadcasts pre-encoded JPEG."""
    while camera_thread.running:
        jpeg = camera_thread.get_frame_jpeg()
        if jpeg is None:
            # Yield connecting frame so stream doesn't time out
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + _BLANK_JPEG + b"\r\n"
            )
            time.sleep(0.5)
            continue

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"
        )

        # ~30 FPS max streaming rate
        time.sleep(0.033)


def create_stream_response(camera_thread):
    """Create a StreamingResponse for MJPEG stream."""
    return StreamingResponse(
        generate_mjpeg(camera_thread),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )
