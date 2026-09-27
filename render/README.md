# Backend

This is the complete deployable web application. It serves the files in
`public/`, keeps the current four-LED state, and relays it between controller
browsers and Raspberry Pi devices.

## Run

```bash
npm install
npm start
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket port |
| `HOST` | `0.0.0.0` | Listen address |
| `CONTROLLER_TOKEN` | empty | Required browser authentication token |
| `LIVEKIT_URL` | required for video | LiveKit Cloud `wss://` project URL |
| `LIVEKIT_API_KEY` | required for video | LiveKit project API key |
| `LIVEKIT_API_SECRET` | required for video | LiveKit project secret; server only |
| `LIVEKIT_ROOM` | `rpi-camera` | Fixed camera room name |

Open <http://localhost:3000> after starting it. Other endpoints are `GET
/health` and WebSocket `/ws`. Raspberry Pi devices connect without a token. For
cloud deployment, optionally set `CONTROLLER_TOKEN` to protect the controls.
State is kept in memory and resets when the server restarts.

The `GET /api/livekit/token?role=viewer|camera` endpoint creates scoped LiveKit
tokens. Viewers can only subscribe and the Pi camera can only publish. For local
development, the server loads these variables from the repository-root `.env`.
On Render, add them to the service's Environment page; `.env` is not deployed.
