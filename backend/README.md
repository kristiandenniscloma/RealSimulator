# Backend

The backend keeps the current four-LED state and relays it between controller
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
| `DEVICE_TOKEN` | empty | Required Pi authentication token |
| `CONTROLLER_TOKEN` | empty | Required browser authentication token |

Endpoints are `GET /health` and WebSocket `/ws`. For cloud deployment, set both
tokens and configure the clients with the resulting `wss://` URL. State is kept
in memory and resets when the server restarts.
