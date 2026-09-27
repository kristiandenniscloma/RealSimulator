import asyncio
import json
import logging
import os
import urllib.request
from contextlib import suppress

from livekit import rtc

TOKEN_ENDPOINT = os.getenv(
    "LIVEKIT_TOKEN_ENDPOINT",
    "https://realsimulator.onrender.com/api/livekit/token?role=camera",
)
WIDTH = int(os.getenv("CAMERA_WIDTH", "640"))
HEIGHT = int(os.getenv("CAMERA_HEIGHT", "480"))
FPS = int(os.getenv("CAMERA_FPS", "15"))


def fetch_credentials():
    request = urllib.request.Request(TOKEN_ENDPOINT, headers={"User-Agent": "rpi-camera/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


async def publish_camera():
    from picamera2 import Picamera2

    credentials = await asyncio.to_thread(fetch_credentials)
    room = rtc.Room()
    camera = Picamera2()
    camera.configure(camera.create_video_configuration(
        main={"size": (WIDTH, HEIGHT), "format": "RGB888"},
        controls={"FrameRate": FPS},
    ))

    logging.info("Connecting to LiveKit room %s", credentials["roomName"])
    await room.connect(credentials["serverUrl"], credentials["participantToken"])
    source = rtc.VideoSource(WIDTH, HEIGHT)
    track = rtc.LocalVideoTrack.create_video_track("front_camera", source)
    options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_CAMERA)
    await room.local_participant.publish_track(track, options)

    camera.start()
    logging.info("Camera is live at %sx%s, %s FPS", WIDTH, HEIGHT, FPS)
    try:
        while True:
            pixels = await asyncio.to_thread(camera.capture_array, "main")
            frame = rtc.VideoFrame(
                WIDTH,
                HEIGHT,
                rtc.VideoBufferType.RGB24,
                pixels.tobytes(),
            )
            source.capture_frame(frame)
    finally:
        camera.stop()
        camera.close()
        await room.disconnect()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    with suppress(KeyboardInterrupt):
        asyncio.run(publish_camera())
