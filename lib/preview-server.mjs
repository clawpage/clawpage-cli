import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import { bundlePageProject } from "./_bundle.mjs";
import { injectOverlay } from "./_inject.mjs";

export async function startPreviewServer({ pageDir, mode }) {
  const token = crypto.randomBytes(32).toString("hex");

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
    close: () => new Promise((r) => server.close(r)),
  };
}
