import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { startPreviewServer } from "../lib/preview-server.mjs";
import { connectSSE } from "./helpers/sse-client.mjs";

function tmpPageDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-test-"));
  fs.writeFileSync(path.join(dir, "index.html"), `<html><body><h1>Hi</h1></body></html>`);
  return dir;
}

function fetchRaw(port, pathWithQuery, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: pathWithQuery, method: "GET", headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => body += c);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("server binds 127.0.0.1 only on a random port", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({ pageDir, mode: "create" });
  assert.equal(server.address.address, "127.0.0.1");
  assert.ok(server.address.port > 0);
  await server.close();
});

test("GET / requires query token; 403 without", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({ pageDir, mode: "create" });
  const r = await fetchRaw(server.address.port, "/");
  assert.equal(r.status, 403);
  await server.close();
});

test("GET /?t=<token> returns bundled+injected HTML", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({ pageDir, mode: "create" });
  const r = await fetchRaw(server.address.port, `/?t=${server.token}`);
  assert.equal(r.status, 200);
  assert.match(r.body, /<h1>Hi<\/h1>/);
  assert.match(r.body, /window\.__CLAWPAGE_PREVIEW__/);
  await server.close();
});

test("GET / re-bundles on each request", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({ pageDir, mode: "create" });
  const before = await fetchRaw(server.address.port, `/?t=${server.token}`);
  fs.writeFileSync(path.join(pageDir, "index.html"), `<html><body><h1>Bye</h1></body></html>`);
  const after = await fetchRaw(server.address.port, `/?t=${server.token}`);
  assert.match(before.body, /<h1>Hi<\/h1>/);
  assert.match(after.body, /<h1>Bye<\/h1>/);
  await server.close();
});

test("GET /__preview__/overlay.js?t= returns 200 with content-type js", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({ pageDir, mode: "create" });
  const r = await fetchRaw(server.address.port, `/__preview__/overlay.js?t=${server.token}`);
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /application\/javascript/);
  assert.match(r.body, /clawpage-preview/);
  await server.close();
});

test("GET /__preview__/events with bad token returns 403", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({ pageDir, mode: "create" });
  const r = await fetchRaw(server.address.port, `/__preview__/events?t=wrong`);
  assert.equal(r.status, 403);
  await server.close();
});

test("SSE channel emits keepalive within 1s of subscribing", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({ pageDir, mode: "create", keepaliveMs: 200 });
  const sse = await connectSSE({ port: server.address.port, token: server.token });
  const ev = await sse.waitFor((e) => e.event === "keepalive", { timeoutMs: 1000 });
  assert.ok(ev.data.ts > 0);
  sse.close();
  await server.close();
});
