# macOS USB webcam publisher

This publisher captures a USB webcam with OpenCV and sends it to the
`rpi-camera` LiveKit room through WebRTC.

## Local use

Start the Node server first, then run:

```bash
cd webcam
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python camera.py
```

Open <http://localhost:3000> and press **Connect video**. On the first run,
macOS should request camera permission for Terminal. If it does not, enable it
under **System Settings → Privacy & Security → Camera**.

The default camera is index `0`, which might be the built-in camera. To select
the USB webcam, try:

```bash
CAMERA_INDEX=1 python camera.py
```

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LIVEKIT_TOKEN_ENDPOINT` | local server | Token endpoint; use the Render URL for cloud operation |
| `CAMERA_INDEX` | `0` | OpenCV camera number |
| `CAMERA_WIDTH` | `1280` | Requested capture width |
| `CAMERA_HEIGHT` | `720` | Requested capture height |
| `CAMERA_FPS` | `24` | Requested frame rate |

To use the deployed app instead of the local server:

```bash
LIVEKIT_TOKEN_ENDPOINT="https://realsimulator.onrender.com/api/livekit/token?role=camera" python camera.py
```
