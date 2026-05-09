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

test("preview with missing claude binary continues in publish-only mode (warning printed, server starts)", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-args-"));
  fs.writeFileSync(path.join(dir, "index.html"), `<html><body>x</body></html>`);

  const child = spawn(process.execPath, [PREVIEW, "--page-dir", dir], {
    env: { ...process.env, CLAWPAGE_PREVIEW_CLAUDE_BIN: "/nonexistent/claude-binary-xyz" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (c) => err += c);

  // Wait until the server prints its preview URL line (signal that it bound and is running),
  // OR for up to 5s.
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    child.stderr.on("data", () => {
      if (/\[clawpage preview\]\s+http:\/\/127\.0\.0\.1:/.test(err)) {
        clearTimeout(timer); resolve();
      }
    });
  });
  child.kill("SIGINT");
  await new Promise((r) => child.once("exit", r));

  assert.match(err, /claude binary not detected/, "warning is printed when claude is missing");
  assert.match(err, /\[clawpage preview\]\s+http:\/\/127\.0\.0\.1:/, "server still binds and prints URL");
});
