# Clawpage Preview Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive `clawpage preview` subcommand and skill-side prompts, so users can locally preview a clawpage page, refine it via in-browser chat with `claude -p`, and publish from a floating button — instead of jumping straight from create/update to publish.

**Architecture:** New CLI subcommand starts a localhost HTTP+SSE server that serves a bundled preview with an injected closed-Shadow-DOM overlay (two FABs + chat panel). Each chat message spawns one `claude -p --resume <uuid>` subprocess; stream-json output is parsed line-by-line and broadcast to the browser via SSE. Publish click reuses existing `publish.mjs` upload helpers. Skill prompts users to opt into preview each run.

**Tech Stack:** Node ≥18 ESM, Node `node:http` + `node:child_process` + `node:test`, Fastify-style mock backend in tests, `MemoryPageStore` pattern (mirrors backend test style). No new runtime deps.

---

## Phase A — Extraction & shared modules

### Task 1: Set up `node --test` infrastructure

**Files:**
- Create: `test/.gitkeep` (placeholder so directory commits)
- Modify: `package.json` (add `scripts.test`, add `test/` to npmignore concerns)

- [ ] **Step 1: Verify current package.json has no test script**

Run: `cd projects/clawpage-aio/clawpage-cli-wt/feat-preview && cat package.json | grep -A2 '"scripts"' || echo "no scripts block"`
Expected: no `scripts` block (or one without `test`).

- [ ] **Step 2: Add test script to package.json**

Edit `package.json`. Insert before the `"files"` field:

```json
  "scripts": {
    "test": "node --test --test-reporter=spec test/"
  },
```

- [ ] **Step 3: Create empty test directory placeholder**

```bash
mkdir -p test
touch test/.gitkeep
```

- [ ] **Step 4: Run npm test to verify infrastructure**

Run: `npm test`
Expected: PASS with "tests 0 / pass 0 / fail 0".

- [ ] **Step 5: Commit**

```bash
git add package.json test/.gitkeep
git commit -m "chore: add node --test runner script"
```

---

### Task 2: Add canned-output fake claude binary fixture

**Files:**
- Create: `test/fixtures/fake-claude.mjs`

- [ ] **Step 1: Write the fake claude binary**

`test/fixtures/fake-claude.mjs`:

```js
#!/usr/bin/env node
// Canned `claude -p` substitute for tests. Reads --session-id or --resume from
// argv, emits stream-json events on stdout, exits 0. The transcript is keyed
// off env var FAKE_CLAUDE_SCENARIO (default: "edit-success").

import process from "node:process";

const argv = process.argv.slice(2);
const idx = (k) => argv.indexOf(k);
const get = (k) => (idx(k) >= 0 ? argv[idx(k) + 1] : null);
const sessionId = get("--session-id") || get("--resume") || "00000000-0000-0000-0000-000000000000";

const scenario = process.env.FAKE_CLAUDE_SCENARIO || "edit-success";

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

if (scenario === "edit-success") {
  emit({ type: "system", subtype: "init", session_id: sessionId });
  emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Editing " } } });
  emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "index.html." } } });
  emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu_1", name: "Edit", input: { file_path: "index.html", old_string: "<h1>Hi</h1>", new_string: "<h1 class=\"text-red-500\">Hi</h1>" } }] } });
  emit({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok", is_error: false }] } });
  emit({ type: "result", subtype: "success", session_id: sessionId });
  process.exit(0);
} else if (scenario === "error") {
  emit({ type: "system", subtype: "init", session_id: sessionId });
  emit({ type: "result", subtype: "error_during_execution", session_id: sessionId });
  process.exit(1);
} else if (scenario === "hang") {
  emit({ type: "system", subtype: "init", session_id: sessionId });
  // Sleep forever — caller is expected to SIGTERM.
  setInterval(() => {}, 1 << 30);
} else {
  process.stderr.write(`unknown FAKE_CLAUDE_SCENARIO: ${scenario}\n`);
  process.exit(2);
}
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x test/fixtures/fake-claude.mjs
```

- [ ] **Step 3: Verify the fixture runs and emits valid JSON lines**

Run: `node test/fixtures/fake-claude.mjs --session-id abc | head -1 | node -e 'process.stdin.on("data", d => { JSON.parse(d.toString().trim()); console.log("ok"); })'`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/fake-claude.mjs
git commit -m "test: add fake-claude.mjs fixture for stream-json scenarios"
```

---

### Task 3: Extract `bundlePageProject` to `_bundle.mjs`

**Files:**
- Create: `lib/_bundle.mjs`
- Create: `test/_bundle.test.mjs`
- Modify: `lib/publish.mjs` (replace inline function with import; export the helpers preview will reuse)

- [ ] **Step 1: Write failing test for extracted module**

`test/_bundle.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { bundlePageProject } from "../lib/_bundle.mjs";

function tmpPageDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-test-"));
  return dir;
}

test("bundlePageProject inlines default.css and default.js when present", () => {
  const dir = tmpPageDir();
  fs.writeFileSync(path.join(dir, "index.html"),
    `<html><head><link href="default.css" rel="stylesheet"><script src="default.js"></script></head><body>__CONTENT_HTML__</body></html>`);
  fs.writeFileSync(path.join(dir, "default.css"), "h1{color:red;}");
  fs.writeFileSync(path.join(dir, "default.js"), "console.log('hi');");

  const html = bundlePageProject({ pageDir: dir });

  assert.match(html, /<style>\s*h1\{color:red;\}\s*<\/style>/);
  assert.match(html, /<script>\s*console\.log\('hi'\);\s*<\/script>/);
  assert.match(html, /__CONTENT_HTML__/, "CONTENT_HTML placeholder is left for caller");
});

test("bundlePageProject works without default.css/default.js", () => {
  const dir = tmpPageDir();
  fs.writeFileSync(path.join(dir, "index.html"),
    `<html><body>__DEFAULT_CSS__ __DEFAULT_JS__ x</body></html>`);
  const html = bundlePageProject({ pageDir: dir });
  assert.match(html, /<body>\s+x<\/body>/, "placeholders replaced with empty string");
});

test("bundlePageProject throws if index.html missing", () => {
  const dir = tmpPageDir();
  assert.throws(() => bundlePageProject({ pageDir: dir }), /index\.html not found/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../lib/_bundle.mjs'".

- [ ] **Step 3: Create `lib/_bundle.mjs` with extracted function**

`lib/_bundle.mjs`:

```js
import fs from "node:fs";
import path from "node:path";

export function bundlePageProject({ pageDir }) {
  const indexPath = path.join(pageDir, "index.html");
  const cssPath = path.join(pageDir, "default.css");
  const jsPath = path.join(pageDir, "default.js");

  if (!fs.existsSync(indexPath)) {
    throw new Error(`index.html not found in page dir: ${pageDir}`);
  }

  let html = fs.readFileSync(indexPath, "utf8");

  const hasDefaultCss = fs.existsSync(cssPath);
  const hasDefaultJs = fs.existsSync(jsPath);

  if (hasDefaultCss) {
    const css = fs.readFileSync(cssPath, "utf8");
    html = html.replaceAll("__DEFAULT_CSS__", css);
    html = html.replace(
      /<link[^>]*href=["'][^"']*default\.css["'][^>]*>/gi,
      `<style>\n${css}\n</style>`,
    );
  } else {
    html = html.replaceAll("__DEFAULT_CSS__", "");
  }

  if (hasDefaultJs) {
    const js = fs.readFileSync(jsPath, "utf8");
    html = html.replaceAll("__DEFAULT_JS__", js);
    html = html.replace(
      /<script[^>]*src=["'][^"']*default\.js["'][^>]*>\s*<\/script>/gi,
      `<script>\n${js}\n</script>`,
    );
  } else {
    html = html.replaceAll("__DEFAULT_JS__", "");
  }

  return html;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, 3 passing tests.

- [ ] **Step 5: Refactor `publish.mjs` to import from `_bundle.mjs`**

In `lib/publish.mjs`:
- Remove the entire local `function bundlePageProject({ pageDir }) {...}` definition (lines ~160–199).
- Add at the top of the file (after existing imports):

```js
import { bundlePageProject } from "./_bundle.mjs";
```

- Add `export` keywords to the helper functions preview will reuse, so the file reads:

```js
export function loadKeys(filePath) { ... }
export async function createPage({ apiHost, token, html, ttlMs, pageName, pagecode }) { ... }
export async function updatePage({ apiHost, token, pageId, html, ttlMs, pageName, pagecode }) { ... }
export function buildAccessUrl({ rootUrl, accessUrl, pagecode }) { ... }
export function buildSuccessSummary({ mode, pageId, publicUrl, rootUrl, accessUrl }) { ... }
export function buildFailureResult(err) { ... }
```

(`extractApiErrorCode`, `parseArgs`, `parseTtlArg` stay un-exported — they're internal.)

- [ ] **Step 6: Run a smoke check that publish.mjs still parses**

Run: `node --check lib/publish.mjs`
Expected: no output, exit 0.

- [ ] **Step 7: Run npm test to confirm nothing broke**

Run: `npm test`
Expected: PASS, 3 passing tests.

- [ ] **Step 8: Commit**

```bash
git add lib/_bundle.mjs lib/publish.mjs test/_bundle.test.mjs
git commit -m "refactor: extract bundlePageProject to _bundle.mjs and export publish helpers"
```

---

### Task 4: Implement `lib/_inject.mjs` (overlay injector)

**Files:**
- Create: `lib/_inject.mjs`
- Create: `test/_inject.test.mjs`

- [ ] **Step 1: Write failing test**

`test/_inject.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { injectOverlay } from "../lib/_inject.mjs";

const cfg = { token: "abc", port: 1234, mode: "create" };

test("injectOverlay inserts script tag before </body>", () => {
  const out = injectOverlay("<html><body><h1>Hi</h1></body></html>", cfg);
  assert.match(out, /window\.__CLAWPAGE_PREVIEW__\s*=/);
  assert.match(out, /<script src="\/__preview__\/overlay\.js\?t=abc"><\/script>\s*<\/body>/);
});

test("injectOverlay is idempotent", () => {
  const once = injectOverlay("<html><body></body></html>", cfg);
  const twice = injectOverlay(once, cfg);
  assert.equal(once, twice, "second injection should be a no-op");
});

test("injectOverlay appends if no </body>", () => {
  const out = injectOverlay("<html><body>no closer", cfg);
  assert.match(out, /<script src="\/__preview__\/overlay\.js/);
});

test("injectOverlay embeds mode in config block", () => {
  const out = injectOverlay("<html><body></body></html>", { ...cfg, mode: "update" });
  assert.match(out, /"mode":\s*"update"/);
});

test("injectOverlay JSON-escapes the token", () => {
  const out = injectOverlay("<html><body></body></html>", { ...cfg, token: "ab\"cd" });
  assert.match(out, /"token":\s*"ab\\"cd"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `_inject.mjs`**

`lib/_inject.mjs`:

```js
const MARKER = "<!-- __CLAWPAGE_PREVIEW_INJECTED__ -->";

export function injectOverlay(html, { token, port, mode }) {
  if (html.includes(MARKER)) return html;

  const config = JSON.stringify({ token, port, mode });
  const block = `${MARKER}
<script>window.__CLAWPAGE_PREVIEW__ = ${config};</script>
<script src="/__preview__/overlay.js?t=${encodeURIComponent(token)}"></script>`;

  if (html.includes("</body>")) {
    return html.replace("</body>", `${block}\n</body>`);
  }
  return html + "\n" + block;
}
```

- [ ] **Step 4: Run test**

Run: `npm test`
Expected: PASS, 5 + 3 = 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/_inject.mjs test/_inject.test.mjs
git commit -m "feat: add _inject.mjs overlay injector"
```

---

### Task 5: Implement `lib/_open-browser.mjs`

**Files:**
- Create: `lib/_open-browser.mjs`

- [ ] **Step 1: Implement (no test — wraps platform-specific child_process; covered by integration smoke)**

`lib/_open-browser.mjs`:

```js
import { spawn } from "node:child_process";

export function openBrowser(url) {
  const platform = process.platform;
  let cmd, args;
  if (platform === "darwin") {
    cmd = "open"; args = [url];
  } else if (platform === "win32") {
    cmd = "cmd"; args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open"; args = [url];
  }
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Smoke-check it parses**

Run: `node --check lib/_open-browser.mjs`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/_open-browser.mjs
git commit -m "feat: add cross-platform openBrowser helper"
```

---

## Phase B — Preview server

### Task 6: PreviewServer — bind, token auth, serve `/`

**Files:**
- Create: `lib/preview-server.mjs`
- Create: `test/helpers/sse-client.mjs`
- Create: `test/preview-server.test.mjs`

- [ ] **Step 1: Write the SSE test helper**

`test/helpers/sse-client.mjs`:

```js
import http from "node:http";

export function connectSSE({ port, token }) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: "127.0.0.1", port,
      path: `/__preview__/events?t=${encodeURIComponent(token)}`,
      headers: { "X-Preview-Token": token, Accept: "text/event-stream" },
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE got ${res.statusCode}`));
        return;
      }
      const events = [];
      const waiters = [];
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const ev = parseEventBlock(block);
          if (ev) {
            events.push(ev);
            const w = waiters.find((x) => x.match(ev));
            if (w) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); }
          }
        }
      });
      resolve({
        events,
        async waitFor(matchFn, { timeoutMs = 5000 } = {}) {
          const found = events.find(matchFn);
          if (found) return found;
          return new Promise((res2, rej2) => {
            const timer = setTimeout(() => rej2(new Error("SSE timeout")), timeoutMs);
            waiters.push({ match: matchFn, resolve: (e) => { clearTimeout(timer); res2(e); } });
          });
        },
        close: () => req.destroy(),
      });
    });
    req.on("error", reject);
  });
}

function parseEventBlock(block) {
  let event = "message", data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (!data) return null;
  try { return { event, data: JSON.parse(data) }; } catch { return { event, data }; }
}
```

- [ ] **Step 2: Write failing tests for token auth + GET /**

`test/preview-server.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { startPreviewServer } from "../lib/preview-server.mjs";

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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../lib/preview-server.mjs'".

- [ ] **Step 4: Implement minimal preview-server.mjs**

`lib/preview-server.mjs`:

```js
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
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS, 4 new + 8 prior = 12 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/preview-server.mjs test/helpers/sse-client.mjs test/preview-server.test.mjs
git commit -m "feat(preview): server skeleton — bind, token auth, GET / serves bundled+injected HTML"
```

---

### Task 7: PreviewServer — overlay.js asset + SSE `/events`

**Files:**
- Create: `lib/preview-overlay.js` (stub for now — full content lands in Task 13)
- Modify: `lib/preview-server.mjs`
- Modify: `test/preview-server.test.mjs`

- [ ] **Step 1: Add stub overlay.js**

`lib/preview-overlay.js`:

```js
// Clawpage preview overlay runtime. Full implementation lands in later tasks.
console.log("[clawpage-preview] overlay loaded", window.__CLAWPAGE_PREVIEW__);
```

- [ ] **Step 2: Write failing test for /__preview__/overlay.js + /__preview__/events**

Append to `test/preview-server.test.mjs`:

```js
import { connectSSE } from "./helpers/sse-client.mjs";

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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL on the three new tests (404 / no SSE).

- [ ] **Step 4: Implement overlay.js route + SSE `/events`**

In `lib/preview-server.mjs`, add `fs`/`path`/`fileURLToPath` imports and broadcast machinery:

```js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY_PATH = path.join(__dirname, "preview-overlay.js");
```

Extend `startPreviewServer` to accept `keepaliveMs` (default 30000) and add a broadcast registry:

```js
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
```

Inside the `http.createServer((req, res) => { ... })` handler, before the 404 fallthrough, add:

```js
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
```

Update the returned `close` to clear the keepalive timer and end SSE:

```js
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
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS, 3 new + 12 prior = 15 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/preview-overlay.js lib/preview-server.mjs test/preview-server.test.mjs
git commit -m "feat(preview): serve overlay.js asset and SSE /events with keepalive"
```

---

### Task 8: PreviewServer — `/chat` endpoint + stream-json parser

**Files:**
- Modify: `lib/preview-server.mjs`
- Modify: `test/preview-server.test.mjs`

- [ ] **Step 1: Write failing test using fake-claude binary**

Append to `test/preview-server.test.mjs`:

```js
import { setTimeout as sleep } from "node:timers/promises";

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
  // Cancel first via close so it doesn't hang the test.
  await server.close();
  await first.catch(() => {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL on three new tests (404 / no chat handler).

- [ ] **Step 3: Implement chat handler**

In `lib/preview-server.mjs`, add `crypto.randomUUID()` import is already there via `node:crypto`. Add `spawn`:

```js
import { spawn } from "node:child_process";
```

Extend `startPreviewServer` signature:

```js
export async function startPreviewServer({
  pageDir, mode, keepaliveMs = 30000,
  claudeBinary = "claude",
  claudeEnv = {},
  systemPromptAppend = "",
  pageId = null,
}) {
```

Add session + in-flight state at the top of the function:

```js
  const previewSessionId = crypto.randomUUID();
  let isFirstChat = true;
  let inFlight = null; // { requestId, child }

  function buildClaudeArgs({ message, toolsMode }) {
    const args = ["-p", message];
    if (isFirstChat) { args.push("--session-id", previewSessionId); }
    else { args.push("--resume", previewSessionId); }
    args.push("--output-format", "stream-json", "--include-partial-messages",
              "--add-dir", pageDir);
    if (systemPromptAppend) args.push("--append-system-prompt", systemPromptAppend);
    if (toolsMode === "full") {
      args.push("--dangerously-skip-permissions");
    } else {
      args.push("--allowedTools", "Edit,Read,Write,Glob,Grep",
                "--permission-mode", "bypassPermissions");
    }
    return args;
  }

  function parseStreamLine(line, requestId) {
    let obj;
    try { obj = JSON.parse(line); } catch { return; }
    if (!obj || !obj.type) return;
    if (obj.type === "stream_event" && obj.event?.type === "content_block_delta"
        && obj.event.delta?.type === "text_delta") {
      broadcast("assistant_text", { requestId, delta: obj.event.delta.text });
    } else if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
      for (const block of obj.message.content) {
        if (block.type === "tool_use") {
          broadcast("tool_use", { requestId, toolUseId: block.id, name: block.name, input: block.input });
        }
      }
    } else if (obj.type === "user" && Array.isArray(obj.message?.content)) {
      for (const block of obj.message.content) {
        if (block.type === "tool_result") {
          broadcast("tool_result", { requestId, toolUseId: block.tool_use_id,
            isError: !!block.is_error, content: block.content });
        }
      }
    }
    // result event handled at exit
  }
```

Add the route before the 404 fallthrough:

```js
    if (req.method === "POST" && url.pathname === "/__preview__/chat") {
      if (req.headers["x-preview-token"] !== token) { res.writeHead(403).end(); return; }
      if (inFlight) { res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "chat_in_flight" })); return; }
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (c) => body += c);
      req.on("end", () => {
        let parsed; try { parsed = JSON.parse(body); } catch {
          res.writeHead(400).end(); return;
        }
        const message = String(parsed.message || "");
        const toolsMode = parsed.toolsMode === "full" ? "full" : "scoped";
        const requestId = crypto.randomUUID();
        const args = buildClaudeArgs({ message, toolsMode });
        const child = spawn(claudeBinary, args, {
          cwd: pageDir, stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, ...claudeEnv },
        });
        inFlight = { requestId, child };
        isFirstChat = false;

        let stdoutBuf = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdoutBuf += chunk;
          let idx;
          while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
            const line = stdoutBuf.slice(0, idx).trim();
            stdoutBuf = stdoutBuf.slice(idx + 1);
            if (line) parseStreamLine(line, requestId);
          }
        });
        let stderrBuf = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (c) => stderrBuf += c);
        child.on("exit", (code) => {
          const ok = code === 0;
          broadcast("chat_done", { requestId, ok, error: ok ? undefined : (stderrBuf.trim() || `exit ${code}`) });
          if (ok) broadcast("reload", {});
          inFlight = null;
        });

        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ requestId }));
      });
      return;
    }
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, 3 new + 15 prior = 18 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/preview-server.mjs test/preview-server.test.mjs
git commit -m "feat(preview): POST /chat spawns claude, parses stream-json, broadcasts SSE events"
```

---

### Task 9: PreviewServer — `/chat/cancel` endpoint

**Files:**
- Modify: `lib/preview-server.mjs`
- Modify: `test/preview-server.test.mjs`

- [ ] **Step 1: Write failing test**

Append to `test/preview-server.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — no cancel handler.

- [ ] **Step 3: Implement /chat/cancel and wire cancel state**

In `lib/preview-server.mjs`, in the `inFlight` exit handler, distinguish cancel:

Replace the `child.on("exit", ...)` block above with:

```js
        let cancelled = false;
        child.on("exit", (code, signal) => {
          const ok = code === 0 && !cancelled;
          let error;
          if (cancelled) error = "cancelled";
          else if (!ok) error = stderrBuf.trim() || `exit ${code}` + (signal ? ` (${signal})` : "");
          broadcast("chat_done", { requestId, ok, error });
          if (ok) broadcast("reload", {});
          inFlight = null;
        });
        // expose the cancel hook
        inFlight.cancel = () => { cancelled = true;
          try { child.kill("SIGTERM"); } catch {}
          setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000);
        };
```

(Note: `inFlight.cancel` is set after `inFlight = { requestId, child }` — adjust by moving the assignment to after we have all callbacks; OR set `inFlight = { requestId, child, cancel: null }` and assign `inFlight.cancel = ...` later. Use the simpler form: capture into a local function and reference via closure.)

Cleaner version — replace the chat handler's spawn region with:

```js
        const child = spawn(claudeBinary, args, {
          cwd: pageDir, stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, ...claudeEnv },
        });
        let cancelled = false;
        const cancel = () => { cancelled = true;
          try { child.kill("SIGTERM"); } catch {}
          setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000);
        };
        inFlight = { requestId, child, cancel };
```

Add the cancel route before the 404 fallthrough:

```js
    if (req.method === "POST" && url.pathname === "/__preview__/chat/cancel") {
      if (req.headers["x-preview-token"] !== token) { res.writeHead(403).end(); return; }
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (c) => body += c);
      req.on("end", () => {
        let parsed; try { parsed = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
        if (inFlight && inFlight.requestId === parsed.requestId) inFlight.cancel();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, 1 new + 18 prior = 19 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/preview-server.mjs test/preview-server.test.mjs
git commit -m "feat(preview): POST /chat/cancel — SIGTERM with SIGKILL escalation"
```

---

### Task 10: PreviewServer — chat hang timeout

**Files:**
- Modify: `lib/preview-server.mjs`
- Modify: `test/preview-server.test.mjs`

- [ ] **Step 1: Write failing test**

Append to `test/preview-server.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — server hangs; test times out.

- [ ] **Step 3: Implement timeout**

In `lib/preview-server.mjs`, add `chatTimeoutMs = 120000` to the function signature options.

In the chat handler, after the `child.stdout.on("data", ...)` registration, set up the timeout:

```js
        let timer = null;
        const armTimer = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            cancelled = true; // reuse the cancel error path → emits chat_done
            try { child.kill("SIGTERM"); } catch {}
          }, chatTimeoutMs);
        };
        armTimer();
        child.stdout.on("data", () => armTimer()); // reset on each chunk
        child.on("exit", () => { if (timer) clearTimeout(timer); });
```

But we want a distinct "timeout" error label, not "cancelled". Refactor: track the cause:

```js
        let endCause = null; // "cancelled" | "timeout" | null
        const cancel = (cause = "cancelled") => {
          if (endCause) return;
          endCause = cause;
          try { child.kill("SIGTERM"); } catch {}
          setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000);
        };
        inFlight = { requestId, child, cancel };

        let timer = null;
        const armTimer = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => cancel("timeout"), chatTimeoutMs);
        };
        armTimer();
```

And update the exit handler:

```js
        child.on("exit", (code, signal) => {
          if (timer) clearTimeout(timer);
          const ok = code === 0 && !endCause;
          let error;
          if (endCause === "timeout") error = "timeout";
          else if (endCause === "cancelled") error = "cancelled";
          else if (!ok) error = stderrBuf.trim() || `exit ${code}` + (signal ? ` (${signal})` : "");
          broadcast("chat_done", { requestId, ok, error });
          if (ok) broadcast("reload", {});
          inFlight = null;
        });
```

Update the cancel route to call `inFlight.cancel("cancelled")`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, 1 new + 19 prior = 20 tests. The hang scenario test from Task 8 is now bounded too.

- [ ] **Step 5: Commit**

```bash
git add lib/preview-server.mjs test/preview-server.test.mjs
git commit -m "feat(preview): chat timeout (default 120s), distinct timeout vs cancelled error labels"
```

---

### Task 11: PreviewServer — `/publish` endpoint + `/quit`

**Files:**
- Modify: `lib/preview-server.mjs`
- Modify: `test/preview-server.test.mjs`

- [ ] **Step 1: Write failing test using a mock publish handler**

Append to `test/preview-server.test.mjs`:

```js
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

test("POST /quit triggers server.whenAborted", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({ pageDir, mode: "create" });
  const headers = { "X-Preview-Token": server.token };
  await postJSON(server.address.port, "/__preview__/quit", {}, headers);
  const reason = await server.whenAborted;
  assert.equal(reason, "quit");
  await server.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL on the three new tests.

- [ ] **Step 3: Implement /publish, /quit, and lifecycle promises**

In `lib/preview-server.mjs`, extend the function signature to accept `publishHandler` (default: throws "publishHandler not configured").

At the top of `startPreviewServer`, declare lifecycle promises:

```js
  let resolvePublished, resolveAborted;
  const whenPublished = new Promise((r) => resolvePublished = r);
  const whenAborted = new Promise((r) => resolveAborted = r);
```

Add `/publish` route (before 404):

```js
    if (req.method === "POST" && url.pathname === "/__preview__/publish") {
      if (req.headers["x-preview-token"] !== token) { res.writeHead(403).end(); return; }
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      (async () => {
        broadcast("publish_started", {});
        try {
          const result = await publishHandler({ pageDir, mode, pageId });
          if (result.ok) {
            broadcast("publish_done", { ok: true, liveUrl: result.liveUrl });
            broadcast("navigate", { url: result.liveUrl });
            resolvePublished(result);
          } else {
            broadcast("publish_done", { ok: false, errorCode: result.errorCode, errorMessage: result.errorMessage });
          }
        } catch (err) {
          broadcast("publish_done", { ok: false, errorCode: "PREVIEW_INTERNAL_ERROR",
            errorMessage: err instanceof Error ? err.message : String(err) });
        }
      })();
      return;
    }
```

Add `/quit` route:

```js
    if (req.method === "POST" && url.pathname === "/__preview__/quit") {
      if (req.headers["x-preview-token"] !== token) { res.writeHead(403).end(); return; }
      res.writeHead(200).end();
      resolveAborted("quit");
      return;
    }
```

Update return value:

```js
  return {
    token, address: server.address(), httpServer: server, broadcast,
    whenPublished, whenAborted,
    close: async () => { /* unchanged */ },
  };
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, 3 new + 20 prior = 23 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/preview-server.mjs test/preview-server.test.mjs
git commit -m "feat(preview): POST /publish + /quit, expose whenPublished/whenAborted promises"
```

---

### Task 12: PreviewServer — bundle_error SSE on bundle failure

**Files:**
- Modify: `lib/preview-server.mjs`
- Modify: `test/preview-server.test.mjs`

- [ ] **Step 1: Write failing test**

Append to `test/preview-server.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — no broadcast on bundle error.

- [ ] **Step 3: Update `GET /` to broadcast on failure**

In `lib/preview-server.mjs`, replace the `GET /` catch block:

```js
      try {
        const bundled = bundlePageProject({ pageDir });
        const html = injectOverlay(bundled, { token, port: server.address().port, mode });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        broadcast("bundle_error", { message: msg });
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`bundle error: ${msg}`);
      }
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, 1 new + 23 prior = 24 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/preview-server.mjs test/preview-server.test.mjs
git commit -m "feat(preview): broadcast bundle_error SSE event when GET / fails"
```

---

## Phase C — Browser overlay runtime

### Task 13: preview-overlay.js — Shadow DOM + two FABs (visible only)

**Files:**
- Modify: `lib/preview-overlay.js`
- Modify: `test/preview-server.test.mjs`

- [ ] **Step 1: Write a test asserting overlay.js contains the FAB rendering code**

Append to `test/preview-server.test.mjs`:

```js
test("overlay.js contains FAB rendering and shadow root setup", async () => {
  const pageDir = tmpPageDir();
  const server = await startPreviewServer({ pageDir, mode: "create" });
  const r = await fetchRaw(server.address.port, `/__preview__/overlay.js?t=${server.token}`);
  assert.match(r.body, /attachShadow\(\s*\{\s*mode:\s*["']closed["']/);
  assert.match(r.body, /id="__clawpage_publish_fab__"|publish-fab/);
  assert.match(r.body, /id="__clawpage_chat_fab__"|chat-fab/);
  assert.match(r.body, /window\.__CLAWPAGE_PREVIEW__/);
  await server.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — overlay.js is still a stub.

- [ ] **Step 3: Replace `lib/preview-overlay.js` with FAB scaffolding**

`lib/preview-overlay.js`:

```js
(function () {
  const cfg = window.__CLAWPAGE_PREVIEW__;
  if (!cfg || !cfg.token) { console.error("[clawpage-preview] missing config"); return; }

  const host = document.createElement("div");
  host.id = "__clawpage_preview_root__";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "closed" });

  const STYLE = `
    :host, *, *::before, *::after { box-sizing: border-box; }
    .fab-stack { position: fixed; right: 20px; bottom: 20px; display: flex; flex-direction: column; gap: 12px; z-index: 2147483600; }
    .fab { width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
           display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 20px rgba(0,0,0,0.18);
           transition: transform .12s ease, box-shadow .12s ease; }
    .fab:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.22); }
    .fab-publish { background: #2563eb; color: white; width: 60px; height: 60px; }
    .fab-chat { background: #f3f4f6; color: #111827; }
    .fab svg { width: 24px; height: 24px; }
    .badge { position: fixed; top: 14px; right: 14px; background: rgba(17,24,39,.85); color: #f9fafb;
             padding: 6px 10px; border-radius: 999px; font: 500 12px/1 -apple-system,system-ui,sans-serif;
             z-index: 2147483600; display: flex; align-items: center; gap: 8px; }
    .badge button { background: transparent; border: 0; color: inherit; cursor: pointer; padding: 0 0 0 4px; }
  `;

  const PAPER_PLANE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  const CHAT_BUBBLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

  shadow.innerHTML = `
    <style>${STYLE}</style>
    <div class="badge">Clawpage preview · localhost:${cfg.port}<button id="badge-x" aria-label="dismiss">×</button></div>
    <div class="fab-stack">
      <button id="__clawpage_chat_fab__" class="fab fab-chat" aria-label="Chat with Claude">${CHAT_BUBBLE}</button>
      <button id="__clawpage_publish_fab__" class="fab fab-publish" aria-label="Publish">${PAPER_PLANE}</button>
    </div>
  `;

  shadow.getElementById("badge-x").addEventListener("click", () => {
    const b = shadow.querySelector(".badge"); if (b) b.remove();
  });
  // FAB click handlers wired in later tasks.
})();
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, 1 new + 24 prior = 25 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/preview-overlay.js test/preview-server.test.mjs
git commit -m "feat(preview): overlay.js renders shadow-DOM hosted FABs and session badge"
```

---

### Task 14: preview-overlay.js — chat panel with transcript + tools toggle

**Files:**
- Modify: `lib/preview-overlay.js`
- Modify: `test/preview-server.test.mjs`

- [ ] **Step 1: Write test asserting chat panel markup is present**

Append to `test/preview-server.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Extend overlay with chat panel**

In `lib/preview-overlay.js`, replace the existing `STYLE` constant with extended styles, and replace `shadow.innerHTML = ...` with a richer panel. Final state of the IIFE body:

```js
  const STYLE = `
    :host, *, *::before, *::after { box-sizing: border-box; }
    .fab-stack { position: fixed; right: 20px; bottom: 20px; display: flex; flex-direction: column; gap: 12px; z-index: 2147483600; }
    .fab { width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
           display: flex; align-items: center; justify-content: center;
           box-shadow: 0 6px 20px rgba(0,0,0,0.18); transition: transform .12s ease, box-shadow .12s ease; }
    .fab:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.22); }
    .fab[disabled] { opacity: 0.5; cursor: not-allowed; }
    .fab-publish { background: #2563eb; color: white; width: 60px; height: 60px; }
    .fab-chat { background: #f3f4f6; color: #111827; }
    .fab svg { width: 24px; height: 24px; }
    .badge { position: fixed; top: 14px; right: 14px; background: rgba(17,24,39,.85); color: #f9fafb;
             padding: 6px 10px; border-radius: 999px;
             font: 500 12px/1 -apple-system,system-ui,sans-serif; z-index: 2147483600;
             display: flex; align-items: center; gap: 8px; }
    .badge button { background: transparent; border: 0; color: inherit; cursor: pointer; padding: 0 0 0 4px; }
    .panel { position: fixed; right: 20px; bottom: 100px; width: 380px; max-height: 70vh;
             background: white; color: #111827; border-radius: 16px;
             box-shadow: 0 24px 60px rgba(0,0,0,0.25); display: none; flex-direction: column;
             font: 14px/1.5 -apple-system,system-ui,sans-serif; z-index: 2147483600;
             overflow: hidden; }
    .panel.open { display: flex; }
    .panel-header { display: flex; align-items: center; gap: 8px; padding: 12px 14px;
                    border-bottom: 1px solid #e5e7eb; }
    .panel-header .title { flex: 1; font-weight: 600; }
    .panel-header .mode-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px;
                                background: #e5e7eb; color: #374151; }
    .panel-header .mode-badge[data-mode="full"] { background: #fef3c7; color: #92400e; }
    .panel-header button { background: transparent; border: 0; cursor: pointer; padding: 4px;
                           color: #6b7280; }
    .panel-header button:hover { color: #111827; }
    .flyout { position: absolute; right: 12px; top: 48px; background: white; border: 1px solid #e5e7eb;
              border-radius: 12px; padding: 12px; width: 260px; box-shadow: 0 8px 20px rgba(0,0,0,0.12);
              display: none; z-index: 2147483601; }
    .flyout.open { display: block; }
    .flyout label { display: flex; gap: 8px; padding: 6px 0; cursor: pointer; }
    .flyout .warn { font-size: 12px; color: #92400e; margin-top: 8px; line-height: 1.4; }
    .transcript { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
    .turn { max-width: 85%; padding: 8px 12px; border-radius: 14px; word-wrap: break-word; white-space: pre-wrap; }
    .turn.user { align-self: flex-end; background: #2563eb; color: white; }
    .turn.assistant { align-self: flex-start; background: #f3f4f6; color: #111827; }
    .turn.assistant .caret { display: inline-block; width: 6px; height: 14px; vertical-align: -2px;
                             background: currentColor; opacity: .6; animation: blink 1s step-end infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    .tool { align-self: flex-start; font-size: 12px; color: #6b7280; padding: 4px 8px;
            background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; }
    .tool[data-error="true"] { color: #b91c1c; background: #fef2f2; border-color: #fecaca; }
    .tool .body { display: none; margin-top: 6px; font-family: ui-monospace, monospace;
                  white-space: pre-wrap; max-height: 200px; overflow: auto; }
    .tool.open .body { display: block; }
    .input-row { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e5e7eb; }
    .input-row textarea { flex: 1; min-height: 36px; max-height: 120px; resize: none;
                          border: 1px solid #d1d5db; border-radius: 8px; padding: 8px;
                          font: inherit; }
    .input-row button { padding: 0 14px; border: 0; border-radius: 8px; cursor: pointer;
                        background: #2563eb; color: white; font-weight: 600; }
    .input-row button[disabled] { opacity: .5; cursor: not-allowed; }
    .input-row .cancel { background: #ef4444; }
    .toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 24px;
             background: #111827; color: white; padding: 10px 18px; border-radius: 10px;
             font: 14px -apple-system,system-ui,sans-serif; z-index: 2147483602;
             opacity: 0; transition: opacity .2s ease; }
    .toast.show { opacity: 1; }
  `;

  const PAPER_PLANE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  const CHAT_BUBBLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const COG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.6l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;

  shadow.innerHTML = `
    <style>${STYLE}</style>
    <div class="badge">Clawpage preview · localhost:${cfg.port}<button id="badge-x" aria-label="dismiss">×</button></div>
    <div class="fab-stack">
      <button id="__clawpage_chat_fab__" class="fab fab-chat" aria-label="Chat with Claude">${CHAT_BUBBLE}</button>
      <button id="__clawpage_publish_fab__" class="fab fab-publish" aria-label="${cfg.mode === 'update' ? 'Republish' : 'Publish'}">${PAPER_PLANE}</button>
    </div>
    <div class="panel" id="chat-panel" role="dialog" aria-modal="false" aria-label="Chat with Claude">
      <div class="panel-header">
        <div class="title">Chat with Claude</div>
        <span id="mode-badge" class="mode-badge" data-mode="scoped">Edits</span>
        <button id="cog" aria-label="Settings">${COG}</button>
        <button id="close-panel" aria-label="Close">×</button>
        <div class="flyout" id="tools-flyout">
          <div style="font-weight:600;margin-bottom:6px">Tools</div>
          <label><input type="radio" name="tools" value="scoped" checked> Edits only (recommended)</label>
          <label><input type="radio" name="tools" value="full"> Full Claude (Bash, network, MCP)</label>
          <div class="warn">Full Claude lets the assistant run shell commands and fetch URLs on your machine. Resets to Edits only when preview restarts.</div>
        </div>
      </div>
      <div class="transcript" id="transcript"></div>
      <div class="input-row">
        <textarea id="chat-input" placeholder="Tell Claude what to change… (Enter to send, Shift+Enter for newline)"></textarea>
        <button id="send">Send</button>
      </div>
    </div>
  `;

  // toggle panel
  const panel = shadow.getElementById("chat-panel");
  shadow.getElementById("__clawpage_chat_fab__").addEventListener("click", () => {
    panel.classList.toggle("open");
  });
  shadow.getElementById("close-panel").addEventListener("click", () => panel.classList.remove("open"));
  shadow.getElementById("badge-x").addEventListener("click", () => {
    const b = shadow.querySelector(".badge"); if (b) b.remove();
  });

  // tools flyout
  const cog = shadow.getElementById("cog");
  const flyout = shadow.getElementById("tools-flyout");
  const modeBadge = shadow.getElementById("mode-badge");
  cog.addEventListener("click", (e) => { e.stopPropagation(); flyout.classList.toggle("open"); });
  for (const r of shadow.querySelectorAll('input[name="tools"]')) {
    r.addEventListener("change", (e) => {
      const v = e.target.value;
      if (v === "full" && !confirm("Full Claude lets the assistant run shell commands. Continue?")) {
        shadow.querySelector('input[name="tools"][value="scoped"]').checked = true;
        return;
      }
      modeBadge.dataset.mode = v;
      modeBadge.textContent = v === "full" ? "Full" : "Edits";
    });
  }
})();
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, 1 new + 25 prior = 26 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/preview-overlay.js test/preview-server.test.mjs
git commit -m "feat(preview): chat panel UI — transcript, settings cog, tools-mode toggle"
```

---

### Task 15: preview-overlay.js — wire SSE + send chat + render events

**Files:**
- Modify: `lib/preview-overlay.js`

(No new test — overlay-side behavior is exercised by Task 16's integration test.)

- [ ] **Step 1: Append SSE wiring + send handler at the bottom of the IIFE body**

Add inside the IIFE in `lib/preview-overlay.js`, after the current code:

```js
  // ---------- runtime state ----------
  const transcript = shadow.getElementById("transcript");
  const sendBtn = shadow.getElementById("send");
  const input = shadow.getElementById("chat-input");
  const publishBtn = shadow.getElementById("__clawpage_publish_fab__");
  const fabBadge = document.createElement("span");

  let activeRequestId = null;
  let activeAssistantTurn = null;
  const toolEls = new Map();

  function append(el) { transcript.appendChild(el); transcript.scrollTop = transcript.scrollHeight; }
  function turn(role, text) {
    const d = document.createElement("div");
    d.className = "turn " + role;
    d.textContent = text;
    return d;
  }
  function toolRow(name, input) {
    const d = document.createElement("div");
    d.className = "tool";
    const summary = name === "Edit" || name === "Write"
      ? `${name === "Edit" ? "✎ Edited" : "✚ Wrote"} ${input?.file_path || ""}`
      : `🔧 ${name}`;
    d.innerHTML = `<div class="summary">${summary}</div><div class="body"></div>`;
    d.addEventListener("click", () => d.classList.toggle("open"));
    d.querySelector(".body").textContent = JSON.stringify(input, null, 2);
    return d;
  }
  function showToast(text) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 250); }, 1500);
  }

  function modeNow() {
    return shadow.querySelector('input[name="tools"]:checked')?.value || "scoped";
  }

  async function send() {
    const message = input.value.trim();
    if (!message || activeRequestId) return;
    append(turn("user", message));
    input.value = "";
    sendBtn.disabled = true;
    publishBtn.disabled = true;
    activeAssistantTurn = turn("assistant", "");
    const caret = document.createElement("span"); caret.className = "caret";
    activeAssistantTurn.appendChild(caret);
    append(activeAssistantTurn);

    try {
      const res = await fetch("/__preview__/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Preview-Token": cfg.token },
        body: JSON.stringify({ message, toolsMode: modeNow() }),
      });
      const j = await res.json();
      if (res.status === 202) activeRequestId = j.requestId;
      else { activeAssistantTurn.textContent = `(error: ${j.error || res.status})`; resetState(); }
    } catch (err) {
      activeAssistantTurn.textContent = `(error: ${err.message})`;
      resetState();
    }
  }
  function resetState() {
    activeRequestId = null; activeAssistantTurn = null; toolEls.clear();
    sendBtn.disabled = false; publishBtn.disabled = false;
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // ---------- SSE ----------
  const es = new EventSource(`/__preview__/events?t=${encodeURIComponent(cfg.token)}`);
  es.addEventListener("assistant_text", (e) => {
    const data = JSON.parse(e.data);
    if (data.requestId !== activeRequestId || !activeAssistantTurn) return;
    const caret = activeAssistantTurn.querySelector(".caret");
    activeAssistantTurn.insertBefore(document.createTextNode(data.delta), caret);
  });
  es.addEventListener("tool_use", (e) => {
    const data = JSON.parse(e.data);
    if (data.requestId !== activeRequestId) return;
    const row = toolRow(data.name, data.input);
    toolEls.set(data.toolUseId, row);
    append(row);
  });
  es.addEventListener("tool_result", (e) => {
    const data = JSON.parse(e.data);
    const row = toolEls.get(data.toolUseId);
    if (!row) return;
    if (data.isError) { row.dataset.error = "true"; row.classList.add("open"); }
  });
  es.addEventListener("chat_done", (e) => {
    const data = JSON.parse(e.data);
    if (data.requestId !== activeRequestId) return;
    if (activeAssistantTurn) {
      const caret = activeAssistantTurn.querySelector(".caret");
      if (caret) caret.remove();
      if (!data.ok) { activeAssistantTurn.textContent += `\n(error: ${data.error || "unknown"})`; }
    }
    resetState();
  });
  es.addEventListener("reload", () => {
    showToast("Page updated");
    setTimeout(() => location.reload(), 300);
  });
```

- [ ] **Step 2: Verify the JS at least parses**

Run: `node --check lib/preview-overlay.js` (note: this is a browser file using `document`/`window`, but `node --check` only does a syntax check — should pass.)
Expected: no output, exit 0.

- [ ] **Step 3: Run tests (sanity)**

Run: `npm test`
Expected: PASS, 26 prior tests.

- [ ] **Step 4: Commit**

```bash
git add lib/preview-overlay.js
git commit -m "feat(preview): wire chat send + EventSource handlers (assistant_text, tool_use, tool_result, chat_done, reload)"
```

---

### Task 16: preview-overlay.js — wire publish button + navigate

**Files:**
- Modify: `lib/preview-overlay.js`

- [ ] **Step 1: Append publish + navigate handlers inside the IIFE**

Add at the end of the IIFE in `lib/preview-overlay.js`, after the SSE handlers:

```js
  publishBtn.addEventListener("click", async () => {
    if (publishBtn.disabled) return;
    publishBtn.disabled = true;
    sendBtn.disabled = true;
    showToast("Publishing…");
    try {
      const res = await fetch("/__preview__/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Preview-Token": cfg.token },
      });
      if (res.status !== 202) {
        const j = await res.json().catch(() => ({}));
        showToast(`Publish error: ${j.error || res.status}`);
        publishBtn.disabled = false; sendBtn.disabled = false;
      }
    } catch (err) {
      showToast(`Publish error: ${err.message}`);
      publishBtn.disabled = false; sendBtn.disabled = false;
    }
  });

  es.addEventListener("publish_started", () => { showToast("Publishing…"); });
  es.addEventListener("publish_done", (e) => {
    const data = JSON.parse(e.data);
    if (data.ok) { showToast("Published! Redirecting…"); }
    else {
      showToast(`Publish failed: ${data.errorCode || "error"}`);
      publishBtn.disabled = false; sendBtn.disabled = false;
      // open chat panel and surface error so user can see/retry
      panel.classList.add("open");
      const errTurn = document.createElement("div");
      errTurn.className = "turn assistant";
      errTurn.textContent = `Publish failed: ${data.errorCode || ""} ${data.errorMessage || ""}`.trim();
      append(errTurn);
    }
  });
  es.addEventListener("navigate", (e) => {
    const data = JSON.parse(e.data);
    setTimeout(() => { window.location.href = data.url; }, 800);
  });

  // tab close → best-effort quit
  window.addEventListener("pagehide", () => {
    try {
      navigator.sendBeacon("/__preview__/quit?t=" + encodeURIComponent(cfg.token), "");
    } catch {}
  });

  // restore transcript across reloads
  const TRANSCRIPT_KEY = "__clawpage_preview_transcript__";
  try {
    const prev = sessionStorage.getItem(TRANSCRIPT_KEY);
    if (prev) transcript.innerHTML = prev;
  } catch {}
  window.addEventListener("beforeunload", () => {
    try { sessionStorage.setItem(TRANSCRIPT_KEY, transcript.innerHTML); } catch {}
  });
```

- [ ] **Step 2: Smoke parse-check**

Run: `node --check lib/preview-overlay.js`
Expected: no output, exit 0.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS, 26 tests.

- [ ] **Step 4: Commit**

```bash
git add lib/preview-overlay.js
git commit -m "feat(preview): wire publish button, navigate redirect, sendBeacon on tab close, transcript persistence"
```

---

## Phase D — Subcommand entry point

### Task 17: preview.mjs — args, lifecycle, exit codes

**Files:**
- Create: `lib/preview.mjs`
- Create: `test/preview-args.test.mjs`

- [ ] **Step 1: Write failing test for arg parsing + help**

`test/preview-args.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

const PREVIEW = path.resolve("lib/preview.mjs");

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [PREVIEW, ...args], {
      env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", (c) => out += c);
    child.stderr.on("data", (c) => err += c);
    child.on("exit", (code) => resolve({ code, out, err }));
  });
}

test("preview --help prints usage with --page-dir and --page-id", async () => {
  const r = await run(["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /--page-dir/);
  assert.match(r.out, /--page-id/);
  assert.match(r.out, /--ttl-ms/);
});

test("preview without --page-dir exits non-zero with PAGE_DIR_REQUIRED", async () => {
  const r = await run([]);
  assert.notEqual(r.code, 0);
  const j = JSON.parse(r.out);
  assert.equal(j.ok, false);
  assert.equal(j.errorCode, "PAGE_DIR_REQUIRED");
});

test("preview with missing claude binary exits PREVIEW_CLAUDE_NOT_FOUND", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-args-"));
  fs.writeFileSync(path.join(dir, "index.html"), `<html><body>x</body></html>`);
  const r = await run(["--page-dir", dir], { CLAWPAGE_PREVIEW_CLAUDE_BIN: "/nonexistent/claude-binary-xyz" });
  assert.notEqual(r.code, 0);
  const j = JSON.parse(r.out);
  assert.equal(j.errorCode, "PREVIEW_CLAUDE_NOT_FOUND");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — preview.mjs not found.

- [ ] **Step 3: Implement preview.mjs entry**

`lib/preview.mjs`:

```js
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { startPreviewServer } from "./preview-server.mjs";
import { openBrowser } from "./_open-browser.mjs";
import { resolveKeysPath, resolvePageDir } from "./_workspace.mjs";
import {
  loadKeys, createPage, updatePage, buildAccessUrl, buildSuccessSummary, buildFailureResult,
} from "./publish.mjs";
import { bundlePageProject } from "./_bundle.mjs";

const DEFAULT_API_HOST = "https://api.clawpage.ai";
const DEFAULT_CREATE_TTL_MS = 21600000;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const k = t.slice(2);
    const n = argv[i + 1];
    if (!n || n.startsWith("--")) { args[k] = true; continue; }
    args[k] = n; i += 1;
  }
  return args;
}

function printHelp() {
  console.log(
    [
      "Usage: clawpage preview --page-dir <dir> [options]",
      "",
      "Starts a localhost server with an interactive preview of a clawpage page,",
      "opens the browser, and blocks until the user clicks Publish (or aborts).",
      "",
      "Options:",
      "  --page-dir <path>     publish an existing page project directory (required)",
      "  --page-id <id>        update an existing page; publish-click PATCHes",
      "  --title <text>        page_name fallback if --page-name is not given",
      "  --page-name <text>    page_name payload",
      "  --ttl-ms <number|null>  default 21600000 (6h), null = permanent",
      "  --pagecode <text|null>  set/remove URL access code",
      "  --keys-file <path>",
      "  --api-host <url>",
      "  --help",
    ].join("\n"),
  );
}

function emitFailure(errorCode, errorMessage) {
  console.log(JSON.stringify({ ok: false, errorCode, errorMessage }, null, 2));
}

function loadDesignGuidelines() {
  const home = os.homedir();
  const candidate = path.join(home, ".clawpage", "skill-repo", "references", "design-guidelines.md");
  try { return fs.readFileSync(candidate, "utf8"); }
  catch { return null; }
}

const SYSTEM_PROMPT_BASE = `You are editing a Clawpage single-file HTML page in the current directory. Files: index.html (preserve __CONTENT_HTML__/__DEFAULT_CSS__/__DEFAULT_JS__ placeholders), default.css, default.js, meta.md (do not touch metadata.page_id). Edit the appropriate file(s) and explain what you changed in 1-3 sentences. Keep edits minimal and focused on the user's request.`;

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); process.exit(0); }

  const pageDirArg = args["page-dir"] ? String(args["page-dir"]) : "";
  if (!pageDirArg) {
    emitFailure("PAGE_DIR_REQUIRED", "--page-dir is required");
    process.exit(2);
  }
  const pageDir = resolvePageDir(pageDirArg);
  if (!fs.existsSync(path.join(pageDir, "index.html"))) {
    emitFailure("PAGE_INDEX_MISSING", `index.html not found in ${pageDir}`);
    process.exit(2);
  }

  // Pre-flight: bundle once to surface obvious errors before binding port.
  try { bundlePageProject({ pageDir }); }
  catch (err) {
    emitFailure("PAGE_BUNDLE_FAILED", err.message);
    process.exit(2);
  }

  const pageId = args["page-id"] ? String(args["page-id"]) : null;
  const mode = pageId ? "update" : "create";
  const designGuidelines = loadDesignGuidelines();
  const systemPromptAppend = designGuidelines
    ? `${SYSTEM_PROMPT_BASE}\n\n${designGuidelines}`
    : SYSTEM_PROMPT_BASE;

  const publishHandler = async () => {
    const keysFile = resolveKeysPath(args["keys-file"]);
    let token, keyApiHost;
    try { ({ token, apiHost: keyApiHost } = loadKeys(keysFile)); }
    catch (err) {
      const fail = buildFailureResult(err);
      return { ok: false, errorCode: fail.errorCode, errorMessage: fail.errorMessage,
               failurePayload: fail };
    }
    const apiHost = String(args["api-host"] || keyApiHost || DEFAULT_API_HOST);
    const html = bundlePageProject({ pageDir });
    const title = String(args.title || path.basename(pageDir));
    const pageName = typeof args["page-name"] === "string"
      ? String(args["page-name"]) : (pageId ? undefined : title);
    const ttlArg = args["ttl-ms"];
    let ttlMs;
    if (ttlArg === undefined) ttlMs = pageId ? undefined : DEFAULT_CREATE_TTL_MS;
    else if (String(ttlArg) === "null") ttlMs = null;
    else ttlMs = Number(ttlArg);
    const pagecodeRaw = args.pagecode !== undefined ? args.pagecode : args.password;
    const pagecode = pagecodeRaw === undefined
      ? undefined
      : String(pagecodeRaw) === "null" ? null : String(pagecodeRaw);

    try {
      const data = pageId
        ? await updatePage({ apiHost, token, pageId, html, ttlMs, pageName, pagecode })
        : await createPage({ apiHost, token, html, ttlMs, pageName, pagecode });
      const page = data?.page || data || {};
      const rootUrl = page.rootUrl || data?.rootUrl || null;
      const publicUrl = page.publicUrl || data?.publicUrl || null;
      const returnedPagecode = typeof data?.pagecode === "string" ? data.pagecode : null;
      const resolvedPagecode = pagecode !== undefined ? pagecode : returnedPagecode;
      const accessUrl = buildAccessUrl({
        rootUrl, accessUrl: data?.accessUrl || null,
        pagecode: typeof resolvedPagecode === "string" ? resolvedPagecode : null,
      });
      const liveUrl = publicUrl || accessUrl || rootUrl;
      const successPayload = {
        ok: true,
        mode: pageId ? "updated" : "created",
        summary: buildSuccessSummary({
          mode: pageId ? "updated" : "created",
          pageId: page.pageId || pageId, publicUrl, rootUrl, accessUrl,
        }),
        pageId: page.pageId || pageId,
        url: rootUrl, rootUrl, publicUrl, accessUrl,
        pageUrlNoPagecode: rootUrl, pageUrlWithPagecode: accessUrl,
        shareRecommendedUrl: publicUrl || rootUrl,
        pagecode: resolvedPagecode ?? null,
      };
      return { ok: true, liveUrl, successPayload };
    } catch (err) {
      const fail = buildFailureResult(err);
      return { ok: false, errorCode: fail.errorCode, errorMessage: fail.errorMessage,
               failurePayload: fail };
    }
  };

  // Pre-flight: verify claude binary exists by spawning `claude --version`.
  const claudeBinary = process.env.CLAWPAGE_PREVIEW_CLAUDE_BIN || "claude";
  const { spawnSync } = await import("node:child_process");
  const probe = spawnSync(claudeBinary, ["--version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) {
    emitFailure("PREVIEW_CLAUDE_NOT_FOUND",
      `claude binary not runnable (tried "${claudeBinary} --version"). Install Claude Code: https://docs.claude.com/claude-code, or set CLAWPAGE_PREVIEW_CLAUDE_BIN.`);
    process.exit(2);
  }

  const server = await startPreviewServer({
    pageDir, mode, pageId,
    claudeBinary,
    systemPromptAppend,
    chatTimeoutMs: Number(process.env.CLAWPAGE_PREVIEW_CHAT_TIMEOUT_MS) || 120000,
    publishHandler,
  });

  const url = `http://127.0.0.1:${server.address.port}/?t=${server.token}`;
  console.error(`[clawpage preview] ${url}`);
  if (!openBrowser(url)) {
    console.error(`[clawpage preview] open failed; paste this URL into your browser:\n${url}`);
  }

  // Race lifecycle promises + signals.
  const aborted = new Promise((res) => {
    process.once("SIGINT", () => res("sigint"));
    process.once("SIGTERM", () => res("sigterm"));
  });

  const outcome = await Promise.race([
    server.whenPublished.then((r) => ({ kind: "published", r })),
    server.whenAborted.then((reason) => ({ kind: "aborted", reason })),
    aborted.then((reason) => ({ kind: "aborted", reason })),
  ]);

  if (outcome.kind === "published") {
    // Give browser a beat to follow the navigate event.
    await new Promise((r) => setTimeout(r, 600));
    await server.close();
    console.log(JSON.stringify(outcome.r.successPayload, null, 2));
    process.exit(0);
  } else {
    await server.close();
    emitFailure("PREVIEW_ABORTED", `preview ended without publishing (reason: ${outcome.reason})`);
    process.exit(2);
  }
}

main().catch((err) => {
  emitFailure("PREVIEW_INTERNAL_ERROR", err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, 3 new + 26 prior = 29 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/preview.mjs test/preview-args.test.mjs
git commit -m "feat(preview): add preview subcommand entry — args, lifecycle, publish handler, exit codes"
```

---

### Task 18: bin/clawpage.mjs — register `preview` subcommand

**Files:**
- Modify: `bin/clawpage.mjs`

- [ ] **Step 1: Edit `bin/clawpage.mjs`**

In `bin/clawpage.mjs`, modify the `SUBCOMMANDS` object to include preview:

```js
const SUBCOMMANDS = {
  publish: "publish.mjs",
  preview: "preview.mjs",
  init: "init.mjs",
  data: "data.mjs",
  links: "links.mjs",
  stats: "stats.mjs",
  scaffold: "scaffold.mjs",
  blobs: "blobs.mjs",
  pages: "pages.mjs",
};
```

And update the `printHelp` body to include preview:

```js
function printHelp() {
  console.log(`clawpage <subcommand> [options]

Subcommands:
  publish    Bundle and publish a page project to Clawpage
  preview    Open a local preview, refine via chat, then publish
  init       Register a new account and save token to keys.local.json
  scaffold   Copy a shipped template into a new page directory
  pages      List / inspect / delete my published pages
  data       Manage page data (analytics / metadata)
  links      Manage page links
  stats      Show usage statistics
  blobs      Upload / list / delete blobs (Cloudflare R2 storage)

Run 'clawpage <subcommand> --help' for subcommand-specific options.
Docs: https://clawpage.ai
`);
}
```

- [ ] **Step 2: Smoke check that `node bin/clawpage.mjs preview --help` works**

Run: `node bin/clawpage.mjs preview --help`
Expected: prints usage including `--page-dir` and `--page-id`.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS, 29 tests still passing.

- [ ] **Step 4: Commit**

```bash
git add bin/clawpage.mjs
git commit -m "feat(cli): register preview subcommand"
```

---

### Task 19: Integration test — end-to-end preview → chat → publish

**Files:**
- Create: `test/preview-integration.test.mjs`

- [ ] **Step 1: Write the integration test**

`test/preview-integration.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test**

Run: `npm test`
Expected: PASS, 1 new + 29 prior = 30 tests.

- [ ] **Step 3: Commit**

```bash
git add test/preview-integration.test.mjs
git commit -m "test: end-to-end preview integration — chat edit then publish"
```

---

### Task 20: Bump CLI to 0.7.0 and finalize CLI worktree

**Files:**
- Modify: `package.json`
- Modify: `README.md` (mention preview subcommand in feature list — one bullet)

- [ ] **Step 1: Bump version**

In `package.json`, change `"version": "0.6.0"` to `"version": "0.7.0"`.

- [ ] **Step 2: Add a one-line note to README**

Open `README.md`. Find the section describing subcommands or features (likely under the "What it does" / "Commands" header). Add a bullet line:

```
- `clawpage preview` — local preview with chat-driven editing; publish from a floating button when ready.
```

(If there is no commands section, append a new "What's new in 0.7" subsection at the top with that single line.)

- [ ] **Step 3: Run all tests one final time**

Run: `npm test`
Expected: PASS, 30 tests.

- [ ] **Step 4: Commit version bump**

```bash
git add package.json README.md
git commit -m "chore: bump version to 0.7.0 — preview subcommand"
```

- [ ] **Step 5: Create PR for the CLI worktree**

```bash
git push -u origin feat-preview
gh pr create --title "feat(cli): add preview subcommand with chat-driven editing — 0.7.0" --body "$(cat <<'EOF'
## Summary
- New \`clawpage preview\` subcommand: localhost server with two floating
  buttons (Publish, Chat). Chat opens a dialog; messages drive
  \`claude -p --resume <session>\` to edit local files. Publish click runs
  the same upload as \`publish\`, redirects to the live URL, then exits.
- Shared bundle helper extracted to \`lib/_bundle.mjs\`. Publish helpers
  exported (no behavior change).
- Spec + plan committed under \`docs/superpowers/\`.

## Test plan
- [x] Unit: \`_bundle\`, \`_inject\`, \`preview-server\` (token auth, SSE,
      chat lifecycle, cancel, timeout, /publish, /quit, bundle_error).
- [x] Args test: \`preview --help\` and missing-arg exit code.
- [x] Integration test: chat → edit → publish → navigate.
- [ ] Manual smoke against real \`claude\` (release checklist below).

## Manual smoke checklist (gate for merging + tagging)
- [ ] \`node bin/clawpage.mjs preview --page-dir ~/.clawpage/pages/test-preview\` opens browser, FABs visible.
- [ ] Chat: "make the heading red" → page reloads with red heading.
- [ ] Follow-up: "make it darker" → session continued.
- [ ] Tools toggle → Full Claude → Bash call appears.
- [ ] Publish click → live URL opens; CLI exits 0 with success JSON.
- [ ] \`--page-id\` mode: Republish PATCHes existing page.
- [ ] Tab close before publish → CLI exits non-zero with PREVIEW_ABORTED.
- [ ] \`claude\` binary off PATH → first chat surfaces error in overlay banner.

## Release after merge
- Tag \`v0.7.0\` on the merged commit; trusted-publish to npm.
- Verify \`npm view @clawpage.ai/cli version\` returns 0.7.0.
- Then proceed with skill-side PR (see plan §Phase E).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Confirm PR URL printed; record it for skill PR description**

---

## Phase E — Skill-side changes

These changes live in the **`clawpage-skill`** repo. Per workspace policy, do them in a fresh worktree.

### Task 21: Create skill worktree and bump plugin version

**Files (in clawpage-skill repo):**
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Create the skill worktree**

```bash
cd /Users/mengxiao/workspace/projects/clawpage-aio/clawpage-skill
git pull --ff-only origin main
git worktree add ../clawpage-skill-wt/feat-preview -b feat-preview main
cd ../clawpage-skill-wt/feat-preview
```

- [ ] **Step 2: Read current plugin version**

Run: `cat .claude-plugin/plugin.json | grep version`
Expected: a line like `"version": "1.x.y",` — note the current value.

- [ ] **Step 3: Bump minor version (e.g., 1.2.3 → 1.3.0)**

Edit `.claude-plugin/plugin.json` and bump the `"version"` field by minor (`x → x+1`, reset patch to 0).

- [ ] **Step 4: Commit version bump**

```bash
git add .claude-plugin/plugin.json
git commit -m "chore: bump plugin minor for preview-flow"
```

---

### Task 22: Create `skills/preview-flow/SKILL.md`

**Files:**
- Create: `skills/preview-flow/SKILL.md`

- [ ] **Step 1: Write the new shared reference SKILL.md**

`skills/preview-flow/SKILL.md`:

```markdown
---
name: preview-flow
description: "Reference doc explaining the local preview UX shipped by `clawpage preview`. Linked from create-page and update-page when the user opts to preview before publishing. Not directly invoked — for documentation only."
---

# Preview Flow Reference

When `create-page` or `update-page` runs `npx -y @clawpage.ai/cli preview …` (because the user said yes to "preview before publishing?"), the user sees a localhost browser tab with the bundled page plus an injected overlay.

## What the user sees

- The page itself, exactly as it would render after publish (CSS/JS already bundled).
- **Two floating buttons** in the bottom-right corner:
  - **Chat** (chat-bubble icon) — opens a chat panel where the user can describe edits.
  - **Publish** (paper-plane icon) — directly below, the dominant action. Click triggers the actual upload.
- A small badge in the top-right: `Clawpage preview · localhost:<port>` (dismissible).

## Chat panel behavior

- Each user message spawns one local `claude -p` subprocess against the page directory. The chat session is **continued across messages** for one preview session — refinements like "actually a bit smaller" know what "the heading" referred to.
- Tool calls (Edit, Read, etc.) and assistant text stream into the transcript live as Claude works. When done, the page reloads to reflect the edits. Files in `[PAGE_DIR]` are mutated; **nothing is uploaded**.
- The chat panel header has a settings cog → **tools toggle**:
  - **Edits only** (default): file edits/reads only. Safe; a misinterpreted prompt cannot run shell commands or hit the network.
  - **Full Claude**: same as a regular Claude Code session — Bash, network, MCP enabled. One-time confirm required when switching. Resets to Edits only on next preview launch.

## Publish

- Click Publish → CLI runs the same upload as `clawpage publish` → on success, browser navigates to the live URL → CLI exits 0 with the standard success JSON.
- On API failure, the preview server stays up so the user can fix and retry from the same overlay.

## One-shot lifecycle

- One `preview` invocation = one preview session. After publish-click, the server exits; further iteration requires another `update-page` skill run with `--page-id`.
- Closing the browser tab or Ctrl-C in the CLI before publishing terminates the session and exits non-zero with `PREVIEW_ABORTED`. Local edits to `[PAGE_DIR]` are preserved.
```

- [ ] **Step 2: Commit**

```bash
git add skills/preview-flow/SKILL.md
git commit -m "feat(skill): add preview-flow shared reference for create-page and update-page"
```

---

### Task 23: Edit `skills/create-page/SKILL.md`

**Files:**
- Modify: `skills/create-page/SKILL.md`

- [ ] **Step 1: Read current SKILL.md to find step 7 publish block**

Run: `grep -n '^7\.' skills/create-page/SKILL.md`
Expected: a line number for "7. Publish page" — note it. Also locate where the `npx -y @clawpage.ai/cli publish` block ends.

- [ ] **Step 2: Insert new step 6.5 between current 6 (pre-publish checklist) and current 7 (publish)**

Edit `skills/create-page/SKILL.md`. Find the current step 7 header line:

```
7. Publish page:
```

Immediately before it, insert:

```markdown
6.5 **Ask whether to preview before publishing.**

Ask the user verbatim: "Want to preview the page locally before publishing? You'll be able to chat with Claude in the browser to refine it. (yes / no)"

- **No, or unanswered** → continue to step 7 below (existing direct-publish path; no change).
- **Yes** → use step 7' instead of step 7. See the `clawpage:preview-flow` skill for the in-browser UX.

```

- [ ] **Step 3: After the existing step 7 publish block, append step 7' (preview path)**

Find the end of the step 7 fenced bash block (the one with `npx -y @clawpage.ai/cli publish`). After the closing ``` and any trailing notes, before step 8, insert:

```markdown
7'. **Publish via preview** (only when user said yes in step 6.5).

```bash
npx -y @clawpage.ai/cli preview \
  --page-dir [PAGE_DIR] \
  --title "[TITLE]" \
  --ttl-ms 10800000 \
  --pagecode "[GENERATED_PAGECODE]"
```

The CLI blocks until the user clicks Publish in the browser, Ctrl-C's the CLI, or closes the tab. Outcomes:

- exit 0 with `{"ok": true, ...}` → continue to step 8 with this JSON. The shape is identical to `publish`'s output.
- exit non-zero with `{"ok": false, "errorCode": "PREVIEW_ABORTED"}` → the user closed preview without publishing. Acknowledge: "Preview closed without publishing — your local files at `[PAGE_DIR]` are still saved if you want to revisit." Do not retry, do not switch to `publish`.
- exit non-zero with a publish-time API error (e.g. `UNAUTHORIZED`, `OWNER_DAILY_PAGE_CREATE_LIMIT_REACHED`) → the preview server kept itself up so the user can retry from the browser. Surface the error message and stop; do not spawn a parallel `publish` from the skill.
```

- [ ] **Step 4: Commit**

```bash
git add skills/create-page/SKILL.md
git commit -m "feat(skill): create-page asks user about preview, routes to clawpage preview when yes"
```

---

### Task 24: Edit `skills/update-page/SKILL.md`

**Files:**
- Modify: `skills/update-page/SKILL.md`

- [ ] **Step 1: Find the publish step in update-page**

Run: `grep -n 'publish' skills/update-page/SKILL.md | head`
Note the line(s) where the existing `npx -y @clawpage.ai/cli publish ... --page-id` block lives.

- [ ] **Step 2: Insert step "ask whether to preview" before publish, and add a parallel preview block**

Edit `skills/update-page/SKILL.md`. Right before the existing publish block, insert:

```markdown
**Ask whether to preview before publishing.**

Ask the user verbatim: "Want to preview the update locally before republishing? You'll be able to chat with Claude in the browser to refine it. (yes / no)"

- **No** → continue with the direct-publish block below as today.
- **Yes** → use the preview block below instead. See the `clawpage:preview-flow` skill for the in-browser UX.

**Publish via preview** (only when user said yes):

```bash
npx -y @clawpage.ai/cli preview \
  --page-dir [PAGE_DIR] \
  --page-id [PAGE_ID] \
  [--ttl-ms <ms>] \
  [--pagecode <code>]
```

The Publish button in the overlay is labeled "Republish" because `--page-id` was passed; on click, the backend is hit with `PATCH /api/pages/:id`. CLI exit semantics are identical to the create flow:

- exit 0 with `{"ok": true, "mode": "updated", ...}` → continue with the existing post-publish steps.
- exit non-zero `PREVIEW_ABORTED` → user closed preview; acknowledge and stop.
- exit non-zero with API error → preview kept itself up for retry; surface error and stop.

```

- [ ] **Step 3: Commit**

```bash
git add skills/update-page/SKILL.md
git commit -m "feat(skill): update-page asks about preview, routes via clawpage preview --page-id"
```

---

### Task 25: Append `clawpage preview` section to `references/api-quickref.md`

**Files:**
- Modify: `references/api-quickref.md`

- [ ] **Step 1: Append new section at end of the file**

Append to `references/api-quickref.md`:

```markdown

## `clawpage preview`

Same args as `publish` plus interactive behavior. Starts a localhost server, opens the user's browser, blocks until the user clicks Publish in the overlay (or aborts).

**Inputs:** `--page-dir` (required), `--title`, `--ttl-ms`, `--pagecode`, `--page-id` (optional, switches publish-click to PATCH/republish), `--keys-file`, `--api-host`.

**Outputs:** identical JSON contract to `publish` on success; `{"ok": false, "errorCode": "PREVIEW_ABORTED"}` if user closes preview without publishing.

**Side effects:** writes `<page-dir>/.preview.log` with chat-session activity (gitignore-able).

**Used by:** `create-page`, `update-page` (when user opts in via the "preview before publishing?" prompt).
```

- [ ] **Step 2: Commit**

```bash
git add references/api-quickref.md
git commit -m "docs(references): document clawpage preview in api-quickref"
```

---

### Task 26: Open skill-side PR

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feat-preview
gh pr create --title "feat(skill): preview-before-publish for create + update" --body "$(cat <<'EOF'
## Summary
- create-page and update-page now ask the user "preview before publishing?".
- On yes, they route through \`npx -y @clawpage.ai/cli preview …\` instead of \`publish\`. Same args, same JSON contract on success.
- New shared reference skill \`preview-flow\` documents the in-browser UX.
- api-quickref documents the new subcommand.
- Plugin minor-version bumped.

## Depends on
- \`@clawpage.ai/cli\` ≥ **0.7.0** must already be on npm. Verify with \`npm view @clawpage.ai/cli version\` before merging.

## Test plan
- [ ] Run create-page skill in Claude Code; answer "yes" to preview prompt.
- [ ] Confirm browser opens, chat works, publish-click yields a live URL.
- [ ] Run update-page on the resulting page; verify Republish flow.
- [ ] Run create-page and answer "no" to preview; verify direct-publish path is unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: After merge: sync runtime clone**

```bash
git -C ~/.clawpage/skill-repo pull
```

- [ ] **Step 3: Smoke-test in a real Claude Code session**

In a fresh Claude Code session, ask Claude to scaffold a tiny page; answer yes to the preview prompt; walk through the manual smoke checklist (one chat edit, then publish). Capture conversation evidence to drop into the PR description if requested.

---

## Self-review checklist (run after writing the plan, before handoff)

- [x] Spec section 1–7 covered by Tasks 3–17.
- [x] Spec section 8 (skill changes) covered by Tasks 21–25.
- [x] Spec section 9 (error matrix) — surfaced via tests in Tasks 6–12; manual checklist in Task 20 PR.
- [x] Spec section 10 (testing) — Tasks 1, 3, 4, 6–12, 17, 19.
- [x] Spec section 11 (release ordering) — enforced by Task 20 (CLI first) → Task 26 (skill PR depends on 0.7.0).
- [x] No "TBD"/"TODO" in any task body.
- [x] Type/method names consistent: `bundlePageProject`, `injectOverlay`, `startPreviewServer`, `inFlight.cancel(reason)`, `whenPublished`, `whenAborted`, `publishHandler`.
- [x] Each task is bite-sized (≤ 5 substeps for the largest, mostly 4–5).
