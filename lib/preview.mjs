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

  // Pre-flight: verify claude binary exists by spawning `claude --version`.
  const claudeBinary = process.env.CLAWPAGE_PREVIEW_CLAUDE_BIN || "claude";
  const { spawnSync } = await import("node:child_process");
  const probe = spawnSync(claudeBinary, ["--version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) {
    emitFailure("PREVIEW_CLAUDE_NOT_FOUND",
      `claude binary not runnable (tried "${claudeBinary} --version"). Install Claude Code: https://docs.claude.com/claude-code, or set CLAWPAGE_PREVIEW_CLAUDE_BIN.`);
    process.exit(2);
  }

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
