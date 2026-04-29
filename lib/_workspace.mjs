// Shared workspace resolution.
//
// Default global workspace lives at ~/.clawpage:
//   ~/.clawpage/keys.local.json   ← created by `clawpage init`
//   ~/.clawpage/pages/<name>/     ← scaffold target / publish --page-dir bare names
//
// Cascade for keys lookup (highest priority first):
//   1. Explicit --keys-file <path>
//   2. ./keys.local.json in cwd       (project-scoped opt-in)
//   3. ~/.clawpage/keys.local.json    (global default)
//
// Page-dir resolution:
//   - Path-like input (contains `/`, starts with `.` or `~`) → resolved relative to cwd
//   - Bare name (e.g. `my-dashboard`) → ~/.clawpage/pages/<name>

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOME_WORKSPACE = path.join(os.homedir(), ".clawpage");
export const HOME_KEYS = path.join(HOME_WORKSPACE, "keys.local.json");
export const HOME_PAGES = path.join(HOME_WORKSPACE, "pages");

export function ensureHomeWorkspace() {
  fs.mkdirSync(HOME_WORKSPACE, { recursive: true });
  fs.mkdirSync(HOME_PAGES, { recursive: true });
}

export function expandTilde(p) {
  if (typeof p !== "string") return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function isPathLike(s) {
  if (typeof s !== "string" || s.length === 0) return false;
  return /[\/\\]/.test(s) || s.startsWith(".") || s.startsWith("~") || path.isAbsolute(s);
}

export function resolveKeysPath(explicit) {
  if (explicit) return path.resolve(expandTilde(String(explicit)));
  const cwdKeys = path.join(process.cwd(), "keys.local.json");
  if (fs.existsSync(cwdKeys)) return cwdKeys;
  return HOME_KEYS;
}

export function resolvePageDir(arg) {
  if (!arg || typeof arg !== "string") {
    throw new Error("page directory required");
  }
  const expanded = expandTilde(arg);
  if (isPathLike(arg)) {
    return path.resolve(expanded);
  }
  // Bare name → ~/.clawpage/pages/<name>
  return path.join(HOME_PAGES, arg);
}
