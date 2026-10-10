const roomStatus = document.querySelector("#room-status");
const serverUrlInput = document.querySelector("#server-url");
const scanButton = document.querySelector("#scan");
const disconnectButton = document.querySelector("#disconnect");
const cameraGrid = document.querySelector("#camera-grid");
const message = document.querySelector("#message");

serverUrlInput.value = localStorage.getItem("cameraServerUrl") || serverUrlInput.value;
const publisherId = localStorage.getItem("agoraCameraPublisherId") || `windows-${crypto.randomUUID()}`;
localStorage.setItem("agoraCameraPublisherId", publisherId);

let devices = [];
const publications = new Map();
let heartbeatTimer;
const AGORA_ENCODER = {
  width: 1280,
  height: 720,
  frameRate: 30,
  bitrateMin: 600,
  bitrateMax: 2400,
};

function serverUrl() { return serverUrlInput.value.trim().replace(/\/$/, ""); }
function stableHash(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function cameraUid(deviceId) { return stableHash(`${publisherId}:${deviceId}`) || 1; }
function cameraKey(deviceId) { return `agora:${publisherId}:camera-${cameraUid(deviceId)}`; }
function setMessage(text, error = false) { message.textContent = text; message.classList.toggle("error", error); }
function setRoomStatus() {
  const count = publications.size;
  roomStatus.textContent = count ? `Agora connected · ${count} live` : "Disconnected";
  roomStatus.classList.toggle("online", Boolean(count));
  disconnectButton.disabled = !count;
}

async function getCredentials(uid) {
  const endpoint = `${serverUrl()}/api/agora/token?role=camera&uid=${encodeURIComponent(uid)}`;
  const response = await fetch(endpoint, { cache: "no-store" });
  const credentials = await response.json();
  if (!response.ok) throw new Error(credentials.error || "Could not obtain Agora camera token");
  return credentials;
}

async function updateRegistry(device, enabled) {
  const response = await fetch(`${serverUrl()}/api/cameras`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cameraId: cameraKey(device.deviceId),
      name: device.label || "Windows camera",
      trackName: String(cameraUid(device.deviceId)),
      publisherId: `agora:${publisherId}`,
      transport: "agora",
      enabled,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Could not update camera registry");
  }
}

function renderCameras() {
  cameraGrid.replaceChildren();
  devices.forEach((device, index) => {
    const active = publications.get(device.deviceId);
    const card = document.createElement("article");
    card.className = "camera-card";
    const preview = document.createElement("div");
    preview.className = "preview";
    if (active) active.track.play(preview, { fit: "contain" });
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
  setRoomStatus();
}

async function enableCamera(device) {
  const uid = cameraUid(device.deviceId);
  const credentials = await getCredentials(uid);
  const client = AgoraRTC.createClient({ mode: "rtc", codec: "h264" });
  client.on("connection-state-change", (current) => {
    if (current === "DISCONNECTED" && publications.has(device.deviceId)) {
      setMessage(`${device.label || "Camera"} disconnected from Agora.`, true);
    }
  });
  await client.join(credentials.appId, credentials.channel, credentials.token, credentials.uid);
  client.on("token-privilege-will-expire", async () => {
    try {
      const renewal = await getCredentials(uid);
      await client.renewToken(renewal.token);
    } catch (error) {
      setMessage(`Agora token renewal failed: ${error.message}`, true);
    }
  });
  let track;
  try {
    track = await AgoraRTC.createCameraVideoTrack({
      cameraId: device.deviceId,
      encoderConfig: AGORA_ENCODER,
      optimizationMode: "motion",
    });
    const nativeTrack = track.getMediaStreamTrack?.();
    if (nativeTrack) nativeTrack.contentHint = "motion";
    const capabilities = nativeTrack?.getCapabilities?.() || {};
    const cameraTuning = {};
    if (capabilities.focusMode?.includes("continuous")) cameraTuning.focusMode = "continuous";
    if (capabilities.exposureMode?.includes("continuous")) cameraTuning.exposureMode = "continuous";
    if (capabilities.whiteBalanceMode?.includes("continuous")) cameraTuning.whiteBalanceMode = "continuous";
    if (Object.keys(cameraTuning).length) {
      await nativeTrack.applyConstraints({ advanced: [cameraTuning] }).catch(() => {});
    }
    await client.publish(track);
  } catch (error) {
    track?.close();
    await client.leave().catch(() => {});
    throw error;
  }
  const settings = track.getMediaStreamTrack?.().getSettings?.() || {};
  const captureLabel = settings.width && settings.height
    ? `${settings.width}×${settings.height} @ ${settings.frameRate || 30} fps`
    : "1280×720 @ 30 fps";
  publications.set(device.deviceId, { client, track, captureLabel });
  await updateRegistry(device, true);
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    for (const activeDevice of devices) {
      if (publications.has(activeDevice.deviceId)) updateRegistry(activeDevice, true).catch(() => {});
    }
  }, 8000);
}

async function disableCamera(device) {
  const active = publications.get(device.deviceId);
  if (!active) return;
  await active.client.unpublish(active.track).catch(() => {});
  active.track.stop();
  active.track.close();
  await active.client.leave();
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
      ? `${device.label || "Camera"} is live through Agora at ${active.captureLabel}. Motion mode prioritizes low latency.`
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
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires Chrome or Edge at http://localhost:8090");
    setMessage("Waiting for Windows camera permission…");
    localStorage.setItem("cameraServerUrl", serverUrl());
    permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    permissionStream.getTracks().forEach((track) => track.stop());
    permissionStream = undefined;
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
    renderCameras();
    setMessage(devices.length ? `Found ${devices.length} camera${devices.length === 1 ? "" : "s"}. Enable the ones to publish through Agora.` : "No cameras found.", !devices.length);
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
  for (const device of devices) await disableCamera(device).catch(() => {});
  renderCameras();
}

scanButton.addEventListener("click", scanCameras);
disconnectButton.addEventListener("click", stopAll);
window.addEventListener("pagehide", () => {
  for (const { client, track } of publications.values()) {
    track.close();
    client.leave();
  }
});
setRoomStatus();
