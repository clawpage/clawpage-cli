#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveKeysPath } from "./_workspace.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_API_HOST = "https://api.clawpage.ai";
const MAX_LIMIT = 100;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const k = t.slice(2);
    const n = argv[i + 1];
    if (!n || n.startsWith("--")) {
      args[k] = true;
      continue;
    }
    args[k] = n;
    i += 1;
  }
  return args;
}

function keysPath() {
  const p = resolveKeysPath();
  if (!fs.existsSync(p)) {
    throw new Error(`keys.local.json not found (last checked: ${p}). Run \`clawpage init\` to create one.`);
  }
  return p;
}

function loadKeys() {
  const p = keysPath();
  const o = JSON.parse(fs.readFileSync(p, "utf8"));
  const token = o?.clawpage?.token ?? o?.clawpages?.token ?? o?.token;
  const apiHost = o?.clawpage?.apiHost ?? o?.clawpages?.apiHost ?? DEFAULT_API_HOST;
  if (!token) throw new Error("token missing in keys.local.json");
  return { token, apiHost };
}

async function call(url, { method = "GET", token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, { method, headers });
  const txt = await r.text();
  let parsed = null;
  try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
  if (!r.ok) {
    const msg = typeof parsed === "object" && parsed && parsed.message
      ? `${r.status} ${parsed.error || ""}: ${parsed.message}`
      : `${r.status} ${txt}`;
    throw new Error(msg);
  }
  return parsed;
}

function parsePositiveInt(value, name, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  if (max !== undefined && n > max) throw new Error(`--${name} must be ≤ ${max}`);
  return n;
}

async function listAll(base, token) {
  const items = [];
  let page = 1;
  let total = 0;
  while (true) {
    const r = await call(`${base}?page=${page}&limit=${MAX_LIMIT}`, { token });
    const batch = r.items ?? [];
    items.push(...batch);
    total = typeof r.total === "number" ? r.total : items.length;
    if (items.length >= total || batch.length < MAX_LIMIT) break;
    page += 1;
    if (page > 1000) throw new Error("pagination runaway: aborted at page 1000");
  }
  return { items, total, fetchedPages: page };
}

function usage() {
  console.error(`usage:
  --list                       list my pages (page=1, limit=20)
  --list --page <n>            paginate (default 1)
  --list --limit <n>           1..${MAX_LIMIT}, default 20
  --list --all                 auto-paginate until every page is fetched
  --get <pageId>               fetch a single page detail

Output is JSON on stdout. Top-level field \`dataFetchedAt\` (ISO) is added so
callers (skills / dashboards) can show "data as of <time>" without computing it.
`);
}

async function main() {
  const args = parseArgs(process.argv);
  const keys = loadKeys();
  const base = `${keys.apiHost}/api/pages`;
  const dataFetchedAt = new Date().toISOString();

  try {
    if (args.list === true) {
      let result;
      if (args.all === true) {
        const all = await listAll(base, keys.token);
        result = { items: all.items, total: all.total, fetchedPages: all.fetchedPages, mode: "all" };
      } else {
        const page = args.page === undefined || args.page === true ? 1 : parsePositiveInt(args.page, "page");
        const limit = args.limit === undefined || args.limit === true ? 20 : parsePositiveInt(args.limit, "limit", MAX_LIMIT);
        result = await call(`${base}?page=${page}&limit=${limit}`, { token: keys.token });
      }
      console.log(JSON.stringify({ ...result, dataFetchedAt }, null, 2));
      return;
    }
    if (typeof args.get === "string") {
      const r = await call(`${base}/${encodeURIComponent(args.get)}`, { token: keys.token });
      console.log(JSON.stringify({ ...r, dataFetchedAt }, null, 2));
      return;
    }
    usage();
    process.exit(1);
  } catch (err) {
    console.error("[error]", err.message ?? err);
    process.exit(1);
  }
}

main();
