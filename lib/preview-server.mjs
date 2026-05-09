import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundlePageProject } from "./_bundle.mjs";
import { injectOverlay } from "./_inject.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY_PATH = path.join(__dirname, "preview-overlay.js");

export async function startPreviewServer({ pageDir, mode, keepaliveMs = 30000 }) {
  const token = crypto.randomBytes(32).toString("hex");

  const sseClients = new Set();

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
      try { res.write(payload); } catch {}
    }
  }

  const keepaliveTimer = setInterval(() => broadcast("keepalive", { ts: Date.now() }), keepaliveMs);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/") {
      if (url.searchParams.get("t") !== token) { res.writeHead(403).end(); return; }
      try {
        const bundled = bundlePageProject({ pageDir });
        const html = injectOverlay(bundled, { token, port: server.address().port, mode });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`bundle error: ${err.message}`);
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/__preview__/overlay.js") {
      if (url.searchParams.get("t") !== token) { res.writeHead(403).end(); return; }
      const body = fs.readFileSync(OVERLAY_PATH, "utf8");
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      res.end(body);
      return;
    }

    if (req.method === "GET" && url.pathname === "/__preview__/events") {
      if (url.searchParams.get("t") !== token) { res.writeHead(403).end(); return; }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      sseClients.add(res);
      res.write(`event: ready\ndata: {}\n\n`);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  return {
    token,
    address: server.address(),
    httpServer: server,
    broadcast,
    close: async () => {
      clearInterval(keepaliveTimer);
      for (const res of sseClients) { try { res.end(); } catch {} }
      sseClients.clear();
      await new Promise((r) => server.close(r));
    },
  };
}
