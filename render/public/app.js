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
let leds = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, on: false }));
let livekitRoom;

function render() {
  grid.innerHTML = leds.map((led) => `<article class="led-card ${led.on ? "on" : ""}"><div class="bulb" aria-hidden="true"></div><h2>LED ${led.id}</h2><button class="switch" data-id="${led.id}" data-next="${!led.on}" ${socket?.readyState === WebSocket.OPEN ? "" : "disabled"}>Turn ${led.on ? "off" : "on"}</button></article>`).join("");
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
grid.addEventListener("click", (event) => { const button = event.target.closest("button[data-id]"); if (button) send({ type: "set_led", id: Number(button.dataset.id), on: button.dataset.next === "true" }); });
document.querySelector("#all-on").addEventListener("click", () => send({ type: "set_all", on: true }));
document.querySelector("#all-off").addEventListener("click", () => send({ type: "set_all", on: false }));
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

function setCameraStatus(online, text) {
  setBadge(cameraStatus, online, [text, text]);
}

function attachVideo(track) {
  if (track.kind !== LivekitClient.Track.Kind.Video) return;
  for (const existing of videoStage.querySelectorAll("video")) existing.remove();
  const video = track.attach();
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  videoStage.appendChild(video);
  videoPlaceholder.hidden = true;
  setCameraStatus(true, "Camera live");
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
      .on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => track.detach())
      .on(LivekitClient.RoomEvent.ParticipantDisconnected, () => {
        if (!videoStage.querySelector("video")) setCameraStatus(false, "Waiting for camera");
      })
      .on(LivekitClient.RoomEvent.Disconnected, () => {
        setCameraStatus(false, "Video disconnected");
        videoConnect.disabled = false;
        videoDisconnect.disabled = true;
      });
    await livekitRoom.connect(credentials.serverUrl, credentials.participantToken);
    setCameraStatus(false, "Waiting for camera");
    videoDisconnect.disabled = false;
  } catch (error) {
    setCameraStatus(false, "Video connection failed");
    messageBox.textContent = error.message;
    videoConnect.disabled = false;
  }
}

async function disconnectVideo() {
  if (livekitRoom) await livekitRoom.disconnect();
  livekitRoom = undefined;
  for (const video of videoStage.querySelectorAll("video")) video.remove();
  videoPlaceholder.hidden = false;
  setCameraStatus(false, "Video disconnected");
  videoConnect.disabled = false;
  videoDisconnect.disabled = true;
}

videoConnect.addEventListener("click", connectVideo);
videoDisconnect.addEventListener("click", disconnectVideo);
