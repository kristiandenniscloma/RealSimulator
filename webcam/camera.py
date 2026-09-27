import asyncio
import json
import logging
import os
import platform
import urllib.request
from contextlib import suppress

import cv2
from livekit import rtc

TOKEN_ENDPOINT = os.getenv(
    "LIVEKIT_TOKEN_ENDPOINT",
    "http://localhost:3000/api/livekit/token?role=camera",
)
CAMERA_INDEX = int(os.getenv("CAMERA_INDEX", "0"))
REQUESTED_WIDTH = int(os.getenv("CAMERA_WIDTH", "1280"))
REQUESTED_HEIGHT = int(os.getenv("CAMERA_HEIGHT", "720"))
REQUESTED_FPS = int(os.getenv("CAMERA_FPS", "24"))


def fetch_credentials():
    request = urllib.request.Request(
        TOKEN_ENDPOINT,
        headers={"User-Agent": "mac-webcam/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def open_camera():
    backend = cv2.CAP_AVFOUNDATION if platform.system() == "Darwin" else cv2.CAP_ANY
    camera = cv2.VideoCapture(CAMERA_INDEX, backend)
    camera.set(cv2.CAP_PROP_FRAME_WIDTH, REQUESTED_WIDTH)
    camera.set(cv2.CAP_PROP_FRAME_HEIGHT, REQUESTED_HEIGHT)
    camera.set(cv2.CAP_PROP_FPS, REQUESTED_FPS)
    if not camera.isOpened():
        camera.release()
        raise RuntimeError(
            f"Could not open camera index {CAMERA_INDEX}. Try CAMERA_INDEX=1 or allow Terminal camera access."
        )
    return camera


async def publish_camera():
    camera = open_camera()
    room = rtc.Room()
    try:
        ok, first_image = await asyncio.to_thread(camera.read)
        if not ok:
            raise RuntimeError("The webcam opened but did not return a frame")

        height, width = first_image.shape[:2]
        credentials = await asyncio.to_thread(fetch_credentials)
        logging.info("Connecting to LiveKit room %s", credentials["roomName"])
        await room.connect(credentials["serverUrl"], credentials["participantToken"])

        source = rtc.VideoSource(width, height)
        track = rtc.LocalVideoTrack.create_video_track("front_camera", source)
        options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_CAMERA)
        await room.local_participant.publish_track(track, options)
        logging.info(
            "USB webcam %s is live at %sx%s (requested %s FPS)",
            CAMERA_INDEX,
            width,
            height,
            REQUESTED_FPS,
        )

        image = first_image
        while True:
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            frame = rtc.VideoFrame(
                width,
                height,
                rtc.VideoBufferType.RGB24,
                rgb.tobytes(),
            )
            source.capture_frame(frame)
            ok, image = await asyncio.to_thread(camera.read)
            if not ok:
                raise RuntimeError("Lost the webcam video stream")
    finally:
        camera.release()
        await room.disconnect()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    with suppress(KeyboardInterrupt):
        asyncio.run(publish_camera())
