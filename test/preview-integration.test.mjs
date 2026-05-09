import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { startPreviewServer } from "../lib/preview-server.mjs";
import { connectSSE } from "./helpers/sse-client.mjs";

function tmpPageDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-int-"));
  fs.writeFileSync(path.join(dir, "index.html"),
    `<html><body><h1>Hi</h1>__DEFAULT_CSS____DEFAULT_JS__</body></html>`);
  return dir;
}

function postJSON(port, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request({ hostname: "127.0.0.1", port, path: p, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers } },
      (res) => {
        let buf = ""; res.setEncoding("utf8");
        res.on("data", (c) => buf += c);
        res.on("end", () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
      });
    req.on("error", reject); req.write(data); req.end();
  });
}

test("end-to-end: chat edit → reload → publish → navigate → whenPublished resolves", async () => {
  const pageDir = tmpPageDir();
  const claudeBin = path.resolve("test/fixtures/fake-claude.mjs");
  const server = await startPreviewServer({
    pageDir, mode: "create", claudeBinary: claudeBin,
    claudeEnv: { FAKE_CLAUDE_SCENARIO: "edit-success" },
    publishHandler: async () => ({
      ok: true, liveUrl: "https://example.test/p/xyz",
      successPayload: { ok: true, mode: "created", pageId: "p_xyz",
        url: "https://example.test/p/xyz",
        rootUrl: "https://example.test/p/xyz",
        publicUrl: "https://example.test/p/xyz",
        accessUrl: "https://example.test/p/xyz" },
    }),
  });

  const sse = await connectSSE({ port: server.address.port, token: server.token });
  const headers = { "X-Preview-Token": server.token };

  // 1. chat edit
  const chat = await postJSON(server.address.port, "/__preview__/chat",
    { message: "make heading red", toolsMode: "scoped" }, headers);
  assert.equal(chat.status, 202);

  await sse.waitFor((e) => e.event === "chat_done" && e.data.ok === true);
  await sse.waitFor((e) => e.event === "reload");

  // 2. publish
  const pub = await postJSON(server.address.port, "/__preview__/publish", {}, headers);
  assert.equal(pub.status, 202);

  await sse.waitFor((e) => e.event === "publish_done" && e.data.ok === true);
  const navEv = await sse.waitFor((e) => e.event === "navigate");
  assert.equal(navEv.data.url, "https://example.test/p/xyz");

  const result = await server.whenPublished;
  assert.equal(result.successPayload.pageId, "p_xyz");

  sse.close();
  await server.close();
});
