# Web application

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
| `LIVEKIT_ROOM` | `camera-hub` | Fixed multi-camera room name |
| `SUPABASE_URL` | required for camera management | Supabase project URL |
| `SUPABASE_SECRET_KEY` | required for camera management | Server-only Supabase secret key |

Open <http://localhost:3000> after starting it. Other endpoints are `GET
/health` and WebSocket `/ws`. Raspberry Pi devices connect without a token. For
cloud deployment, optionally set `CONTROLLER_TOKEN` to protect the controls.
State is kept in memory and resets when the server restarts.

The `GET /api/livekit/token?role=viewer|camera` endpoint creates scoped LiveKit
tokens. Viewers can only subscribe and Windows camera consoles can only publish. For local
development, the server loads these variables from the repository-root `.env`.
On Render, add them to the service's Environment page; `.env` is not deployed.

Run `../supabase/camera_management.sql` in the Supabase SQL Editor before using
the camera console. Camera publishers update `POST /api/cameras`; viewers read
`GET /api/cameras`. The database table has RLS enabled and browser roles have no
direct table privileges.

For Render, set the service Root Directory to `web`, Build Command to `npm ci`,
Start Command to `npm start`, and Health Check Path to `/health`.
