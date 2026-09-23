const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");
const { initialState, parseMessage, validateSetLed, validateSetAll } = require("./protocol");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || "";
const CONTROLLER_TOKEN = process.env.CONTROLLER_TOKEN || "";
let leds = initialState();
let piOnline = false;

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, piOnline, clients: wss.clients.size }));
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});
const wss = new WebSocketServer({ server, path: "/ws" });

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}
function broadcast(payload) { for (const client of wss.clients) send(client, payload); }
function broadcastState() { broadcast({ type: "state", leds, piOnline, timestamp: new Date().toISOString() }); }
function authorized(role, token) {
  const expected = role === "device" ? DEVICE_TOKEN : CONTROLLER_TOKEN;
  return !expected || token === expected;
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
      if (!authorized(message.role, message.token || "")) {
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
      leds = leds.map((led) => led.id === value.id ? { ...led, on: value.on } : led);
      return broadcastState();
    }
    if (socket.role === "controller" && message.type === "set_all") {
      const value = validateSetAll(message);
      if (value.error) return send(socket, { type: "error", message: value.error });
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
wss.on("close", () => clearInterval(heartbeat));
server.listen(PORT, HOST, () => console.log(`HTTP/WebSocket server listening on ${HOST}:${PORT}`));
