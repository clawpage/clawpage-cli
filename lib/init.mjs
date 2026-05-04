import fs from "node:fs/promises";
import os from "node:os";
import { HOME_KEYS, ensureHomeWorkspace } from "./_workspace.mjs";

const API_HOST = process.env.API_HOST || "https://api.clawpage.ai";
const KEYS_FILE = HOME_KEYS;
const MAX_RETRIES = 5;

const C = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

// Exit codes
//   0 — success or no-op (already in target state)
//   1 — generic failure (network, server error, retry exhausted)
//   2 — "already initialized as <other>": user must opt in with --force
const EXIT_ALREADY_INITIALIZED = 2;

function parseArgs(argv) {
  const positional = [];
  let force = false;
  for (const t of argv.slice(2)) {
    if (t === "--force" || t === "-f") force = true;
    else if (t === "--help" || t === "-h") {
      printHelp();
      process.exit(0);
    } else if (t.startsWith("-")) {
      console.error(`${C.red}Unknown flag: ${t}${C.reset}`);
      printHelp();
      process.exit(1);
    } else {
      positional.push(t);
    }
  }
  return { username: positional[0] ?? null, force };
}

function printHelp() {
  console.log(`clawpage init [username] [--force]

Initialize the cli on this machine: register a new clawpage account and save
the API token to ~/.clawpage/keys.local.json.

Default behavior is STRICTLY non-destructive:
  - If the machine is already initialized (valid token), init reports the
    current account and exits 0 without re-registering.
  - If a different username is requested, init exits 2 and asks for --force.
  - If the existing token is dead (401), init STILL exits 2 and asks for
    --force — overwriting credentials always requires explicit consent.

--force NEVER fully discards the previous account. The current \`clawpage\`
block (token + all account-derived fields like homeUrl / dataApiBase) is
moved verbatim into a \`legacy[]\` array in keys.local.json before the new
account is written. Nothing leaks across accounts; nothing is silently lost.

Arguments:
  username        (optional) preferred username. Auto-generated from the OS
                  username if omitted. Must be DNS-safe (a-z, 0-9, dashes).

Flags:
  --force, -f     Archive existing credentials to legacy[] and register a
                  fresh account. Pages owned by the previous account remain
                  on the server but become unreachable from this machine
                  (until the corresponding legacy[] entry is restored).
  --help, -h      Show this help.

Exit codes:
  0  initialized successfully OR already in target state (no-op)
  1  generic failure (network, server error, retry exhausted)
  2  current credentials present — re-run with --force to archive + replace
`);
}

function randomDigits() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function sanitizeUsername(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getBaseUsername() {
  try {
    let name = sanitizeUsername(os.userInfo().username);
    while (name.length < 6) name += "0";
    return name || "builder";
  } catch {
    return "builder";
  }
}

async function loadKeys() {
  try {
    const content = await fs.readFile(KEYS_FILE, "utf-8");
    const json = JSON.parse(content);
    const token = json?.clawpage?.token ?? json?.clawpages?.token ?? json?.token ?? null;
    const username = json?.clawpage?.username ?? json?.clawpages?.username ?? null;
    if (!token) return null;
    return { token, username, raw: json };
  } catch {
    return null;
  }
}

async function whoAmI(token) {
  const r = await fetch(`${API_HOST}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 401) return { ok: false, reason: "UNAUTHORIZED" };
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`/api/me failed: ${r.status} ${body}`);
  }
  return { ok: true, data: await r.json() };
}

async function registerAccount(username) {
  const url = `${API_HOST}/api/register`;
  console.log(`${C.gray}> POST ${url} { "username": "${username}" }${C.reset}`);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 409 && data.error === "USERNAME_TAKEN") {
      return { success: false, error: "USERNAME_TAKEN" };
    }
    throw new Error(`API Error ${response.status}: ${data.message || data.error || JSON.stringify(data)}`);
  }
  return { success: true, data };
}

async function writeKeys(username, token, { archiveCurrent = false } = {}) {
  let raw = {};
  try {
    raw = JSON.parse(await fs.readFile(KEYS_FILE, "utf-8"));
  } catch {
    // first time
  }

  // --force overwrite path: snapshot the current `clawpage` block into
  // `legacy[]` before replacing. Preserves the old token + all
  // account-derived fields (homeUrl, dataApiBase, etc.) so nothing leaks
  // into the new account's context.
  if (archiveCurrent && raw.clawpage && raw.clawpage.token) {
    raw.legacy = Array.isArray(raw.legacy) ? raw.legacy : [];
    raw.legacy.push({
      ...raw.clawpage,
      replacedAt: new Date().toISOString(),
    });
  }

  // Always FULL-REPLACE the clawpage block — never spread the existing one.
  // Spreading was the source of mixed-creds bugs (homeUrl/dataApiBase
  // surviving across account changes).
  raw.clawpage = { token, apiHost: API_HOST, username };

  ensureHomeWorkspace();
  await fs.writeFile(KEYS_FILE, JSON.stringify(raw, null, 2), "utf-8");
  console.log(`\n${C.green}✔ Configuration saved to ${KEYS_FILE}${C.reset}`);
  if (archiveCurrent) {
    console.log(`  ${C.gray}Previous credentials archived to legacy[${raw.legacy.length - 1}].${C.reset}`);
  }
}

async function registerWithRetry(baseUsername, exactOnly) {
  let current = baseUsername;
  let attempts = 0;
  while (attempts < MAX_RETRIES) {
    console.log(`Attempting to register username: ${C.yellow}${current}${C.reset}`);
    const result = await registerAccount(current);
    if (result.success) return result.data;
    if (result.error === "USERNAME_TAKEN") {
      console.log(`${C.red}✘ Username "${current}" is taken.${C.reset}`);
      if (exactOnly) {
        throw new Error(`USERNAME_TAKEN: requested exact username "${baseUsername}" is unavailable`);
      }
      current = `${baseUsername}-${randomDigits()}`;
      attempts += 1;
    }
  }
  throw new Error(`Failed to register an account after ${MAX_RETRIES} attempts.`);
}

async function main() {
  const args = parseArgs(process.argv);
  const requestedUsername = args.username ? sanitizeUsername(args.username) : null;

  console.log(`${C.cyan}Initializing Clawpage workspace...${C.reset}\n`);

  const existing = await loadKeys();

  // ============================================================
  // Default path (no --force): NEVER overwrite existing creds.
  // ============================================================
  if (existing && !args.force) {
    let verify;
    try {
      verify = await whoAmI(existing.token);
    } catch (err) {
      console.error(`${C.red}✘ Could not verify existing token:${C.reset} ${err.message}`);
      process.exit(1);
    }

    if (verify.ok) {
      const currentUser = verify.data.username;

      // No requested username, or matches current → idempotent no-op
      if (!requestedUsername || requestedUsername === currentUser) {
        console.log(`${C.green}✓ Already initialized as "${currentUser}".${C.reset}`);
        console.log(`  Keys file: ${C.gray}${KEYS_FILE}${C.reset}`);
        console.log(`  Home URL:  ${C.gray}${verify.data.homeUrl ?? "(unknown)"}${C.reset}`);
        console.log(`\n  ${C.gray}To register a NEW account (current credentials will be archived to legacy[]):${C.reset}`);
        console.log(`    ${C.gray}clawpage init${requestedUsername ? ` ${requestedUsername}` : ""} --force${C.reset}`);
        process.exit(0);
      }

      // Requested a different username → block, require --force
      console.error(`${C.red}✘ Already initialized as "${currentUser}".${C.reset}`);
      console.error(`  You requested registering as "${requestedUsername}".`);
      console.error(`  ${C.yellow}⚠ Re-running with --force will move "${currentUser}"'s credentials into legacy[] in keys.local.json and register a new account.${C.reset}`);
      console.error(`  ${C.yellow}  Pages owned by "${currentUser}" remain on the server but become unreachable from this machine.${C.reset}`);
      console.error(`\n  To proceed: ${C.gray}clawpage init ${requestedUsername} --force${C.reset}`);
      process.exit(EXIT_ALREADY_INITIALIZED);
    }

    // Token present but failed /api/me — STRICT: still require --force.
    // The dead token is preserved in legacy[] on overwrite for audit / recovery.
    console.error(`${C.red}✘ Existing token in ${KEYS_FILE} failed /api/me check (401).${C.reset}`);
    console.error(`  The account "${existing.username ?? "(unknown)"}" may have been deleted, or the token revoked.`);
    console.error(`  ${C.yellow}⚠ Re-running with --force will move the dead credentials into legacy[] and register a new account.${C.reset}`);
    console.error(`\n  To proceed: ${C.gray}clawpage init${requestedUsername ? ` ${requestedUsername}` : ""} --force${C.reset}`);
    process.exit(EXIT_ALREADY_INITIALIZED);
  }

  // ============================================================
  // --force path: archive current → register new.
  // ============================================================
  if (existing && args.force && requestedUsername === existing.username) {
    // Re-registering the same username on the same machine would just fail
    // with USERNAME_TAKEN. Treat as no-op.
    console.log(`${C.green}✓ Already registered as "${existing.username}". --force is a no-op when the requested username matches.${C.reset}`);
    process.exit(0);
  }

  if (existing && args.force) {
    console.warn(`${C.yellow}⚠ --force: archiving current credentials for "${existing.username ?? "(unknown)"}" to legacy[] before registering a new account.${C.reset}\n`);
  }

  // Register fresh.
  const baseUsername = requestedUsername ?? getBaseUsername();
  let accountData;
  try {
    accountData = await registerWithRetry(baseUsername, /* exactOnly */ Boolean(requestedUsername));
  } catch (err) {
    console.error(`\n${C.red}✘ ${err.message}${C.reset}`);
    process.exit(1);
  }

  console.log(`\n${C.green}✔ Account created successfully!${C.reset}`);
  console.log(`  Username: ${C.cyan}${accountData.username}${C.reset}`);
  console.log(`  Owner ID: ${C.gray}${accountData.ownerId}${C.reset}`);

  if (accountData.warnings && accountData.warnings.length > 0) {
    console.log(`\n${C.yellow}Warnings:${C.reset}`);
    for (const w of accountData.warnings) {
      console.log(`  - ${w}`);
    }
  }

  await writeKeys(accountData.username, accountData.token, {
    archiveCurrent: Boolean(existing && args.force),
  });
  console.log(`\n${C.green}✨ Clawpage workspace is fully initialized and ready to use.${C.reset}\n`);
}

main().catch((err) => {
  console.error(`${C.red}Unexpected error:${C.reset}`, err);
  process.exit(1);
});
