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
