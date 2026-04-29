#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.resolve(__dirname, "..", "templates");

function parseArgs(argv) {
  const positional = [];
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
        continue;
      }
      args[key] = next;
      i += 1;
    } else {
      positional.push(token);
    }
  }
  return { positional, args };
}

function listTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function printHelp() {
  console.log(`clawpage scaffold <template-name> <target-dir> [--force]

Copy a shipped template into a new page directory.

Templates available: ${listTemplates().join(", ") || "(none — package install incomplete)"}

Examples:
  clawpage scaffold general_template ./.pages/my-dashboard
  clawpage scaffold stock-analysis-terminal ./.pages/tsla-weekly --force

Use --list to print template names only.
Use --force to overwrite an existing target directory.
`);
}

async function main() {
  const { positional, args } = parseArgs(process.argv);

  if (args.help || args.h) {
    printHelp();
    return;
  }

  if (args.list) {
    for (const name of listTemplates()) console.log(name);
    return;
  }

  const [templateName, targetDir] = positional;

  if (!templateName || !targetDir) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: "scaffold requires <template-name> and <target-dir>",
          availableTemplates: listTemplates(),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const src = path.join(TEMPLATES_DIR, templateName);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: `template not found: ${templateName}`,
          availableTemplates: listTemplates(),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const dst = path.resolve(targetDir);
  if (fs.existsSync(dst) && !args.force) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: `target already exists: ${dst}`,
          hint: "pass --force to overwrite",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  copyDir(src, dst);

  console.log(
    JSON.stringify(
      {
        ok: true,
        template: templateName,
        target: dst,
        files: fs.readdirSync(dst).sort(),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
