# Raspberry Pi 4 client

## Wiring

| LED | BCM GPIO | Physical pin |
| --- | --- | --- |
| 1 | 17 | 11 |
| 2 | 27 | 13 |
| 3 | 22 | 15 |
| 4 | 23 | 16 |

For every LED, wire `GPIO -> 220–330 Ω resistor -> LED anode (long leg)` and
connect the cathode (short leg) to a Pi ground pin. Never connect an LED directly
to GPIO. The program uses active-high outputs.

## Install and run

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python client.py
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `WS_URL` | `wss://realsimulator.onrender.com/ws` | Cloud WebSocket URL |
| `GPIO_PINS` | `17,27,22,23` | Four BCM GPIO numbers |
| `MOCK_GPIO` | false | Set `true` to run without hardware |

The Pi connects without a device token and reconnects with exponential backoff.
Ctrl+C turns outputs off.

## Live camera over WebRTC

Install the Raspberry Pi camera package from Raspberry Pi OS, then create the
virtual environment with access to system packages:

```bash
sudo apt update
sudo apt install -y python3-picamera2
deactivate 2>/dev/null || true
python3 -m venv --system-site-packages .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Enable the camera in `sudo raspi-config` if your OS requires it, attach the
camera, and start the publisher:

```bash
python camera.py
```

By default it fetches a publish-only token from
`https://realsimulator.onrender.com/api/livekit/token?role=camera` and publishes
640×480 video at 15 FPS. Optional settings are `LIVEKIT_TOKEN_ENDPOINT`,
`CAMERA_WIDTH`, `CAMERA_HEIGHT`, and `CAMERA_FPS`.

Open the deployed controller and press **Connect video** to subscribe. Run
`client.py` separately when you also want LED control.
