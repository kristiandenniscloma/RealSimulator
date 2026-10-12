const preview = document.querySelector("#preview");
const emptyState = document.querySelector("#empty");
const emptyTitle = emptyState.querySelector("strong");
const emptyCopy = emptyState.querySelector("small");
const cameraName = document.querySelector("#camera-name");
const cameraSelect = document.querySelector("#camera-select");
const startButton = document.querySelector("#start");
const switchButton = document.querySelector("#switch");
const stopButton = document.querySelector("#stop");
const statusText = document.querySelector("#status");
const statsText = document.querySelector("#stats");
const liveBadge = document.querySelector("#live-badge");

const ENCODER = { width: 1920, height: 1080, frameRate: 30, bitrateMin: 1800, bitrateMax: 2500 };
const SIGNAL_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
const IDLE_GRACE_MS = 4000;

let uid = Number(localStorage.getItem("cpCameraUid"));
if (!Number.isInteger(uid) || uid < 1 || uid > 0xffffffff) {
  uid = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  localStorage.setItem("cpCameraUid", String(uid));
}
cameraName.value = localStorage.getItem("cpCameraName") || cameraName.value;

let client;
let track;
let preparedTrack;
let cameras = [];
let signalingSocket;
let signalingReconnectTimer;
let idleStopTimer;
let heartbeatTimer;
let statsTimer;
let wakeLock;
let armed = false;
let publishing = false;
let stopping = false;
let viewerCount = 0;

function setStatus(text, error = false) {
  statusText.textContent = text;
  statusText.classList.toggle("error", error);
}

function renderState() {
  const live = Boolean(track && client);
  liveBadge.textContent = live ? "Live" : armed ? "Armed" : "Offline";
  liveBadge.classList.toggle("live", live);
  liveBadge.classList.toggle("armed", armed && !live);
  startButton.disabled = armed;
  stopButton.disabled = !armed;
  switchButton.disabled = !armed || cameras.length < 2;
  cameraSelect.disabled = !armed || cameras.length < 2;
  cameraName.disabled = armed;
  if (!live) {
    emptyTitle.textContent = armed ? "Camera armed" : "Camera ready";
    emptyCopy.textContent = armed
      ? `${viewerCount} viewer${viewerCount === 1 ? "" : "s"} · capture is off while idle`
      : "Arm once, then keep this page open.";
  }
}

async function getCredentials() {
  const response = await fetch(`/api/agora/token?role=camera&uid=${encodeURIComponent(uid)}`, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not create an Agora camera token");
  return body;
}

async function updateRegistry(enabled) {
  const response = await fetch("/api/cameras", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cameraId: `agora:cp:${uid}`,
      name: cameraName.value.trim() || "Cellphone field camera",
      trackName: String(uid),
      publisherId: `agora:cp-${uid}`,
      enabled,
    }),
    keepalive: !enabled,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Could not update the camera list");
  }
}

function rearCameraFirst(list, preferredId) {
  const rearPattern = /back|rear|environment|wide|telephoto|ultra/i;
  return [...list].sort((a, b) => {
    if (a.deviceId === preferredId) return -1;
    if (b.deviceId === preferredId) return 1;
    return Number(rearPattern.test(b.label)) - Number(rearPattern.test(a.label));
  });
}

function renderCameraOptions(selectedId) {
  cameraSelect.replaceChildren();
  cameras.forEach((camera, index) => {
    const option = document.createElement("option");
    option.value = camera.deviceId;
    option.textContent = camera.label || `Camera ${index + 1}`;
    option.selected = camera.deviceId === selectedId;
    cameraSelect.appendChild(option);
  });
}

async function discoverCameras() {
  const permission = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30, max: 30 },
    },
  });
  const permissionTrack = permission.getVideoTracks()[0];
  const preferredId = permissionTrack?.getSettings?.().deviceId;
  permission.getTracks().forEach((mediaTrack) => mediaTrack.stop());
  cameras = rearCameraFirst(await AgoraRTC.getCameras(), preferredId);
  if (!cameras.length) throw new Error("No cellphone camera was found");
  renderCameraOptions(cameras[0].deviceId);
}

async function prepareCameraTrack() {
  preparedTrack = await AgoraRTC.createCameraVideoTrack({
    cameraId: cameraSelect.value || cameras[0]?.deviceId,
    encoderConfig: ENCODER,
    optimizationMode: "detail",
  });
  const nativeTrack = preparedTrack.getMediaStreamTrack?.();
  if (nativeTrack) nativeTrack.contentHint = "detail";
  // Track creation happens inside the Arm button gesture for mobile Safari.
  // Disabling it stops capture and publishing until WebSocket demand arrives.
  await preparedTrack.setEnabled(false);
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request("screen");
  } catch {}
}

function beginStats() {
  clearInterval(statsTimer);
  statsTimer = setInterval(() => {
    if (!client || !track) return;
    const capture = track.getMediaStreamTrack?.().getSettings?.() || {};
    const stats = client.getLocalVideoStats?.() || {};
    const width = stats.sendResolutionWidth || capture.width || 0;
    const height = stats.sendResolutionHeight || capture.height || 0;
    const fps = stats.sendFrameRate || capture.frameRate || 0;
    const bitrate = stats.sendBitrate || 0;
    statsText.textContent = `${width || "—"}×${height || "—"} · ${Math.round(fps) || "—"} fps · ${Math.round(bitrate) || "—"} Kbps · ${viewerCount} viewer${viewerCount === 1 ? "" : "s"}`;
  }, 2000);
}

function scheduleIdleStop() {
  clearTimeout(idleStopTimer);
  if (!track && !client) return;
  idleStopTimer = setTimeout(() => {
    if (viewerCount > 0) return;
    if (publishing) return scheduleIdleStop();
    stopPublishing().catch(() => {});
  }, IDLE_GRACE_MS);
}

async function startPublishing() {
  if (!armed || viewerCount < 1 || client || track || publishing) return;
  publishing = true;
  clearTimeout(idleStopTimer);
  setStatus(`${viewerCount} viewer${viewerCount === 1 ? "" : "s"} requested video. Starting camera…`);
  try {
    const credentials = await getCredentials();
    client = AgoraRTC.createClient({ mode: "rtc", codec: "h264" });
    client.on("connection-state-change", (current) => {
      if (current === "RECONNECTING") setStatus("Network changed. Reconnecting to Agora…");
      if (current === "CONNECTED" && track) setStatus(`Live for ${viewerCount} viewer${viewerCount === 1 ? "" : "s"}.`);
    });
    client.on("token-privilege-will-expire", async () => {
      const renewal = await getCredentials();
      await client?.renewToken(renewal.token);
    });
    await client.join(credentials.appId, credentials.channel, credentials.token, credentials.uid);
    if (!preparedTrack) throw new Error("Camera is not prepared. Disarm and arm it again.");
    track = preparedTrack;
    await track.setEnabled(true);
    emptyState.hidden = true;
    track.play(preview, { fit: "cover", mirror: false });
    await client.publish(track);
    await updateRegistry(true);
    heartbeatTimer = setInterval(() => updateRegistry(true).catch(() => {}), 8000);
    beginStats();
    renderState();
    setStatus(`Live for ${viewerCount} viewer${viewerCount === 1 ? "" : "s"}. Camera stops automatically when idle.`);
  } catch (error) {
    await stopPublishing(false);
    setStatus(`Could not start camera: ${error.message}`, true);
  } finally {
    publishing = false;
    if (viewerCount < 1) scheduleIdleStop();
  }
}

async function stopPublishing(updateCamera = true) {
  if (stopping) return;
  stopping = true;
  clearTimeout(idleStopTimer);
  clearInterval(heartbeatTimer);
  clearInterval(statsTimer);
  heartbeatTimer = undefined;
  statsTimer = undefined;
  if (updateCamera && (client || track)) await updateRegistry(false).catch(() => {});
  if (client && track) await client.unpublish(track).catch(() => {});
  track?.stop();
  await track?.setEnabled(false).catch(() => {});
  track = undefined;
  await client?.leave().catch(() => {});
  client = undefined;
  [...preview.children].forEach((child) => { if (child !== emptyState) child.remove(); });
  emptyState.hidden = false;
  statsText.textContent = "1080p · 30 fps · H.264 · camera off while idle";
  stopping = false;
  renderState();
  if (armed && viewerCount < 1) setStatus("Armed and waiting. Camera capture is off.");
}

function handleDemand(message) {
  viewerCount = Number.isInteger(message.viewers) ? Math.max(0, message.viewers) : (message.active ? 1 : 0);
  renderState();
  if (!armed) return;
  if (viewerCount > 0) {
    clearTimeout(idleStopTimer);
    startPublishing();
  } else {
    setStatus("No viewers. Stopping camera…");
    scheduleIdleStop();
  }
}

function connectSignaling() {
  clearTimeout(signalingReconnectTimer);
  if (!armed || signalingSocket?.readyState === WebSocket.OPEN || signalingSocket?.readyState === WebSocket.CONNECTING) return;
  signalingSocket = new WebSocket(SIGNAL_URL);
  signalingSocket.addEventListener("open", () => {
    signalingSocket.send(JSON.stringify({ type: "auth", role: "camera" }));
    setStatus("Armed and waiting for a viewer. Camera capture is off.");
  });
  signalingSocket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "camera_demand") handleDemand(message);
    if (message.type === "error") setStatus(message.message, true);
  });
  signalingSocket.addEventListener("close", () => {
    signalingSocket = undefined;
    viewerCount = 0;
    renderState();
    scheduleIdleStop();
    if (armed) {
      setStatus("Demand connection lost. Reconnecting…", true);
      signalingReconnectTimer = setTimeout(connectSignaling, 2500);
    }
  });
}

async function armCamera() {
  if (armed) return;
  startButton.disabled = true;
  setStatus("Requesting rear-camera permission…");
  try {
    if (!window.AgoraRTC) throw new Error("Agora SDK did not load");
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires HTTPS and a supported browser");
    localStorage.setItem("cpCameraName", cameraName.value.trim());
    await discoverCameras();
    await prepareCameraTrack();
    armed = true;
    await requestWakeLock();
    renderState();
    connectSignaling();
    setStatus("Armed and waiting for a viewer. Camera capture is off.");
  } catch (error) {
    armed = false;
    preparedTrack?.close();
    preparedTrack = undefined;
    setStatus(`Could not arm camera: ${error.message}`, true);
    renderState();
  }
}

async function disarmCamera() {
  armed = false;
  viewerCount = 0;
  clearTimeout(signalingReconnectTimer);
  signalingSocket?.close();
  signalingSocket = undefined;
  await stopPublishing();
  preparedTrack?.close();
  preparedTrack = undefined;
  await wakeLock?.release().catch(() => {});
  wakeLock = undefined;
  renderState();
  setStatus("Camera disarmed.");
}

async function switchCamera(deviceId) {
  if (!armed || !deviceId) return;
  switchButton.disabled = true;
  cameraSelect.disabled = true;
  try {
    const cameraTrack = track || preparedTrack;
    if (cameraTrack) await cameraTrack.setDevice(deviceId);
    cameraSelect.value = deviceId;
    setStatus(track
      ? `Switched to ${cameraSelect.selectedOptions[0]?.textContent || "camera"}.`
      : "Camera selected. Capture remains off until a viewer connects.");
  } catch (error) {
    setStatus(`Could not switch camera: ${error.message}`, true);
  } finally {
    renderState();
  }
}

startButton.addEventListener("click", armCamera);
stopButton.addEventListener("click", disarmCamera);
switchButton.addEventListener("click", () => {
  const index = Math.max(0, cameras.findIndex((camera) => camera.deviceId === cameraSelect.value));
  const next = cameras[(index + 1) % cameras.length];
  if (next) switchCamera(next.deviceId);
});
cameraSelect.addEventListener("change", () => switchCamera(cameraSelect.value));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && armed) {
    requestWakeLock();
    connectSignaling();
  }
});
window.addEventListener("pagehide", () => {
  armed = false;
  signalingSocket?.close();
  if (client || track) updateRegistry(false).catch(() => {});
  (track || preparedTrack)?.close();
  client?.leave();
});

renderState();
