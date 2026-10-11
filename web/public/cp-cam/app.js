const preview = document.querySelector("#preview");
const emptyState = document.querySelector("#empty");
const cameraName = document.querySelector("#camera-name");
const cameraSelect = document.querySelector("#camera-select");
const startButton = document.querySelector("#start");
const switchButton = document.querySelector("#switch");
const stopButton = document.querySelector("#stop");
const statusText = document.querySelector("#status");
const statsText = document.querySelector("#stats");
const liveBadge = document.querySelector("#live-badge");

const ENCODER = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  bitrateMin: 1800,
  bitrateMax: 2500,
};

let uid = Number(localStorage.getItem("cpCameraUid"));
if (!Number.isInteger(uid) || uid < 1 || uid > 0xffffffff) {
  uid = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  localStorage.setItem("cpCameraUid", String(uid));
}
cameraName.value = localStorage.getItem("cpCameraName") || cameraName.value;

let client;
let track;
let cameras = [];
let heartbeatTimer;
let statsTimer;
let wakeLock;

function setStatus(text, error = false) {
  statusText.textContent = text;
  statusText.classList.toggle("error", error);
}

function setLive(live) {
  liveBadge.textContent = live ? "Live" : "Offline";
  liveBadge.classList.toggle("live", live);
  startButton.disabled = live;
  stopButton.disabled = !live;
  switchButton.disabled = !live || cameras.length < 2;
  cameraSelect.disabled = !live || cameras.length < 2;
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
  return cameras[0].deviceId;
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
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
    statsText.textContent = `${width || "—"}×${height || "—"} · ${Math.round(fps) || "—"} fps · ${Math.round(bitrate) || "—"} Kbps · H.264 detail`;
  }, 2000);
}

async function startStream() {
  if (client || track) return;
  startButton.disabled = true;
  setStatus("Requesting rear-camera access…");
  try {
    if (!window.AgoraRTC) throw new Error("Agora SDK did not load");
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires HTTPS and a supported browser");
    localStorage.setItem("cpCameraName", cameraName.value.trim());
    const deviceId = await discoverCameras();
    const credentials = await getCredentials();
    client = AgoraRTC.createClient({ mode: "rtc", codec: "h264" });
    client.on("connection-state-change", (current) => {
      if (current === "RECONNECTING") setStatus("Network changed. Reconnecting to Agora…");
      if (current === "CONNECTED" && track) setStatus("Streaming. Keep this page open and the screen awake.");
    });
    client.on("token-privilege-will-expire", async () => {
      const renewal = await getCredentials();
      await client?.renewToken(renewal.token);
    });
    await client.join(credentials.appId, credentials.channel, credentials.token, credentials.uid);
    track = await AgoraRTC.createCameraVideoTrack({
      cameraId: deviceId,
      encoderConfig: ENCODER,
      optimizationMode: "detail",
    });
    const nativeTrack = track.getMediaStreamTrack?.();
    if (nativeTrack) nativeTrack.contentHint = "detail";
    emptyState.hidden = true;
    track.play(preview, { fit: "cover", mirror: false });
    await client.publish(track);
    await updateRegistry(true);
    heartbeatTimer = setInterval(() => updateRegistry(true).catch(() => {}), 8000);
    beginStats();
    await requestWakeLock();
    setLive(true);
    setStatus("Streaming. Keep this page open and the screen awake.");
  } catch (error) {
    await stopStream(false);
    setStatus(`Could not start camera: ${error.message}`, true);
    startButton.disabled = false;
  }
}

async function switchCamera(deviceId) {
  if (!track || !deviceId) return;
  switchButton.disabled = true;
  cameraSelect.disabled = true;
  try {
    await track.setDevice(deviceId);
    cameraSelect.value = deviceId;
    setStatus(`Switched to ${cameraSelect.selectedOptions[0]?.textContent || "camera"}.`);
  } catch (error) {
    setStatus(`Could not switch camera: ${error.message}`, true);
  } finally {
    switchButton.disabled = cameras.length < 2;
    cameraSelect.disabled = cameras.length < 2;
  }
}

async function stopStream(updateCamera = true) {
  clearInterval(heartbeatTimer);
  clearInterval(statsTimer);
  heartbeatTimer = undefined;
  statsTimer = undefined;
  if (updateCamera && (client || track)) await updateRegistry(false).catch(() => {});
  if (client && track) await client.unpublish(track).catch(() => {});
  track?.stop();
  track?.close();
  track = undefined;
  await client?.leave().catch(() => {});
  client = undefined;
  await wakeLock?.release().catch(() => {});
  wakeLock = undefined;
  [...preview.children].forEach((child) => { if (child !== emptyState) child.remove(); });
  emptyState.hidden = false;
  statsText.textContent = "1080p · 30 fps · H.264 · detail mode";
  setLive(false);
  if (updateCamera) setStatus("Stream stopped.");
}

startButton.addEventListener("click", startStream);
stopButton.addEventListener("click", () => stopStream());
switchButton.addEventListener("click", () => {
  const index = Math.max(0, cameras.findIndex((camera) => camera.deviceId === cameraSelect.value));
  const next = cameras[(index + 1) % cameras.length];
  if (next) switchCamera(next.deviceId);
});
cameraSelect.addEventListener("change", () => switchCamera(cameraSelect.value));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && track) requestWakeLock();
});
window.addEventListener("pagehide", () => {
  if (client || track) updateRegistry(false).catch(() => {});
  track?.close();
  client?.leave();
});

setLive(false);
