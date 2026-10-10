const http = require("node:http");
const { createReadStream, stat } = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || "127.0.0.1";
const FILES = {
  "/livekit/": ["livekit/index.html", "text/html; charset=utf-8"],
  "/livekit/index.html": ["livekit/index.html", "text/html; charset=utf-8"],
  "/livekit/app.js": ["livekit/app.js", "text/javascript; charset=utf-8"],
  "/agora/": ["agora/index.html", "text/html; charset=utf-8"],
  "/agora/index.html": ["agora/index.html", "text/html; charset=utf-8"],
  "/agora/app.js": ["agora/app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
};

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (["/", "/livekit", "/agora"].includes(pathname)) {
    const destination = pathname === "/agora" ? "/agora/" : "/livekit/";
    response.writeHead(302, { location: destination, "cache-control": "no-store" });
    response.end();
    return;
  }
  const entry = FILES[pathname];
  if (!entry || !["GET", "HEAD"].includes(request.method)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const [filename, contentType] = entry;
  const filePath = path.join(__dirname, filename);
  stat(filePath, (error, fileStat) => {
    if (error || !fileStat.isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
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
});

server.listen(PORT, HOST, () => {
  console.log(`LiveKit camera console: http://localhost:${PORT}/livekit/`);
  console.log(`Agora camera console:   http://localhost:${PORT}/agora/`);
});
