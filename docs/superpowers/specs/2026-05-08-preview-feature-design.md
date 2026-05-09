# Clawpage Preview Feature — Design Spec

**Date:** 2026-05-08
**Author:** brainstormed by Mengxiao + Claude
**Status:** approved (awaiting implementation plan)
**Affected repos:** `clawpage-cli` (primary), `clawpage-skill` (skill prompts)

## 1. Goal

Insert an interactive preview step between page-creation and page-publishing in
both the `create-page` and `update-page` flows. The preview gives the user:

1. A locally-served, fully-bundled preview of the page (offline; no upload yet).
2. A floating **Publish** button that, when clicked, performs the actual upload
   and redirects the browser to the live URL.
3. A floating **Chat** button that opens a dialog allowing the user to refine
   the page by talking to a Claude session running locally via `claude -p`,
   with edits reflected immediately on next reload.

Default behavior is gated by an explicit "want to preview?" prompt in the skill;
users can decline and fall through to the existing direct-publish path.

## 2. Scope

In:

- New CLI subcommand `clawpage preview` in `clawpage-cli`.
- A localhost HTTP server that serves a bundled preview, brokers chat
  messages to `claude -p`, and triggers the upload on user request.
- An injected browser overlay (closed Shadow DOM) with two FABs and a chat
  panel.
- Skill edits in `clawpage-skill`: `create-page`, `update-page`, a new shared
  `preview-flow` reference skill, and a quickref note.

Out:

- Changes to the backend (`clawpage/`). The preview server uploads through the
  existing public `/api/pages` endpoints — same path as `publish`.
- Authentication changes — token cascade unchanged.
- Streaming the chat to a remote API. The chat backend is **only** the local
  `claude -p` binary.
- Multi-tab / multi-user. One preview server == one browser tab == one chat
  session.

## 3. UX summary

1. User runs the create-page or update-page skill.
2. After the local files are scaffolded and edited, the skill asks: "Want to
   preview before publishing?" If no, the existing direct-publish path runs and
   nothing about the user's experience changes.
3. If yes, the skill calls `npx -y @clawpage.ai/cli preview …`. The CLI starts
   a localhost server on a random ephemeral port, opens the user's default
   browser to it, and blocks.
4. The browser shows the bundled page with two FABs in the bottom-right:
   **Publish** (paper-plane) and **Chat** (chat-bubble), plus a small
   `Clawpage preview · localhost:<port>` badge top-right.
5. The user can click Chat → a panel slides up. They type a refinement
   request ("make the heading bolder"). The CLI runs `claude -p` headless,
   streams text + tool calls back into the panel as they happen, and reloads
   the page when the edit is done. Files in `[PAGE_DIR]` are mutated; nothing
   is uploaded.
6. The chat panel header has a settings cog → flyout with a tools mode
   selector: "Edits only" (default) or "Full Claude" (Bash / network / MCP
   enabled). Selection is per-session; full mode requires a one-time confirm.
7. The user can iterate as many times as they want. The chat session is
   continued across messages (`claude -p --resume <uuid>`), so refinements
   build on each other.
8. Eventually the user clicks Publish. The CLI uploads via the same code path
   as `publish`, the browser navigates to the live URL, and the CLI exits 0
   with the same success JSON as `publish`.
9. If the user closes the tab or Ctrl-C's the CLI before publishing, the CLI
   exits non-zero with `{ok:false, errorCode:"PREVIEW_ABORTED"}`.

## 4. Architecture (Shape A — separate `preview` subcommand)

```
clawpage-cli/
  bin/clawpage.mjs                 # +preview entry in SUBCOMMANDS
  lib/_bundle.mjs                  # NEW — extracted bundlePageProject
  lib/_inject.mjs                  # NEW — overlay-script injector
  lib/preview.mjs                  # NEW — subcommand entry
  lib/preview-server.mjs           # NEW — HTTP + SSE + claude orchestrator
  lib/preview-overlay.js           # NEW — runtime served at /__preview__/overlay.js
  lib/publish.mjs                  # refactored to import _bundle (no behavior change)

clawpage-skill/
  skills/create-page/SKILL.md      # +step 6.5 (ask) and +step 7' (preview)
  skills/update-page/SKILL.md      # same insertion + --page-id
  skills/preview-flow/SKILL.md     # NEW — shared UX reference
  references/api-quickref.md      # +preview section
  .claude-plugin/plugin.json       # version bump (minor)
```

`bundlePageProject` is the only thing extracted out of `publish.mjs`; the
`loadKeys` / `createPage` / `updatePage` / `buildAccessUrl` /
`buildSuccessSummary` / `buildFailureResult` helpers in `publish.mjs` get
exported (no body change) so `preview.mjs` can call them on publish-click.

## 5. Server API

### 5.1 Bind & auth

- Server binds `127.0.0.1` only on a random ephemeral port (`server.listen(0)`).
- A 32-byte hex token is generated at startup. The browser is opened to
  `http://127.0.0.1:<port>/?t=<token>`, and the token is also injected as
  `window.__CLAWPAGE_PREVIEW__.token` for subsequent fetch calls.
- Every `/__preview__/*` request requires `X-Preview-Token: <token>` (or query
  param fallback for SSE in browsers that strip headers from EventSource).
- Token mismatch → 403; never log the token.

### 5.2 Endpoints

| Method · Path                  | Auth          | Body                                 | Response                     |
|--------------------------------|---------------|--------------------------------------|------------------------------|
| `GET /`                        | query `?t=`   | —                                    | 200 text/html (re-bundles)   |
| `GET /__preview__/overlay.js`  | query `?t=`   | —                                    | 200 application/javascript   |
| `GET /__preview__/events`      | query `?t=`   | —                                    | 200 text/event-stream (SSE)  |
| `POST /__preview__/chat`       | header        | `{message:string, toolsMode:"scoped"\|"full"}` | 202 `{requestId}` |
| `POST /__preview__/chat/cancel`| header        | `{requestId}`                        | 200 `{ok:true}`              |
| `POST /__preview__/publish`    | header        | empty (args locked at startup)       | 202 `{ok:true}`              |
| `POST /__preview__/quit`       | header        | empty (sendBeacon on tab close)      | 200 + process exit           |

### 5.3 SSE event types

| event              | data                                                              | trigger                                 |
|--------------------|-------------------------------------------------------------------|-----------------------------------------|
| `assistant_text`   | `{requestId, delta}`                                              | stream-json `text_delta` blocks         |
| `tool_use`         | `{requestId, toolUseId, name, input}`                             | stream-json `tool_use` blocks           |
| `tool_result`      | `{requestId, toolUseId, isError, content}`                        | stream-json `tool_result` blocks        |
| `chat_done`        | `{requestId, ok, error?}`                                         | claude subprocess exits                 |
| `reload`           | `{}`                                                              | after a successful `chat_done`          |
| `publish_started`  | `{}`                                                              | publish click enters upload phase       |
| `publish_done`     | `{ok, liveUrl?, errorCode?, errorMessage?}`                       | upload finishes                         |
| `navigate`         | `{url}`                                                           | terminal event after successful publish |
| `bundle_error`     | `{message}`                                                       | `GET /` re-bundle threw                 |
| `keepalive`        | `{ts}`                                                            | every 30s                               |

### 5.4 Lifecycle

- Process starts, binds port, opens browser, waits.
- Chat in flight: one at a time. Concurrent `POST /chat` → 409. Cancel via SIGTERM, then SIGKILL after 2s.
- Re-bundle on every `GET /` (no filesystem watcher; reload is the trigger).
- After `chat_done {ok:true}`: emit `reload`. Browser fetches `/` → fresh bundle.
- `POST /publish` → upload → `publish_done` → if ok, emit `navigate`, wait 1s, print success JSON to stdout, exit 0. If !ok, stay up so user can fix and retry.
- Tab close (`/quit` beacon + SSE drop) with no reconnect within 5s → exit non-zero with `PREVIEW_ABORTED`.
- Ctrl-C → graceful shutdown → same `PREVIEW_ABORTED` exit.

## 6. Overlay UI

### 6.1 Style isolation

A single host element `<div id="__clawpage_preview_root__">` is appended to
`document.body` with a **closed Shadow DOM**. All overlay HTML/CSS lives
inside the shadow root. No external CSS or font loads — fully self-contained,
inline SVG icons.

### 6.2 Layout

Two FABs `position: fixed; bottom: 20px; right: 20px;`, stacked vertically:

- **Publish FAB** (60px, primary color, paper-plane icon) — bottom-most.
- **Chat FAB** (56px, secondary color, chat-bubble icon) — directly above.

Top-right session badge: `Clawpage preview · localhost:<port>` (dismissible
once per session via × button).

When chat FAB is clicked, a panel slides up from its anchor:

- 380px wide, `max-height: 70vh`.
- Header: `Chat with Claude · session #<short-id>`, settings cog (⚙), close (×).
- Cog flyout: tools-mode selector with "Edits only" / "Full Claude" radio
  buttons, plus warning text. Switching to "Full Claude" pops a one-time
  confirm modal.
- Mode badge next to session id reflects current mode (`Edits` neutral / `Full` amber).
- Transcript: scrollable, auto-scrolls on new content.
  - User turns: right-aligned bubble.
  - Assistant turns: left-aligned bubble. `assistant_text` deltas append in
    real time with a blinking caret until `chat_done`.
  - Tool calls collapsed by default; expand to show `old_string`/`new_string`
    snippets for Edit, full body for Write, search summaries for Glob/Grep,
    just the file path for Read. Tool errors auto-expand and are red.
- Input: multi-line autogrow textarea, Enter sends, Shift+Enter newline.
  Cancel button visible only while in flight.

### 6.3 FAB states

Publish: `idle`, `disabled` (chat in flight), `in-flight` (spinner replaces
icon, FAB pulses), `error` (red border, tooltip with errorCode, click retries).

Chat: `idle`, `panel-open` (× icon), `in-flight` (small dot badge in corner).

### 6.4 Chat-edit reload

On `event: reload`: brief toast "Page updated" (1.5s) → `location.reload()`.
Transcript persists across reloads via `sessionStorage`. Cleared on publish or tab close.

### 6.5 Publish flow

Click → publish FAB enters `in-flight`, page dimmed (overlay backdrop 0.15
opacity) → `publish_started` toast "Publishing…" → on `publish_done {ok:true}`,
toast "Published! Redirecting…" with live URL visible 1s → `navigate` event
sets `window.location.href`. On `{ok:false}`, publish FAB → `error` state,
errorCode shown in chat panel (auto-opens), retry on click.

### 6.6 Republish (update flow)

When server was launched with `--page-id`, Publish FAB tooltip and label flip
to "Republish". No other UX change.

### 6.7 Accessibility

FABs are `<button>` with `aria-label`. Chat panel `role="dialog" aria-modal="false"`
(non-modal). Tab order: chat FAB → publish FAB → (when panel open) close →
transcript → input → send.

## 7. `claude -p` invocation contract

### 7.1 Subprocess model

One child process per chat message. No long-running claude. Continuity via
session id (`--session-id <uuid>` on first call, `--resume <uuid>` after).

```js
const args = [
  "-p", message,
  isFirstChat ? "--session-id" : "--resume", previewSessionId,
  "--output-format", "stream-json",
  "--include-partial-messages",
  "--add-dir", pageDir,
  "--append-system-prompt", SYSTEM_PROMPT_APPEND,
];
if (toolsMode === "scoped") {
  args.push("--allowedTools", "Edit,Read,Write,Glob,Grep");
  args.push("--permission-mode", "bypassPermissions");
} else {
  args.push("--dangerously-skip-permissions");
}
const child = spawn("claude", args, { cwd: pageDir, stdio: ["ignore", "pipe", "pipe"] });
```

### 7.2 System-prompt append

At server startup, attempt to read `~/.clawpage/skill-repo/references/design-guidelines.md`
(the Claude Code plugin install path). If found, inline its contents. If not,
use a short hardcoded fallback (Tailwind preference, light-theme caution,
preserve-placeholders rule).

The append always includes:

> You are editing a Clawpage single-file HTML page in the current directory.
> Files: `index.html` (preserve `__CONTENT_HTML__`/`__DEFAULT_CSS__`/`__DEFAULT_JS__`
> placeholders), `default.css`, `default.js`, `meta.md` (do not touch
> `metadata.page_id`). Edit the appropriate file(s), then explain what you
> changed in 1–3 sentences. Keep edits minimal and focused on the user's
> request.

If `design-guidelines.md` was discovered, its full contents are appended after
the paragraph above (verbatim, no truncation). The discovered/fallback choice
is logged once at server startup so the user can debug why design rules look
inconsistent.

### 7.3 Stream-json line parser

Read child stdout line-by-line; JSON.parse each line; map to SSE events:

| stream-json line                                                    | emits                                |
|---------------------------------------------------------------------|--------------------------------------|
| `{type:"system", subtype:"init"}`                                   | (ignored)                            |
| `{type:"stream_event", event:{type:"content_block_delta", delta:{type:"text_delta", text}}}` | `assistant_text {requestId, delta}` |
| `{type:"assistant", message:{content:[{type:"tool_use",...}]}}`     | one `tool_use` per block             |
| `{type:"user", message:{content:[{type:"tool_result",...}]}}`       | one `tool_result` per block          |
| `{type:"result", subtype:"success"}`                                | `chat_done {ok:true}`                |
| `{type:"result", subtype:"error_*"}`                                | `chat_done {ok:false, error}`        |
| stderr non-empty + non-zero exit                                    | `chat_done {ok:false, error:stderr}` |

Malformed lines logged to `<PAGE_DIR>/.preview.log`, skipped, parsing continues.

### 7.4 Hang protection

If no stdout from claude for 120s (configurable via
`CLAWPAGE_PREVIEW_CHAT_TIMEOUT_MS`), kill the subprocess and emit
`chat_done {ok:false, error:"timeout"}`.

### 7.5 Tools-mode switching

The toolsMode parameter is per-request — sent in the `POST /chat` body. The
chat panel UI exposes the toggle; the CLI never has a `--tools` flag. Server
treats missing `toolsMode` as `"scoped"`.

## 8. Skill changes

### 8.1 `skills/create-page/SKILL.md`

Insert two new steps between current step 6 and step 7:

**6.5 — Ask whether to preview before publishing.**

> Ask: "Want to preview the page locally before publishing? You'll be able to
> chat with Claude in the browser to refine it. (yes / no)"
>
> - **No / unanswered** → continue to step 7 (existing publish block) as today.
> - **Yes** → use step 7' below.

**7' — Publish via preview.**

```bash
npx -y @clawpage.ai/cli preview \
  --page-dir [PAGE_DIR] \
  --title "[TITLE]" \
  --ttl-ms 10800000 \
  --pagecode "[GENERATED_PAGECODE]"
```

The CLI blocks until publish-click, Ctrl-C, or tab close. Treat exit codes as
follows:

- exit 0 with `{ok:true,...}` → step 8 (existing).
- exit non-zero with `{ok:false, errorCode:"PREVIEW_ABORTED"}` → user
  cancelled. Acknowledge: "Preview closed without publishing — your local
  files at `[PAGE_DIR]` are still saved if you want to revisit." Do not retry.
- exit non-zero with publish-time API error → preview kept the server up for
  retry; don't spawn a parallel `publish` from the skill. Surface the error
  message and stop.

Steps 8 and 9 unchanged (publish / preview JSON shape is identical).

### 8.2 `skills/update-page/SKILL.md`

Same insertion pattern. The preview block adds `--page-id`:

```bash
npx -y @clawpage.ai/cli preview \
  --page-dir [PAGE_DIR] \
  --page-id [PAGE_ID] \
  [--ttl-ms <ms>] \
  [--pagecode <code>]
```

Publish FAB renders as "Republish"; backend hits `PATCH /api/pages/:id`.

### 8.3 `skills/preview-flow/SKILL.md` (new, ~50 lines)

Frontmatter:

```yaml
---
name: preview-flow
description: "Reference doc explaining the local preview UX shipped by `clawpage preview`. Linked from create-page and update-page when the user opts to preview before publishing. Not directly invoked."
---
```

Body covers: what the user sees in the browser (two FABs, chat panel, badge),
what each button does, how chat memory works (continued session for the
lifetime of one preview), tools-mode toggle (default scoped → file edits only,
opt-in full Claude per message inside the dialog), and the one-shot lifecycle
(publish click ends the session, retries are a fresh skill run).

### 8.4 `references/api-quickref.md`

Append:

> ## `clawpage preview`
>
> Same args as `publish` plus interactive behavior. Starts a localhost server,
> opens browser, blocks until user clicks Publish (or aborts).
>
> Inputs: `--page-dir` (required), `--title`, `--ttl-ms`, `--pagecode`,
> `--page-id` (optional, switches publish-click to PATCH/republish),
> `--keys-file`, `--api-host`.
>
> Outputs: identical JSON contract to `publish` on success;
> `{"ok": false, "errorCode": "PREVIEW_ABORTED"}` if user closes preview
> without publishing.
>
> Side effects: writes `<page-dir>/.preview.log` with chat session activity.

### 8.5 `.claude-plugin/plugin.json`

Bump version: minor (`0.x.y` → `0.(x+1).0`).

## 9. Error matrix

| Layer       | Failure                                          | UX                                                                                                  | Server behavior                                              |
|-------------|--------------------------------------------------|-----------------------------------------------------------------------------------------------------|--------------------------------------------------------------|
| Startup     | `claude` binary missing                          | CLI prints `PREVIEW_CLAUDE_NOT_FOUND` + install hint, exits before bind                             | Skill receives error JSON; suggests install or direct publish |
| Startup     | All ports taken (implausible)                    | CLI exits `PREVIEW_PORT_BIND_FAILED`                                                                | Skill suggests retry                                         |
| Startup     | Browser launch fails                             | CLI prints URL + token, waits anyway                                                                | User pastes URL                                              |
| Startup     | `index.html` missing                             | CLI exits `PAGE_INDEX_MISSING`                                                                      | Skill instructs user to scaffold                             |
| Bundle      | Re-bundle throws                                 | Overlay banner via `bundle_error` SSE                                                               | Server stays up                                              |
| Chat        | claude exits non-zero / not authenticated        | Banner + retry button; chat panel auto-opens                                                        | Server stays up                                              |
| Chat        | claude hangs >120s                               | Auto-killed; `chat_done {ok:false, error:"timeout"}`                                                | Server stays up                                              |
| Chat        | Concurrent send                                  | UI disables send; defensive 409 logged                                                              | —                                                            |
| Chat        | User cancels                                     | SIGTERM → SIGKILL@2s; `chat_done {ok:false, error:"cancelled"}`                                     | File edits made before cancel preserved; reload still fires  |
| Publish     | LOCAL_KEYS_FILE_MISSING / LOCAL_TOKEN_MISSING    | Banner: close preview, run init                                                                     | Server stays up                                              |
| Publish     | UNAUTHORIZED / PAGE_NOT_FOUND / 429 / 5xx        | Overlay shows errorCode + actionable message (reuses publish.mjs `buildFailureResult`)              | Server stays up                                              |
| Publish     | Network timeout                                  | Banner "Network error — retry?"                                                                     | Server stays up                                              |
| Lifecycle   | Tab close                                        | sendBeacon `/quit` + SSE drop → 5s grace → exit `PREVIEW_ABORTED`                                   | Process exits non-zero                                       |
| Lifecycle   | Ctrl-C                                           | Same: exit `PREVIEW_ABORTED`                                                                        | Process exits non-zero                                       |
| Lifecycle   | Server crash                                     | Overlay shows "Preview disconnected" via SSE close; CLI exits `PREVIEW_INTERNAL_ERROR` w/ stack     | User retries by re-invoking skill                            |

## 10. Testing

### 10.1 Unit

`clawpage-cli/test/`:

- `_bundle.test.mjs` — extracted bundlePageProject; missing optional files;
  __SYSTEM__ placeholder behavior.
- `_inject.test.mjs` — overlay injection idempotent; correct insertion
  position; handles malformed/no-`</body>` HTML.
- `preview-server.test.mjs` — token auth on every endpoint; SSE event
  ordering (`assistant_text*` → `chat_done` → `reload`); concurrency 409;
  cancel SIGTERMs; `--page-id` flows to publish call; bundle re-read on
  each `GET /` reflects file changes.
- `preview-args.test.mjs` — `clawpage preview --help`; required `--page-dir`
  enforced; arg parity with `publish`.

Tests use a **fake claude binary** (`test/fixtures/fake-claude.mjs`) on PATH
via env, that emits a canned stream-json transcript. Avoids hitting Claude
in CI.

### 10.2 Integration

`clawpage-cli/test/preview-integration.test.mjs`:

1. Scaffold a temp page dir.
2. Start preview-server programmatically.
3. Subscribe to `/events` with token via Node's built-in EventSource.
4. POST chat → verify `assistant_text*`, `tool_use(Edit)`, `chat_done {ok:true}`,
   `reload` events arrive in order.
5. Verify the temp page dir was actually mutated.
6. POST `/publish` against a mock backend (Fastify `MemoryPageStore`-style) →
   verify `publish_done {ok:true}` then `navigate`.
7. Server exits cleanly with the success JSON.

### 10.3 Manual smoke (release checklist in PR description)

1. `node bin/clawpage.mjs preview --page-dir ~/.clawpage/pages/test-preview`
   → browser opens, FABs visible.
2. Chat: "make the heading red" → Edit happens, page reloads, heading is red.
3. Follow-up: "actually make it darker red" → session continued.
4. Toggle Tools → Full Claude → "list the files" → Bash call appears in transcript.
5. Click Publish → live URL opens; CLI exits 0.
6. Re-run with `--page-id <id>` → verify Republish PATCHes.
7. Re-run, close tab without publishing → CLI exits non-zero w/ `PREVIEW_ABORTED`.
8. Re-run with `claude` off PATH → `PREVIEW_CLAUDE_NOT_FOUND`.

## 11. Release ordering

Strict (CLI must precede skill):

1. CLI repo PR → merge → tag `v0.7.0` → trusted-publish to npm.
2. Verify `npm view @clawpage.ai/cli version` shows `0.7.0`.
3. Smoke `npx -y @clawpage.ai/cli@0.7.0 preview --help` from a clean shell.
4. **Then** skill repo PR → merge → version bump.
5. `git -C ~/.clawpage/skill-repo pull` to confirm runtime sync.

Skill PR description must call out: "Depends on @clawpage.ai/cli ≥ 0.7.0 already
on npm — verify before merging."

## 12. Open questions / future work

- Streaming protocol may need adjustment if `--include-partial-messages` event
  shape changes between Claude Code versions. Pin a minimum claude binary
  version once we test against the current one.
- Multi-tab support: explicitly out of scope. Server logs warning + 409s a
  second SSE connection if one is already open.
- Persisting chat transcripts beyond `sessionStorage` (cross-preview history)
  — not in v1; could store under `<PAGE_DIR>/.clawpage-chat-history.json` if a
  user needs it.
- Diff view in the chat panel ("show me what changed") — out of v1, would
  require server-side mtime tracking + fs reads of pre/post snapshots.

## 13. Decisions log (from brainstorm)

| # | Decision                                               | Source       |
|---|--------------------------------------------------------|--------------|
| 1 | Preview supported in both create-page and update-page; skill asks user "preview before publishing?" each run rather than gating via a CLI flag | user (Q1) |
| 2 | One-shot lifecycle; server exits on publish or abort   | user (Q2)    |
| 3 | Continued claude session across messages (`--resume`)  | user (Q3)    |
| 4 | Streamed events in chat overlay (stream-json)          | user (Q4)    |
| 5 | Locked-down tools by default (Edit/Read/Write/Glob/Grep + bypassPermissions); user can opt to full Claude inside the chat dialog (not a CLI flag) | user (Q5 + clarification) |
| 6 | Tab-close auto-exits server                            | user (Section 2)|
| 7 | `--page-id` flag for update flow                       | user (Section 2)|
| 8 | Inline `references/design-guidelines.md` into system prompt at server startup | user (Section 4) |
| 9 | `.preview.log` lives in `<PAGE_DIR>`                   | user (Section 4)|
| 10| Architecture Shape A (separate `preview` subcommand)   | user (approaches)|
| 11| Extract `bundlePageProject` to `_bundle.mjs`           | user (Section 1)|
| 12| New shared `preview-flow` skill ref doc                | user (Section 1)|
| 13| Publish FAB below, Chat FAB above, stacked vertically  | user (Section 3 micro-a)|
| 14| Transcript persistence via sessionStorage              | user (Section 3 micro-b)|
