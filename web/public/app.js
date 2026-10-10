const defaultUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host || "localhost:3000"}/ws`;
const settings = { url: localStorage.getItem("wsUrl") || defaultUrl, token: localStorage.getItem("controllerToken") || "" };
const grid = document.querySelector("#led-grid");
const serverStatus = document.querySelector("#server-status");
const piStatus = document.querySelector("#pi-status");
const messageBox = document.querySelector("#message");
const urlInput = document.querySelector("#ws-url");
const tokenInput = document.querySelector("#token");
let socket, reconnectTimer;
let manualReconnect = false;
let leds = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, on: false }));
let livekitRoom;
const controlDefinitions = [
  { id: 1, name: "Forward", path: "M12 20V5m0 0L5.5 12M12 5l6.5 7", className: "forward" },
  { id: 2, name: "Backward", path: "M12 4v15m0 0 6.5-7M12 19l-6.5-7", className: "backward" },
  { id: 3, name: "Left", path: "M20 12H5m0 0 7-6.5M5 12l7 6.5", className: "left" },
  { id: 4, name: "Right", path: "M4 12h15m0 0-7-6.5M19 12l-7 6.5", className: "right" },
  { id: 5, name: "Scoop", path: "M4 15.5 9 18l8-4.5-5.5-2.8L9 5M17 13.5l2-6M15.5 6.5 19 7.5 21 5", className: "scoop" },
];
const pressedControls = new Set();

function controlButton(control) {
  return `
    <button class="control-button ${control.className}" data-id="${control.id}" aria-label="${control.name}" aria-pressed="false">
      <span class="control-number">${control.id}</span>
      <svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${control.path}"/></svg>
      <span class="control-name">${control.name}</span>
    </button>`;
}

function render() {
  if (!grid.children.length) {
    const driveControls = controlDefinitions.filter((control) => control.id !== 5).map(controlButton).join("");
    grid.innerHTML = `<div class="drive-cluster">${driveControls}</div>${controlButton(controlDefinitions[4])}`;
  }
  for (const control of controlDefinitions) {
    const button = grid.querySelector(`[data-id="${control.id}"]`);
    const state = leds.find((item) => item.id === control.id)?.on || false;
    button.classList.toggle("active", state);
    button.setAttribute("aria-pressed", String(state));
    button.disabled = socket?.readyState !== WebSocket.OPEN;
  }
}
function setBadge(element, online, labels) {
  element.classList.toggle("online", online); element.classList.toggle("offline", !online); element.textContent = online ? labels[0] : labels[1];
}
function send(payload) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload)); }
function connect() {
  clearTimeout(reconnectTimer); messageBox.textContent = "";
  setBadge(serverStatus, false, ["Server online", "Connecting…"]);
  socket = new WebSocket(settings.url);
  socket.addEventListener("open", () => { send({ type: "auth", role: "controller", token: settings.token }); setBadge(serverStatus, true, ["Server online", "Server offline"]); render(); });
  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "state") { leds = data.leds; setBadge(piStatus, data.piOnline, ["Pi online", "Pi offline"]); render(); }
    else if (data.type === "error") messageBox.textContent = data.message;
    else if (data.type === "device_applied") messageBox.textContent = `Pi applied update at ${new Date(data.timestamp).toLocaleTimeString()}`;
  });
  socket.addEventListener("close", () => {
    setBadge(serverStatus, false, ["Server online", "Server offline"]); setBadge(piStatus, false, ["Pi online", "Pi offline"]); render();
    if (!manualReconnect) reconnectTimer = setTimeout(connect, 2500); manualReconnect = false;
  });
  socket.addEventListener("error", () => { messageBox.textContent = "Cannot reach the WebSocket server."; });
}
function setControl(id, on) {
  if (on) pressedControls.add(id);
  else pressedControls.delete(id);
  send({ type: "set_led", id, on });
}
function releaseAllControls() {
  pressedControls.clear();
  send({ type: "set_all", on: false });
}
grid.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button || button.disabled) return;
  event.preventDefault();
  button.setPointerCapture(event.pointerId);
  setControl(Number(button.dataset.id), true);
});
for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
  grid.addEventListener(eventName, (event) => {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    const id = Number(button.dataset.id);
    if (pressedControls.has(id)) setControl(id, false);
  });
}
window.addEventListener("blur", releaseAllControls);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAllControls(); });
setInterval(() => {
  for (const id of pressedControls) send({ type: "set_led", id, on: true });
}, 250);
document.querySelector("#settings-form").addEventListener("submit", (event) => {
  event.preventDefault(); settings.url = urlInput.value.trim(); settings.token = tokenInput.value;
  localStorage.setItem("wsUrl", settings.url); localStorage.setItem("controllerToken", settings.token);
  manualReconnect = true; socket?.close(); setTimeout(connect, 50);
});
urlInput.value = settings.url; tokenInput.value = settings.token; render(); connect();

const cameraStatus = document.querySelector("#camera-status");
const videoStage = document.querySelector("#video-stage");
const videoPlaceholder = document.querySelector("#video-placeholder");
const videoConnect = document.querySelector("#video-connect");
const videoDisconnect = document.querySelector("#video-disconnect");
const cameraSwitch = document.querySelector("#camera-switch");
const cameraCount = document.querySelector("#camera-count");
const cameraName = document.querySelector("#camera-name");
const videoTracks = new Map();
const videoCards = new Map();
let cameraRegistry = new Map();
let cameraPollTimer;
let activeCameraName;
const PREFERRED_VIDEO_DIMENSIONS = { width: 1920, height: 1080 };

function setCameraStatus(online, text) {
  setBadge(cameraStatus, online, [text, text]);
}

function availableCameraNames() {
  return [...new Set([...videoTracks.keys(), ...cameraRegistry.keys()])];
}

function syncActiveCamera(names = availableCameraNames()) {
  if (!names.length) {
    activeCameraName = undefined;
    cameraCount.textContent = "CAM 0/0";
    cameraName.textContent = "No camera";
    cameraSwitch.disabled = true;
    return;
  }
  if (!activeCameraName || !names.includes(activeCameraName)) activeCameraName = names[0];
  const activeIndex = names.indexOf(activeCameraName);
  for (const [trackName, elements] of videoCards) {
    const isActive = trackName === activeCameraName;
    elements.card.classList.toggle("active", isActive);
    const publication = videoTracks.get(trackName)?.publication;
    if (publication) {
      // Only pull the selected camera across the network. Explicit dimensions
      // override adaptive-stream sizing, which can otherwise choose a soft,
      // low-resolution simulcast layer on mobile Safari.
      publication.setEnabled(isActive);
      if (isActive) {
        publication.setVideoDimensions(PREFERRED_VIDEO_DIMENSIONS);
        publication.setVideoFPS?.(30);
      }
    }
  }
  const registry = cameraRegistry.get(activeCameraName);
  cameraCount.textContent = `CAM ${activeIndex + 1}/${names.length}`;
  cameraName.textContent = registry?.name || activeCameraName;
  cameraSwitch.disabled = names.length < 2;
}

function renderVideoGrid() {
  const names = availableCameraNames();
  if (!names.length) {
    for (const { card } of videoCards.values()) card.remove();
    videoCards.clear();
    videoPlaceholder.hidden = false;
    syncActiveCamera(names);
    return;
  }
  videoPlaceholder.hidden = true;
  for (const trackName of names) {
    const registry = cameraRegistry.get(trackName);
    const trackInfo = videoTracks.get(trackName);
    let elements = videoCards.get(trackName);
    if (!elements) {
      const card = document.createElement("article");
      card.className = "video-card";
      const frame = document.createElement("div");
      frame.className = "video-frame";
      const meta = document.createElement("div");
      meta.className = "video-meta";
      const name = document.createElement("span");
      name.className = "video-name";
      const state = document.createElement("span");
      meta.append(name, state);
      card.append(frame, meta);
      videoStage.appendChild(card);
      elements = { card, frame, name, state };
      videoCards.set(trackName, elements);
    }

    const { frame, name, state } = elements;
    if (trackInfo) {
      // Keep the LiveKit video mounted across registry refreshes to avoid a
      // brief pause or black frame when the browser repaints the element.
      if (trackInfo.element.parentElement !== frame) frame.replaceChildren(trackInfo.element);
    } else {
      frame.textContent = registry?.online ? "Connecting to stream…" : "Camera offline";
    }
    name.textContent = registry?.name || trackName;
    const isLive = Boolean(trackInfo);
    state.className = `video-state ${isLive ? "online" : "offline"}`;
    state.textContent = isLive ? "Live" : (registry?.enabled ? "Waiting" : "Off");
  }

  for (const [trackName, elements] of videoCards) {
    if (!names.includes(trackName)) {
      elements.card.remove();
      videoCards.delete(trackName);
    }
  }
  syncActiveCamera(names);
}

async function loadCameraRegistry() {
  try {
    const response = await fetch("/api/cameras", { cache: "no-store" });
    if (!response.ok) return;
    const { cameras } = await response.json();
    cameraRegistry = new Map(
      cameras
        .filter((camera) => camera.enabled && camera.online)
        .map((camera) => [camera.track_name, camera]),
    );
    renderVideoGrid();
  } catch {
    // Video can still work if the optional registry is temporarily unavailable.
  }
}

function attachVideo(track, publication) {
  if (track.kind !== LivekitClient.Track.Kind.Video) return;
  const name = publication.trackName || track.name || publication.trackSid;
  const video = track.attach();
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  videoTracks.set(name, { track, element: video, publication });
  renderVideoGrid();
  setCameraStatus(true, `${videoTracks.size} camera${videoTracks.size === 1 ? "" : "s"} live`);
}

function detachVideo(track, publication) {
  const name = publication.trackName || track.name || publication.trackSid;
  track.detach();
  videoTracks.delete(name);
  renderVideoGrid();
  setCameraStatus(Boolean(videoTracks.size), videoTracks.size ? `${videoTracks.size} cameras live` : "Waiting for cameras");
}

async function connectVideo() {
  if (livekitRoom || videoConnect.disabled) return;
  videoConnect.disabled = true;
  setCameraStatus(false, "Connecting video…");
  try {
    const response = await fetch("/api/livekit/token?role=viewer", { cache: "no-store" });
    const credentials = await response.json();
    if (!response.ok) throw new Error(credentials.error || "Could not create a LiveKit token");

    // Adaptive stream chooses a layer from the rendered element size. Camera
    // cards are intentionally compact, which otherwise keeps them on a blurry
    // low-resolution layer even when bandwidth is plentiful.
    livekitRoom = new LivekitClient.Room({ adaptiveStream: false });
    livekitRoom
      .on(LivekitClient.RoomEvent.TrackSubscribed, attachVideo)
      .on(LivekitClient.RoomEvent.TrackUnsubscribed, detachVideo)
      .on(LivekitClient.RoomEvent.ParticipantDisconnected, () => {
        if (!videoTracks.size) setCameraStatus(false, "Waiting for cameras");
      })
      .on(LivekitClient.RoomEvent.Disconnected, () => {
        livekitRoom = undefined;
        setCameraStatus(false, "Video disconnected");
        videoConnect.disabled = false;
        videoDisconnect.disabled = true;
      });
    await livekitRoom.connect(credentials.serverUrl, credentials.participantToken);
    setCameraStatus(false, "Waiting for cameras");
    videoDisconnect.disabled = false;
    await loadCameraRegistry();
    clearInterval(cameraPollTimer);
    cameraPollTimer = setInterval(loadCameraRegistry, 5000);
  } catch (error) {
    livekitRoom = undefined;
    setCameraStatus(false, "Video connection failed");
    messageBox.textContent = error.message;
    videoConnect.disabled = false;
  }
}

async function disconnectVideo() {
  clearInterval(cameraPollTimer);
  if (livekitRoom) await livekitRoom.disconnect();
  livekitRoom = undefined;
  for (const { track } of videoTracks.values()) track.detach();
  videoTracks.clear();
  renderVideoGrid();
  setCameraStatus(false, "Video disconnected");
  videoConnect.disabled = false;
  videoDisconnect.disabled = true;
}

cameraSwitch.addEventListener("click", () => {
  const names = availableCameraNames();
  if (names.length < 2) return;
  const currentIndex = Math.max(0, names.indexOf(activeCameraName));
  activeCameraName = names[(currentIndex + 1) % names.length];
  syncActiveCamera(names);
});
videoConnect.addEventListener("click", connectVideo);
videoDisconnect.addEventListener("click", disconnectVideo);

function goFullScreen() {
  const elem = document.documentElement;
  let request;
  if (elem.requestFullscreen) {
    request = elem.requestFullscreen();
  } else if (elem.webkitRequestFullscreen) {
    request = elem.webkitRequestFullscreen();
  } else if (elem.msRequestFullscreen) {
    request = elem.msRequestFullscreen();
  }
  if (request?.catch) request.catch(() => {});
}

document.querySelector("#start-btn").addEventListener("click", () => {
  goFullScreen();
  document.body.classList.add("control-active");
  connectVideo();
});

// Keep long presses, repeated taps, and pinch gestures from selecting or
// scaling cockpit controls. Settings fields retain normal text interaction.
const cockpit = document.querySelector(".cockpit");
const isTextField = (target) => target instanceof Element && target.matches("input, textarea, select");
for (const eventName of ["contextmenu", "dragstart", "selectstart", "dblclick"]) {
  cockpit.addEventListener(eventName, (event) => {
    if (!isTextField(event.target)) event.preventDefault();
  });
}
for (const eventName of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(eventName, (event) => event.preventDefault(), { passive: false });
}

loadCameraRegistry();
