#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(__dirname, "..", "lib");

const SUBCOMMANDS = {
  publish: "publish.mjs",
  init: "init.mjs",
  data: "data.mjs",
  links: "links.mjs",
  stats: "stats.mjs",
  scaffold: "scaffold.mjs",
  blobs: "blobs.mjs",
};

function printHelp() {
  console.log(`clawpage <subcommand> [options]

Subcommands:
  publish    Bundle and publish a page project to Clawpage
  init       Register a new account and save token to keys.local.json
  scaffold   Copy a shipped template into a new page directory
  data       Manage page data (analytics / metadata)
  links      Manage page links
  stats      Show usage statistics
  blobs      Upload / list / delete blobs (Cloudflare R2 storage)

Run 'clawpage <subcommand> --help' for subcommand-specific options.
Docs: https://clawpage.ai
`);
}

const [, , subcommand, ...rest] = process.argv;

if (!subcommand || subcommand === "--help" || subcommand === "-h") {
  printHelp();
  process.exit(0);
}

const scriptName = SUBCOMMANDS[subcommand];

if (!scriptName) {
  console.error(`Unknown subcommand: ${subcommand}`);
  printHelp();
  process.exit(1);
}

const scriptPath = path.join(libDir, scriptName);
const child = spawn(process.execPath, [scriptPath, ...rest], {
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error(`Failed to invoke ${scriptName}:`, err.message);
  process.exit(1);
});
