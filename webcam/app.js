const roomStatus = document.querySelector("#room-status");
const serverUrlInput = document.querySelector("#server-url");
const scanButton = document.querySelector("#scan");
const disconnectButton = document.querySelector("#disconnect");
const cameraGrid = document.querySelector("#camera-grid");
const message = document.querySelector("#message");

serverUrlInput.value = localStorage.getItem("cameraServerUrl") || serverUrlInput.value;
const publisherId = localStorage.getItem("cameraPublisherId") || `windows-${crypto.randomUUID()}`;
localStorage.setItem("cameraPublisherId", publisherId);

let room;
let devices = [];
const publications = new Map();
let heartbeatTimer;
const LOW_LATENCY_CAPTURE = { width: 1280, height: 720, frameRate: 30 };
const LOW_LATENCY_ENCODING = { maxBitrate: 1_500_000, maxFramerate: 30, priority: "high" };

function serverUrl() { return serverUrlInput.value.trim().replace(/\/$/, ""); }
function cameraKey(deviceId) {
  let hash = 0;
  for (const char of deviceId) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return `${publisherId}:camera-${Math.abs(hash)}`;
}
function trackName(deviceId) { return `camera-${cameraKey(deviceId).split(":").pop()}`; }
function setMessage(text, error = false) { message.textContent = text; message.classList.toggle("error", error); }
function setRoomStatus(connected) {
  roomStatus.textContent = connected ? "LiveKit connected" : "Disconnected";
  roomStatus.classList.toggle("online", connected);
  disconnectButton.disabled = !connected;
}

async function updateRegistry(device, enabled) {
  const response = await fetch(`${serverUrl()}/api/cameras`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cameraId: cameraKey(device.deviceId),
      name: device.label || "Windows camera",
      trackName: trackName(device.deviceId),
      publisherId,
      enabled,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Could not update camera registry");
  }
}

async function connectRoom() {
  if (room?.state === LivekitClient.ConnectionState.Connected) return;
  const endpoint = `${serverUrl()}/api/livekit/token?role=camera&identity=${encodeURIComponent(publisherId)}`;
  const response = await fetch(endpoint, { cache: "no-store" });
  const credentials = await response.json();
  if (!response.ok) throw new Error(credentials.error || "Could not obtain camera token");
  room = new LivekitClient.Room({ dynacast: true });
  room.on(LivekitClient.RoomEvent.Disconnected, () => setRoomStatus(false));
  await room.connect(credentials.serverUrl, credentials.participantToken);
  setRoomStatus(true);
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    for (const device of devices) {
      if (publications.has(device.deviceId)) updateRegistry(device, true).catch(() => {});
    }
  }, 8000);
}

function renderCameras() {
  cameraGrid.replaceChildren();
  devices.forEach((device, index) => {
    const active = publications.get(device.deviceId);
    const card = document.createElement("article");
    card.className = "camera-card";
    const preview = document.createElement("div");
    preview.className = "preview";
    preview.dataset.deviceId = device.deviceId;
    if (active) preview.appendChild(active.element);
    else preview.textContent = "Camera disabled";

    const body = document.createElement("div");
    body.className = "camera-body";
    const heading = document.createElement("div");
    heading.className = "camera-title";
    const title = document.createElement("h2");
    title.textContent = device.label || `Camera ${index + 1}`;
    const state = document.createElement("span");
    state.className = `camera-state ${active ? "live" : ""}`;
    state.textContent = active ? `Live · ${active.captureLabel}` : "Off";
    const button = document.createElement("button");
    button.textContent = active ? "Disable camera" : "Enable camera";
    button.className = active ? "danger" : "primary";
    button.addEventListener("click", () => toggleCamera(device, button));
    heading.append(title, state);
    body.append(heading, button);
    card.append(preview, body);
    cameraGrid.appendChild(card);
  });
}

async function enableCamera(device) {
  await connectRoom();
  const track = await LivekitClient.createLocalVideoTrack({
    deviceId: device.deviceId,
    resolution: LOW_LATENCY_CAPTURE,
  });
  // Favor responsive motion and avoid upload queues on mobile connections.
  if (track.mediaStreamTrack) track.mediaStreamTrack.contentHint = "motion";
  const element = track.attach();
  element.autoplay = true;
  element.muted = true;
  element.playsInline = true;
  await room.localParticipant.publishTrack(track, {
    name: trackName(device.deviceId),
    source: LivekitClient.Track.Source.Camera,
    // Publish one full-resolution stream. With a single selected camera this
    // prevents mobile viewers from receiving a soft low simulcast layer.
    simulcast: false,
    videoCodec: "h264",
    videoEncoding: LOW_LATENCY_ENCODING,
    degradationPreference: "maintain-framerate",
  });
  const captureSettings = track.mediaStreamTrack?.getSettings?.() || {};
  const captureLabel = captureSettings.width && captureSettings.height
    ? `${captureSettings.width}×${captureSettings.height}`
    : "HD";
  publications.set(device.deviceId, { track, element, captureLabel });
  await updateRegistry(device, true);
}

async function disableCamera(device) {
  const active = publications.get(device.deviceId);
  if (!active) return;
  await room.localParticipant.unpublishTrack(active.track, true);
  active.track.detach();
  publications.delete(device.deviceId);
  await updateRegistry(device, false);
}

async function toggleCamera(device, button) {
  button.disabled = true;
  try {
    if (publications.has(device.deviceId)) await disableCamera(device);
    else await enableCamera(device);
    const active = publications.get(device.deviceId);
    setMessage(active
      ? `${device.label || "Camera"} is live at ${active.captureLabel}, low latency at up to 1.5 Mbps.`
      : `${device.label || "Camera"} was disabled.`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    renderCameras();
  }
}

async function scanCameras() {
  scanButton.disabled = true;
  let permissionStream;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access requires Chrome or Edge at http://localhost:8090");
    }
    setMessage("Waiting for Windows camera permission…");
    localStorage.setItem("cameraServerUrl", serverUrl());
    permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    permissionStream.getTracks().forEach((track) => track.stop());
    permissionStream = undefined;
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
    renderCameras();
    setMessage(devices.length ? `Found ${devices.length} camera${devices.length === 1 ? "" : "s"}. Enable the ones to publish.` : "No cameras found.", !devices.length);
  } catch (error) {
    const permissionHelp = error.name === "NotAllowedError"
      ? " Allow camera access in the browser address bar and Windows Settings → Privacy & security → Camera."
      : "";
    setMessage(`Camera access failed: ${error.message}.${permissionHelp}`, true);
  } finally {
    permissionStream?.getTracks().forEach((track) => track.stop());
    scanButton.disabled = false;
  }
}

async function stopAll() {
  clearInterval(heartbeatTimer);
  for (const device of devices) {
    if (publications.has(device.deviceId)) await disableCamera(device).catch(() => {});
  }
  if (room) await room.disconnect();
  room = undefined;
  setRoomStatus(false);
  renderCameras();
}

scanButton.addEventListener("click", scanCameras);
disconnectButton.addEventListener("click", stopAll);
window.addEventListener("pagehide", () => room?.disconnect());
setRoomStatus(false);
