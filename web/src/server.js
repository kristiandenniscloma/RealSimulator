const http = require("node:http");
const { randomInt, randomUUID } = require("node:crypto");
const { createReadStream, stat } = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { AccessToken } = require("livekit-server-sdk");
const { RtcTokenBuilder, Role: AgoraRole } = require("agora-token/src/RtcTokenBuilder2");
const { createClient } = require("@supabase/supabase-js");
const { WebSocketServer, WebSocket } = require("ws");
const { initialState, parseMessage, validateSetLed, validateSetAll, applyControlCommand } = require("./protocol");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const CONTROLLER_TOKEN = process.env.CONTROLLER_TOKEN || "";
const LIVEKIT_URL = process.env.LIVEKIT_URL || "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";
const LIVEKIT_ROOM = process.env.LIVEKIT_ROOM || "camera-hub";
const AGORA_APP_ID = process.env.AGORA_APP_ID || "";
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || "";
const AGORA_CHANNEL = process.env.AGORA_CHANNEL || "camera-hub";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = SUPABASE_URL && SUPABASE_SECRET_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
  : null;
let leds = initialState();
let piOnline = false;
let lastControlRefresh = 0;

const FRONTEND_DIR = path.resolve(__dirname, "../public");
const STATIC_FILES = {
  "/livekit/": ["index.html", "text/html; charset=utf-8"],
  "/agora/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/livekit/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/agora/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/livekit/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/agora/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/vendor/agora-super-clarity.js": ["../node_modules/agora-extension-super-clarity/index.js", "text/javascript; charset=utf-8"],
};

function serveStatic(request, response) {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (["/", "/livekit", "/agora"].includes(pathname)) {
    const destination = pathname === "/agora" ? "/agora/" : "/livekit/";
    response.writeHead(302, { location: destination, "cache-control": "no-store" });
    response.end();
    return true;
  }
  const entry = STATIC_FILES[pathname];
  if (!entry || !["GET", "HEAD"].includes(request.method)) return false;

  const [filename, contentType] = entry;
  const filePath = path.join(FRONTEND_DIR, filename);
  stat(filePath, (error, fileStat) => {
    if (error || !fileStat.isFile()) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Frontend file not found" }));
      return;
    }
    response.writeHead(200, {
      "content-type": contentType,
      "content-length": fileStat.size,
      "cache-control": "no-cache",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  });
  return true;
}

function apiHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    ...extra,
  };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16_384) request.destroy();
    });
    request.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(new Error("Request body must be valid JSON")); }
    });
    request.on("error", reject);
  });
}

async function serveCameras(request, response) {
  const requestUrl = new URL(request.url, "http://localhost");
  if (requestUrl.pathname !== "/api/cameras") return false;
  if (request.method === "OPTIONS") {
    response.writeHead(204, apiHeaders());
    response.end();
    return true;
  }
  if (!supabase) {
    response.writeHead(503, apiHeaders());
    response.end(JSON.stringify({ error: "Supabase is not configured on the server" }));
    return true;
  }
  if (request.method === "GET") {
    const { data, error } = await supabase.from("cameras").select("*").order("name");
    if (error) throw error;
    const transport = requestUrl.searchParams.get("transport");
    const staleBefore = Date.now() - 20_000;
    const cameras = data
      .filter((camera) => {
        const isAgora = camera.camera_id.startsWith("agora:");
        if (transport === "agora") return isAgora;
        if (transport === "livekit") return !isAgora;
        return true;
      })
      .map((camera) => ({
        ...camera,
        transport: camera.camera_id.startsWith("agora:") ? "agora" : "livekit",
        online: camera.enabled && new Date(camera.last_seen).getTime() >= staleBefore,
      }));
    response.writeHead(200, apiHeaders());
    response.end(JSON.stringify({ cameras }));
    return true;
  }
  if (request.method === "POST") {
    const body = await readJson(request);
    if (!/^[\w:.-]{1,200}$/.test(body.cameraId || "")) {
      response.writeHead(400, apiHeaders());
      response.end(JSON.stringify({ error: "A valid cameraId is required" }));
      return true;
    }
    const camera = {
      camera_id: body.cameraId,
      name: String(body.name || "Camera").slice(0, 100),
      track_name: String(body.trackName || "").slice(0, 200),
      publisher_id: String(body.publisherId || "windows-webcam").slice(0, 200),
      enabled: Boolean(body.enabled),
      online: Boolean(body.enabled),
      last_seen: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("cameras")
      .upsert(camera, { onConflict: "camera_id" })
      .select()
      .single();
    if (error) throw error;
    response.writeHead(200, apiHeaders());
    response.end(JSON.stringify({ camera: data }));
    return true;
  }
  response.writeHead(405, apiHeaders({ allow: "GET, POST, OPTIONS" }));
  response.end(JSON.stringify({ error: "Method not allowed" }));
  return true;
}

async function serveLiveKitToken(request, response) {
  const requestUrl = new URL(request.url, "http://localhost");
  if (requestUrl.pathname !== "/api/livekit/token" || request.method !== "GET") return false;

  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    response.writeHead(503, apiHeaders());
    response.end(JSON.stringify({ error: "LiveKit is not configured on the server" }));
    return true;
  }

  const role = requestUrl.searchParams.get("role");
  if (!["viewer", "camera"].includes(role)) {
    response.writeHead(400, apiHeaders());
    response.end(JSON.stringify({ error: "role must be viewer or camera" }));
    return true;
  }

  const requestedIdentity = requestUrl.searchParams.get("identity") || "";
  const safeIdentity = requestedIdentity.replace(/[^\w:.-]/g, "").slice(0, 100);
  const identity = role === "camera"
    ? (safeIdentity || `windows-webcam-${randomUUID()}`)
    : `viewer-${randomUUID()}`;
  const accessToken = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name: role === "camera" ? "Raspberry Pi Camera" : "Web Viewer",
    ttl: "1h",
  });
  accessToken.addGrant({
    room: LIVEKIT_ROOM,
    roomJoin: true,
    canPublish: role === "camera",
    canSubscribe: role === "viewer",
  });

  const token = await accessToken.toJwt();
  response.writeHead(200, apiHeaders());
  response.end(JSON.stringify({ serverUrl: LIVEKIT_URL, participantToken: token, roomName: LIVEKIT_ROOM }));
  return true;
}

async function serveAgoraToken(request, response) {
  const requestUrl = new URL(request.url, "http://localhost");
  if (requestUrl.pathname !== "/api/agora/token" || request.method !== "GET") return false;

  if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
    response.writeHead(503, apiHeaders());
    response.end(JSON.stringify({ error: "Agora is not configured on the server" }));
    return true;
  }

  const role = requestUrl.searchParams.get("role");
  if (!["viewer", "camera"].includes(role)) {
    response.writeHead(400, apiHeaders());
    response.end(JSON.stringify({ error: "role must be viewer or camera" }));
    return true;
  }

  const requestedUid = Number(requestUrl.searchParams.get("uid"));
  const hasRequestedUid = Number.isInteger(requestedUid) && requestedUid >= 1 && requestedUid <= 0xffffffff;
  const uid = role === "camera" || hasRequestedUid ? requestedUid : randomInt(1, 0xffffffff);
  if (!Number.isInteger(uid) || uid < 1 || uid > 0xffffffff) {
    response.writeHead(400, apiHeaders());
    response.end(JSON.stringify({ error: "A camera uid between 1 and 4294967295 is required" }));
    return true;
  }

  const expiresInSeconds = 3600;
  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    AGORA_CHANNEL,
    uid,
    role === "camera" ? AgoraRole.PUBLISHER : AgoraRole.SUBSCRIBER,
    expiresInSeconds,
    expiresInSeconds,
  );
  response.writeHead(200, apiHeaders());
  response.end(JSON.stringify({ appId: AGORA_APP_ID, channel: AGORA_CHANNEL, token, uid }));
  return true;
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS" && request.url.startsWith("/api/")) {
    response.writeHead(204, apiHeaders());
    response.end();
    return;
  }
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      piOnline,
      clients: wss.clients.size,
      supabaseConfigured: Boolean(supabase),
      livekitConfigured: Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET),
      agoraConfigured: Boolean(AGORA_APP_ID && AGORA_APP_CERTIFICATE),
    }));
    return;
  }
  try {
    if (await serveAgoraToken(request, response)) return;
    if (await serveLiveKitToken(request, response)) return;
    if (await serveCameras(request, response)) return;
  } catch (error) {
    console.error("Video API error:", error.message);
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Could not complete video request" }));
    return;
  }
  if (serveStatic(request, response)) return;
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});
const wss = new WebSocketServer({ server, path: "/ws" });

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}
function broadcast(payload) { for (const client of wss.clients) send(client, payload); }
function broadcastState() { broadcast({ type: "state", leds, piOnline, timestamp: new Date().toISOString() }); }
function controllerAuthorized(token) {
  return !CONTROLLER_TOKEN || token === CONTROLLER_TOKEN;
}

wss.on("connection", (socket) => {
  socket.id = randomUUID();
  socket.role = null;
  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });
  const authTimer = setTimeout(() => { if (!socket.role) socket.close(4001, "Authentication timeout"); }, 5000);

  socket.on("message", (raw) => {
    const parsed = parseMessage(raw);
    if (parsed.error) return send(socket, { type: "error", message: parsed.error });
    const message = parsed.message;
    if (!socket.role) {
      if (message.type !== "auth" || !["controller", "device"].includes(message.role)) return send(socket, { type: "error", message: "Authenticate first" });
      if (message.role === "controller" && !controllerAuthorized(message.token || "")) {
        send(socket, { type: "error", message: "Invalid token" });
        return socket.close(4003, "Unauthorized");
      }
      clearTimeout(authTimer);
      socket.role = message.role;
      if (socket.role === "device") piOnline = true;
      send(socket, { type: "authenticated", role: socket.role, clientId: socket.id });
      return broadcastState();
    }
    if (message.type === "get_state") return broadcastState();
    if (socket.role === "controller" && message.type === "set_led") {
      const value = validateSetLed(message);
      if (value.error) return send(socket, { type: "error", message: value.error });
      lastControlRefresh = Date.now();
      leds = applyControlCommand(leds, value.id, value.on);
      return broadcastState();
    }
    if (socket.role === "controller" && message.type === "set_all") {
      const value = validateSetAll(message);
      if (value.error) return send(socket, { type: "error", message: value.error });
      lastControlRefresh = Date.now();
      leds = leds.map((led) => ({ ...led, on: value.on }));
      return broadcastState();
    }
    if (socket.role === "device" && message.type === "applied") {
      return broadcast({ type: "device_applied", leds: message.leds || [], timestamp: new Date().toISOString() });
    }
    send(socket, { type: "error", message: "Unsupported message for this role" });
  });

  socket.on("close", () => {
    clearTimeout(authTimer);
    if (socket.role === "controller" && leds.some((control) => control.on)) {
      leds = initialState();
      broadcastState();
    }
    if (socket.role === "device") {
      piOnline = [...wss.clients].some((client) => client !== socket && client.role === "device");
      broadcastState();
    }
  });
});

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) { socket.terminate(); continue; }
    socket.isAlive = false;
    socket.ping();
  }
}, 30000);
const controlWatchdog = setInterval(() => {
  if (leds.some((control) => control.on) && Date.now() - lastControlRefresh > 1000) {
    leds = initialState();
    broadcastState();
  }
}, 250);
wss.on("close", () => {
  clearInterval(heartbeat);
  clearInterval(controlWatchdog);
});
server.listen(PORT, HOST, () => {
  console.log(`Controller: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);
});
