# Windows multi-camera console

This browser UI discovers the Windows laptop's built-in camera and attached USB
webcams. LiveKit and Agora are isolated in separate publisher folders and URLs.
Status and labels are registered through the Render server in Supabase.

## Run on Windows

Open PowerShell in the repository:

```powershell
cd webcam
npm install
npm start
```

Choose one publisher and keep that browser tab open while streaming:

- LiveKit: <http://localhost:8090/livekit/>
- Agora RTC: <http://localhost:8090/agora/>

Press **Allow camera & scan**, then enable each camera you want to publish.
Camera capture is permitted on `localhost` by modern browsers.

The Agora profile uses H.264 at 1280×720, up to 30 fps and 2.4 Mbps. Agora's
`motion` optimization prioritizes smooth delivery and low latency while keeping
enough bitrate for detailed sand, rocks, and small moving trucks. Each enabled camera uses an
independent Agora client; viewers subscribe only to their selected camera. Agora
automatically routes through its network, so no fixed US region is configured.

The LiveKit profile uses 1280×720, 30 fps and up to 2.4 Mbps with motion-first
congestion behavior.
Actual quality can still be limited by camera hardware, lighting, Windows upload
speed, CPU load, packet loss, or the receiving phone's mobile network.

The default Render server is `https://realsimulator.onrender.com`. You can edit
that URL in the camera console before scanning. Windows camera permission must
be enabled under **Settings → Privacy & security → Camera**.

To test with a server running locally on the same Windows computer, enter
`http://localhost:3000` in the Render server URL field.
