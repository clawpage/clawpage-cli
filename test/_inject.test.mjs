import { test } from "node:test";
import assert from "node:assert/strict";
import { injectOverlay } from "../lib/_inject.mjs";

const cfg = { token: "abc", port: 1234, mode: "create" };

test("injectOverlay inserts script tag before </body>", () => {
  const out = injectOverlay("<html><body><h1>Hi</h1></body></html>", cfg);
  assert.match(out, /<script src="\/__preview__\/overlay\.js\?t=abc"><\/script>\s*<\/body>/);
  // Token is NOT exposed via inline window assignment — see _inject.mjs comment.
  assert.doesNotMatch(out, /window\.__CLAWPAGE_PREVIEW__/);
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

test("injectOverlay URL-encodes the token in the script src", () => {
  const out = injectOverlay("<html><body></body></html>", { ...cfg, token: "ab+cd" });
  assert.match(out, /src="\/__preview__\/overlay\.js\?t=ab%2Bcd"/);
});
