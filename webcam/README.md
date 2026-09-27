# Windows USB-webcam publisher

This program captures a USB webcam on the Windows laptop with OpenCV and
publishes it to the `rpi-camera` LiveKit room. The video travels through
LiveKit; the Render server only creates its short-lived publishing token.

## Install on Windows

Open PowerShell in the project folder:

```powershell
cd webcam
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

If PowerShell blocks activation, run this once in that terminal and activate
again:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

## Publish the webcam

```powershell
python camera.py
```

The default token endpoint is the deployed application:

```text
https://realsimulator.onrender.com/api/livekit/token?role=camera
```

Camera `0` is used by default. If that selects the built-in camera or fails,
try the USB camera at index `1` or `2`:

```powershell
$env:CAMERA_INDEX="1"
python camera.py
```

Windows might ask for permission. Camera access must be enabled under
**Settings → Privacy & security → Camera**, including access for desktop apps.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LIVEKIT_TOKEN_ENDPOINT` | deployed Render server | Camera token endpoint |
| `CAMERA_INDEX` | `0` | OpenCV camera number |
| `CAMERA_WIDTH` | `1280` | Requested capture width |
| `CAMERA_HEIGHT` | `720` | Requested capture height |
| `CAMERA_FPS` | `24` | Requested frame rate |

For a local test where the server runs on the same Windows laptop:

```powershell
$env:LIVEKIT_TOKEN_ENDPOINT="http://localhost:3000/api/livekit/token?role=camera"
python camera.py
```
