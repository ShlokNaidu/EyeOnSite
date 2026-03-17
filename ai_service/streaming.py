"""
MJPEG streaming endpoint.
Reads latest_frame from CameraThread and serves as multipart JPEG stream.
"""

import cv2
import time
from fastapi import Response
from fastapi.responses import StreamingResponse


def generate_mjpeg(camera_thread):
    """Generator that yields MJPEG frames from a camera thread. Broadcasts pre-encoded JPEG."""
    while camera_thread.running:
        jpeg = camera_thread.get_frame_jpeg()
        if jpeg is None:
            # No frame yet — wait
            time.sleep(0.05)
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
