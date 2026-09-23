# Raspberry Pi 4 LED WebSocket Controller

A small end-to-end starter app for controlling four Raspberry Pi LEDs through a
cloud-hosted WebSocket server.

```text
render/    -> frontend, web server, WebSocket relay, and shared LED state
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
   cd render
   npm install
   npm start
   ```

2. Start the Pi client in simulation mode in another terminal:

   ```bash
   cd rpi4
   python3 -m venv .venv
   source .venv/bin/activate
   python -m pip install -r requirements.txt
   WS_URL=ws://localhost:3000/ws MOCK_GPIO=true python client.py
   ```

3. Open <http://localhost:3000>. The backend serves the frontend and the
   browser automatically connects to its `/ws` endpoint. Use the settings panel
   only when you need to connect the UI to another backend.

See each folder's README for deployment, wiring, and configuration details.

## Security note

Raspberry Pi devices connect without a token. You can set `CONTROLLER_TOKEN` to
protect browser controls. Use `wss://` for connections over the internet.
