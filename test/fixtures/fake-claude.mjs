#!/usr/bin/env node
// Canned `claude -p` substitute for tests. Reads --session-id or --resume from
// argv, emits stream-json events on stdout, exits 0. The transcript is keyed
// off env var FAKE_CLAUDE_SCENARIO (default: "edit-success").

import process from "node:process";

const argv = process.argv.slice(2);
const idx = (k) => argv.indexOf(k);
const get = (k) => (idx(k) >= 0 ? argv[idx(k) + 1] : null);
const sessionId = get("--session-id") || get("--resume") || "00000000-0000-0000-0000-000000000000";

const scenario = process.env.FAKE_CLAUDE_SCENARIO || "edit-success";

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

if (scenario === "edit-success") {
  emit({ type: "system", subtype: "init", session_id: sessionId });
  emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Editing " } } });
  emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "index.html." } } });
  emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu_1", name: "Edit", input: { file_path: "index.html", old_string: "<h1>Hi</h1>", new_string: "<h1 class=\"text-red-500\">Hi</h1>" } }] } });
  emit({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok", is_error: false }] } });
  emit({ type: "result", subtype: "success", session_id: sessionId });
  process.exit(0);
} else if (scenario === "error") {
  emit({ type: "system", subtype: "init", session_id: sessionId });
  emit({ type: "result", subtype: "error_during_execution", session_id: sessionId });
  process.exit(1);
} else if (scenario === "hang") {
  emit({ type: "system", subtype: "init", session_id: sessionId });
  // Sleep forever — caller is expected to SIGTERM.
  setInterval(() => {}, 1 << 30);
} else {
  process.stderr.write(`unknown FAKE_CLAUDE_SCENARIO: ${scenario}\n`);
  process.exit(2);
}
