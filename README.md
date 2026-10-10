# Real Simulator

A small end-to-end starter app for controlling four Raspberry Pi LEDs through a
cloud-hosted WebSocket server.

```text
web/       -> Render server and mobile-friendly viewer/controller
rpi4/      -> Raspberry Pi GPIO client
webcam/    -> Separate Windows publishers in webcam/livekit and webcam/agora
supabase/  -> camera registry schema
```

## Message flow

The browser sends an LED command to the backend. The backend validates it,
updates the authoritative state, and broadcasts that state to every browser and
connected Pi. The Pi applies it to its GPIO pins and sends an acknowledgement.
The Windows webcam publisher can send video through either LiveKit or Agora RTC.
The mobile browser uses the matching `/livekit/` or `/agora/` controller route.

## Quick local simulation

You need Node.js 18+ and Python 3.10+.

1. Start the backend:

   ```bash
   cd web
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

3. Open <http://localhost:3000/livekit/>. The backend serves the frontend and the
   browser automatically connects to its `/ws` endpoint. Use the settings panel
   only when you need to connect the UI to another backend.

See each folder's README for deployment, wiring, and configuration details.

## LiveKit video

The local `.env` must contain `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
`LIVEKIT_API_SECRET`. Add the same variables to the Render service's Environment
page before deploying. On Windows, serve `webcam/` locally, scan the available
cameras, and enable the streams you want. On the Mac, open the deployed
controller and press **Connect cameras**.

## Agora RTC video

Create an Agora project with an App Certificate, then set `AGORA_APP_ID` and
`AGORA_APP_CERTIFICATE` in the root `.env` and in Render. `AGORA_CHANNEL`
defaults to `camera-hub`. Use these matching routes:

- Windows publisher: <http://localhost:8090/agora/>
- Mobile controller: `https://your-render-host/agora/`

The existing LiveKit routes remain available at `/livekit/`. Agora uses one RTC
client per enabled webcam so multiple viewers can independently subscribe to
only one of the two cameras at a time.

## Supabase camera management

Run `supabase/camera_management.sql` in the Supabase SQL Editor. Add
`SUPABASE_URL` and `SUPABASE_SECRET_KEY` to the Render environment. The secret
key stays on the server; browsers access the camera registry only through the
server API.

## Security note

Raspberry Pi devices connect without a token. You can set `CONTROLLER_TOKEN` to
protect browser controls. Use `wss://` for connections over the internet.
