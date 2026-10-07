# Windows multi-camera console

This browser UI discovers the Windows laptop's built-in camera and attached USB
webcams. Every enabled camera gets a local preview and a separate LiveKit video
track. Status and labels are registered through the Render server in Supabase.

## Run on Windows

Open PowerShell in the repository:

```powershell
cd webcam
npm install
npm start
```

Open <http://localhost:8090>, press **Allow camera & scan**, then enable each
camera you want to publish. Camera capture is permitted on `localhost` by modern
browsers. Keep the PowerShell window and browser tab open while streaming.

Each camera is captured and published at up to 1280x720, 24 fps with a 1.8 Mbps
ceiling. A single encoding is used to reduce periodic CPU and upload spikes when
multiple cameras are active. Actual quality
can still be limited by the camera hardware, lighting, the Windows publisher's
upload speed, CPU load, or LiveKit congestion control.

The default Render server is `https://realsimulator.onrender.com`. You can edit
that URL in the camera console before scanning. Windows camera permission must
be enabled under **Settings → Privacy & security → Camera**.

To test with a server running locally on the same Windows computer, enter
`http://localhost:3000` in the Render server URL field.
