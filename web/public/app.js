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
  { id: 1, name: "Forward", icon: "↑", className: "forward" },
  { id: 2, name: "Backward", icon: "↓", className: "backward" },
  { id: 3, name: "Left", icon: "←", className: "left" },
  { id: 4, name: "Right", icon: "→", className: "right" },
  { id: 5, name: "Scoop", icon: "SCOOP", className: "scoop" },
];
const pressedControls = new Set();

function render() {
  if (!grid.children.length) {
    grid.innerHTML = controlDefinitions.map((control) => `
      <button class="control-button ${control.className}" data-id="${control.id}" aria-label="${control.name}" aria-pressed="false">
        <span class="control-number">${control.id}</span>
        <span class="control-icon" aria-hidden="true">${control.icon}</span>
        <span class="control-name">${control.name}</span>
      </button>`).join("");
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
const videoTracks = new Map();
const videoCards = new Map();
let cameraRegistry = new Map();
let cameraPollTimer;

function setCameraStatus(online, text) {
  setBadge(cameraStatus, online, [text, text]);
}

function renderVideoGrid() {
  const names = new Set([...cameraRegistry.keys(), ...videoTracks.keys()]);
  if (!names.size) {
    for (const { card } of videoCards.values()) card.remove();
    videoCards.clear();
    videoPlaceholder.hidden = false;
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
    state.className = `badge ${isLive ? "online" : "offline"}`;
    state.textContent = isLive ? "Live" : (registry?.enabled ? "Waiting" : "Off");
  }

  for (const [trackName, elements] of videoCards) {
    if (!names.has(trackName)) {
      elements.card.remove();
      videoCards.delete(trackName);
    }
  }
}

async function loadCameraRegistry() {
  try {
    const response = await fetch("/api/cameras", { cache: "no-store" });
    if (!response.ok) return;
    const { cameras } = await response.json();
    cameraRegistry = new Map(cameras.map((camera) => [camera.track_name, camera]));
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
  videoTracks.set(name, { track, element: video });
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
  videoConnect.disabled = true;
  setCameraStatus(false, "Connecting video…");
  try {
    const response = await fetch("/api/livekit/token?role=viewer", { cache: "no-store" });
    const credentials = await response.json();
    if (!response.ok) throw new Error(credentials.error || "Could not create a LiveKit token");

    livekitRoom = new LivekitClient.Room({ adaptiveStream: true });
    livekitRoom
      .on(LivekitClient.RoomEvent.TrackSubscribed, attachVideo)
      .on(LivekitClient.RoomEvent.TrackUnsubscribed, detachVideo)
      .on(LivekitClient.RoomEvent.ParticipantDisconnected, () => {
        if (!videoTracks.size) setCameraStatus(false, "Waiting for cameras");
      })
      .on(LivekitClient.RoomEvent.Disconnected, () => {
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

videoConnect.addEventListener("click", connectVideo);
videoDisconnect.addEventListener("click", disconnectVideo);
loadCameraRegistry();
