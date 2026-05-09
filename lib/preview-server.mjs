import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { bundlePageProject } from "./_bundle.mjs";
import { injectOverlay } from "./_inject.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY_PATH = path.join(__dirname, "preview-overlay.js");

export async function startPreviewServer({
  pageDir, mode, keepaliveMs = 30000,
  claudeBinary = "claude",
  claudeEnv = {},
  systemPromptAppend = "",
  pageId = null,
}) {
  const token = crypto.randomBytes(32).toString("hex");

  const sseClients = new Set();

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
      try { res.write(payload); } catch {}
    }
  }

  const keepaliveTimer = setInterval(() => broadcast("keepalive", { ts: Date.now() }), keepaliveMs);

  const previewSessionId = crypto.randomUUID();
  let isFirstChat = true;
  let inFlight = null; // { requestId, child, cancel }

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
