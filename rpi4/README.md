# Raspberry Pi 4 relay client

## Wiring

| Relay | BCM GPIO | Physical pin |
| --- | --- | --- |
| 1 | 17 | 11 |
| 2 | 27 | 13 |
| 3 | 22 | 15 |
| 4 | 23 | 16 |
| 5 | 24 | 18 |

Connect each relay module input to its listed GPIO and connect the module ground
to Raspberry Pi ground. Power the relay module according to its voltage and
current requirements; do not power relay coils directly from GPIO pins.

Most common relay modules are **active-low**: GPIO low turns the relay on and
GPIO high turns it off. The client accounts for that by default, so an `OFF`
command now physically de-energizes the relay and an `ON` command energizes it.

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
| `GPIO_PINS` | `17,27,22,23,24` | Five BCM GPIO numbers |
| `RELAY_ACTIVE_LOW` | `true` | Set `false` only for an active-high relay board |
| `MOCK_GPIO` | false | Set `true` to run without hardware |

The Pi connects without a device token and reconnects with exponential backoff.
Ctrl+C logically turns every relay off before releasing the pins.

Control mapping: relay 1 forward, relay 2 backward, relay 3 left, relay 4
right, and relay 5 scoop. Forward/backward and left/right are interlocked by
the server so opposing directions cannot remain active simultaneously.
