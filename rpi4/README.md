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
pip install -r requirements.txt
WS_URL=wss://your-backend.example/ws DEVICE_TOKEN=change-me python client.py
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `WS_URL` | `ws://localhost:3000/ws` | Cloud WebSocket URL |
| `DEVICE_TOKEN` | empty | Must match the backend token |
| `GPIO_PINS` | `17,27,22,23` | Four BCM GPIO numbers |
| `MOCK_GPIO` | false | Set `true` to run without hardware |

The client reconnects with exponential backoff. Ctrl+C turns outputs off.
