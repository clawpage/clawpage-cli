import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
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
  assert.match(r.body, /\/__preview__\/overlay\.js\?t=/);
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

function postJSON(port, pathStr, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1", port, path: pathStr, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers },
    }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => buf += c);
      res.on("end", () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
    });
    req.on("error", reject);
    req.write(data); req.end();
  });
}

test("POST /chat spawns fake claude and emits assistant_text → tool_use → tool_result → chat_done → reload", async () => {
  const pageDir = tmpPageDir();
  const claudeBin = path.resolve("test/fixtures/fake-claude.mjs");
  const server = await startPreviewServer({
    pageDir, mode: "create", keepaliveMs: 30000,
    claudeBinary: claudeBin, claudeEnv: { FAKE_CLAUDE_SCENARIO: "edit-success" },
  });
  const sse = await connectSSE({ port: server.address.port, token: server.token });

  const r = await postJSON(server.address.port, "/__preview__/chat",
    { message: "make heading red", toolsMode: "scoped" },
    { "X-Preview-Token": server.token });
  assert.equal(r.status, 202);
  assert.ok(r.body.requestId);

  const reqId = r.body.requestId;
  await sse.waitFor((e) => e.event === "assistant_text" && e.data.requestId === reqId);
  await sse.waitFor((e) => e.event === "tool_use" && e.data.name === "Edit");
  await sse.waitFor((e) => e.event === "tool_result");
  await sse.waitFor((e) => e.event === "chat_done" && e.data.ok === true);
  await sse.waitFor((e) => e.event === "reload");

  sse.close();
  await server.close();
});

test("POST /chat returns 403 without token", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({ pageDir, mode: "create",
    claudeBinary: path.resolve("test/fixtures/fake-claude.mjs") });
  const r = await postJSON(server.address.port, "/__preview__/chat", { message: "hi" });
  assert.equal(r.status, 403);
  await server.close();
});

test("Two concurrent POST /chat: second returns 409", async () => {
  const pageDir = tmpPageDir();
  const claudeBin = path.resolve("test/fixtures/fake-claude.mjs");
  const server = await startPreviewServer({
    pageDir, mode: "create",
    claudeBinary: claudeBin, claudeEnv: { FAKE_CLAUDE_SCENARIO: "hang" },
  });
  const headers = { "X-Preview-Token": server.token };
  const first = postJSON(server.address.port, "/__preview__/chat", { message: "hi", toolsMode: "scoped" }, headers);
  await sleep(100);
  const second = await postJSON(server.address.port, "/__preview__/chat", { message: "hi", toolsMode: "scoped" }, headers);
  assert.equal(second.status, 409);
  await server.close();
  await first.catch(() => {});
});

test("POST /chat/cancel SIGTERMs the in-flight subprocess", async () => {
  const pageDir = tmpPageDir();
  const claudeBin = path.resolve("test/fixtures/fake-claude.mjs");
  const server = await startPreviewServer({
    pageDir, mode: "create",
    claudeBinary: claudeBin, claudeEnv: { FAKE_CLAUDE_SCENARIO: "hang" },
  });
  const sse = await connectSSE({ port: server.address.port, token: server.token });
  const headers = { "X-Preview-Token": server.token };

  const r = await postJSON(server.address.port, "/__preview__/chat",
    { message: "hi", toolsMode: "scoped" }, headers);
  const reqId = r.body.requestId;

  await sleep(200); // let claude get going
  const c = await postJSON(server.address.port, "/__preview__/chat/cancel",
    { requestId: reqId }, headers);
  assert.equal(c.status, 200);

  await sse.waitFor((e) => e.event === "chat_done" && e.data.ok === false
                          && (e.data.error === "cancelled" || /signal/.test(String(e.data.error))));
  sse.close();
  await server.close();
});

test("Chat hangs >timeout: subprocess killed, chat_done emits timeout", async () => {
  const pageDir = tmpPageDir();
  const claudeBin = path.resolve("test/fixtures/fake-claude.mjs");
  const server = await startPreviewServer({
    pageDir, mode: "create",
    claudeBinary: claudeBin, claudeEnv: { FAKE_CLAUDE_SCENARIO: "hang" },
    chatTimeoutMs: 300,
  });
  const sse = await connectSSE({ port: server.address.port, token: server.token });
  const headers = { "X-Preview-Token": server.token };

  await postJSON(server.address.port, "/__preview__/chat",
    { message: "hi", toolsMode: "scoped" }, headers);
  const ev = await sse.waitFor((e) => e.event === "chat_done", { timeoutMs: 3000 });
  assert.equal(ev.data.ok, false);
  assert.match(String(ev.data.error), /timeout|signal/i);
  sse.close();
  await server.close();
});

test("POST /publish calls publish handler, broadcasts publish_done + navigate, resolves whenPublished", async () => {
  const pageDir = tmpPageDir();
  const calls = [];
  const server = await startPreviewServer({
    pageDir, mode: "create",
    publishHandler: async () => {
      calls.push("publish");
      return { ok: true, liveUrl: "https://example.test/p/abc",
        successPayload: { ok: true, mode: "created", pageId: "p_abc", url: "https://example.test/p/abc" } };
    },
  });
  const sse = await connectSSE({ port: server.address.port, token: server.token });
  const headers = { "X-Preview-Token": server.token };

  const r = await postJSON(server.address.port, "/__preview__/publish", {}, headers);
  assert.equal(r.status, 202);

  await sse.waitFor((e) => e.event === "publish_started");
  await sse.waitFor((e) => e.event === "publish_done" && e.data.ok === true);
  await sse.waitFor((e) => e.event === "navigate" && e.data.url === "https://example.test/p/abc");

  const result = await server.whenPublished;
  assert.deepEqual(result.successPayload, { ok: true, mode: "created", pageId: "p_abc", url: "https://example.test/p/abc" });

  assert.deepEqual(calls, ["publish"]);
  sse.close();
  await server.close();
});

test("POST /publish on failure: publish_done {ok:false}, server stays up", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({
    pageDir, mode: "create",
    publishHandler: async () => ({ ok: false, errorCode: "UNAUTHORIZED",
      errorMessage: "bad token", failurePayload: { ok: false, errorCode: "UNAUTHORIZED" } }),
  });
  const sse = await connectSSE({ port: server.address.port, token: server.token });
  const headers = { "X-Preview-Token": server.token };

  await postJSON(server.address.port, "/__preview__/publish", {}, headers);
  const ev = await sse.waitFor((e) => e.event === "publish_done");
  assert.equal(ev.data.ok, false);
  assert.equal(ev.data.errorCode, "UNAUTHORIZED");

  // server.whenPublished must NOT have resolved
  let resolved = false;
  Promise.resolve(server.whenPublished).then(() => resolved = true);
  await sleep(100);
  assert.equal(resolved, false);

  sse.close();
  await server.close();
});

test("POST /quit triggers server.whenAborted (after 5s grace + no SSE reconnect)", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({ pageDir, mode: "create" });
  const headers = { "X-Preview-Token": server.token };
  await postJSON(server.address.port, "/__preview__/quit", {}, headers);
  // Should NOT resolve immediately
  let resolvedFast = false;
  Promise.resolve(server.whenAborted).then(() => { resolvedFast = true; });
  await sleep(200);
  assert.equal(resolvedFast, false, "abort should respect 5s grace window");
  await server.close();
});

test("GET / on missing index.html returns 500 and broadcasts bundle_error", async () => {
  const pageDir = tmpPageDir();
  fs.unlinkSync(path.join(pageDir, "index.html"));
  const server = await startPreviewServer({ pageDir, mode: "create" });
  const sse = await connectSSE({ port: server.address.port, token: server.token });
  const r = await fetchRaw(server.address.port, `/?t=${server.token}`);
  assert.equal(r.status, 500);
  await sse.waitFor((e) => e.event === "bundle_error");
  sse.close();
  await server.close();
});

test("overlay.js contains FAB rendering and shadow root setup", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({ pageDir, mode: "create" });
  const r = await fetchRaw(server.address.port, `/__preview__/overlay.js?t=${server.token}`);
  assert.match(r.body, /attachShadow\(\s*\{\s*mode:\s*["']closed["']/);
  assert.match(r.body, /id="__clawpage_publish_fab__"|publish-fab/);
  assert.match(r.body, /id="__clawpage_chat_fab__"|chat-fab/);
  assert.match(r.body, /"token":/);
  await server.close();
});

test("overlay.js contains chat panel, transcript, settings cog, tools toggle markup", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({ pageDir, mode: "create" });
  const r = await fetchRaw(server.address.port, `/__preview__/overlay.js?t=${server.token}`);
  for (const m of [
    /id="chat-panel"/,
    /id="transcript"/,
    /id="cog"/,
    /id="tools-flyout"/,
    /value="scoped"/, /value="full"/,
    /id="chat-input"/,
    /id="send"/,
  ]) {
    assert.match(r.body, m, `missing ${m}`);
  }
  await server.close();
});

test("POST /quit also accepts ?t= query param (beacon path)", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({ pageDir, mode: "create" });
  // No header — only query param.
  await postJSON(server.address.port, `/__preview__/quit?t=${server.token}`, {});
  // Should NOT resolve immediately (5s grace window applies)
  let resolvedFast = false;
  Promise.resolve(server.whenAborted).then(() => { resolvedFast = true; });
  await sleep(200);
  assert.equal(resolvedFast, false, "abort should respect 5s grace window");
  await server.close();
});

test("/quit after publishLatched is a no-op (post-navigate beacon)", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({
    pageDir, mode: "create",
    publishHandler: async () => ({ ok: true, liveUrl: "https://x.test/p/1",
      successPayload: { ok: true } }),
  });
  const headers = { "X-Preview-Token": server.token };

  await postJSON(server.address.port, "/__preview__/publish", {}, headers);
  await server.whenPublished;

  await postJSON(server.address.port, "/__preview__/quit", {}, headers);
  await sleep(100);
  // whenAborted should NOT have resolved
  let aborted = false;
  Promise.resolve(server.whenAborted).then(() => { aborted = true; });
  await sleep(100);
  assert.equal(aborted, false);
  await server.close();
});

test("overlay.js token is substituted into the IIFE, not on window", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({ pageDir, mode: "create" });
  const r = await fetchRaw(server.address.port, `/__preview__/overlay.js?t=${server.token}`);
  // Token IS in the served body (substituted), but as the cfg literal, not on window.
  assert.match(r.body, new RegExp(`"token"\\s*:\\s*"${server.token}"`));
  // The placeholder is gone after substitution.
  assert.doesNotMatch(r.body, /__CLAWPAGE_PREVIEW_CONFIG__/);
  // Crucially: no window assignment.
  assert.doesNotMatch(r.body, /window\.__CLAWPAGE_PREVIEW__\s*=/);
  await server.close();
});

test("After first chat succeeds, second chat uses --resume (verified via fake-claude inspecting its argv)", async () => {
  const argvLog = path.join(os.tmpdir(), `claude-argv-${Date.now()}.log`);
  const wrapPath = path.join(os.tmpdir(), `claude-wrap-${Date.now()}.mjs`);
  const claudeBin = path.resolve("test/fixtures/fake-claude.mjs");
  fs.writeFileSync(wrapPath, `#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
fs.appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");
const r = spawnSync(${JSON.stringify(claudeBin)}, process.argv.slice(2), { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
`);
  fs.chmodSync(wrapPath, 0o755);

  const pageDir = tmpPageDir();
  const server = await startPreviewServer({
    pageDir, mode: "create",
    claudeBinary: wrapPath,
    claudeEnv: { FAKE_CLAUDE_SCENARIO: "edit-success" },
  });
  const sse = await connectSSE({ port: server.address.port, token: server.token });
  const headers = { "X-Preview-Token": server.token };

  // First chat — should use --session-id
  const r1 = await postJSON(server.address.port, "/__preview__/chat",
    { message: "msg 1", toolsMode: "scoped" }, headers);
  const reqId1 = r1.body.requestId;
  await sse.waitFor((e) => e.event === "chat_done" && e.data.requestId === reqId1, { timeoutMs: 5000 });

  // Second chat — should use --resume (because system/init in first chat flipped isFirstChat)
  const r2 = await postJSON(server.address.port, "/__preview__/chat",
    { message: "msg 2", toolsMode: "scoped" }, headers);
  const reqId2 = r2.body.requestId;
  await sse.waitFor((e) => e.event === "chat_done" && e.data.requestId === reqId2, { timeoutMs: 5000 });

  const lines = fs.readFileSync(argvLog, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("--session-id"), "first chat should use --session-id");
  assert.ok(lines[1].includes("--resume"), "second chat should use --resume");

  sse.close();
  await server.close();
  fs.unlinkSync(wrapPath);
  fs.unlinkSync(argvLog);
});
