# Raspberry Pi 4 LED WebSocket Controller

A small end-to-end starter app for controlling four Raspberry Pi LEDs through a
cloud-hosted WebSocket server.

```text
backend/   -> frontend, web server, WebSocket relay, and shared LED state
rpi4/      -> Raspberry Pi GPIO client
```

## Message flow

The browser sends an LED command to the backend. The backend validates it,
updates the authoritative state, and broadcasts that state to every browser and
connected Pi. The Pi applies it to its GPIO pins and sends an acknowledgement.

## Quick local simulation

You need Node.js 18+ and Python 3.10+.

1. Start the backend:

   ```bash
   cd backend
   npm install
   npm start
   ```

2. Start the Pi client in simulation mode in another terminal:

   ```bash
   cd rpi4
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   MOCK_GPIO=true python client.py
   ```

3. Open <http://localhost:3000>. The backend serves the frontend and the
   browser automatically connects to its `/ws` endpoint. Use the settings panel
   only when you need to connect the UI to another backend.

See each folder's README for deployment, wiring, and configuration details.

## Security note

Set `DEVICE_TOKEN` and `CONTROLLER_TOKEN` on a public deployment. Use `wss://`
through a TLS-enabled hosting provider or reverse proxy; do not expose a plain
`ws://` endpoint to the internet.
