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
