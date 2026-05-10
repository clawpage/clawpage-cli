(function () {
  const cfg = __CLAWPAGE_PREVIEW_CONFIG__;
  if (!cfg || !cfg.token) { console.error("[clawpage-preview] missing config"); return; }

  const host = document.createElement("div");
  host.id = "__clawpage_preview_root__";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "closed" });

  const STYLE = `
    :host, *, *::before, *::after { box-sizing: border-box; }
    .fab-stack { position: fixed; right: 20px; bottom: 20px; display: flex; flex-direction: column; gap: 12px; z-index: 2147483600; }
    .fab { width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
           display: flex; align-items: center; justify-content: center;
           box-shadow: 0 6px 20px rgba(0,0,0,0.18); transition: transform .12s ease, box-shadow .12s ease; }
    .fab:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.22); }
    .fab[disabled] { opacity: 0.5; cursor: not-allowed; }
    .fab-publish { background: #2563eb; color: white; width: 60px; height: 60px; }
    .fab-chat { background: #f3f4f6; color: #111827; }
    .fab svg { width: 24px; height: 24px; }
    .badge { position: fixed; top: 14px; right: 14px; background: rgba(17,24,39,.85); color: #f9fafb;
             padding: 6px 10px; border-radius: 999px;
             font: 500 12px/1 -apple-system,system-ui,sans-serif; z-index: 2147483600;
             display: flex; align-items: center; gap: 8px; }
    .badge button { background: transparent; border: 0; color: inherit; cursor: pointer; padding: 0 0 0 4px; }
    .panel { position: fixed; right: 20px; bottom: 100px; width: 380px; max-height: 70vh;
             background: white; color: #111827; border-radius: 16px;
             box-shadow: 0 24px 60px rgba(0,0,0,0.25); display: none; flex-direction: column;
             font: 14px/1.5 -apple-system,system-ui,sans-serif; z-index: 2147483600;
             overflow: hidden; }
    .panel.open { display: flex; }
    .panel-header { display: flex; align-items: center; gap: 8px; padding: 12px 14px;
                    border-bottom: 1px solid #e5e7eb; }
    .panel-header .title { flex: 1; font-weight: 600; }
    .panel-header .mode-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px;
                                background: #e5e7eb; color: #374151; }
    .panel-header .mode-badge[data-mode="full"] { background: #fef3c7; color: #92400e; }
    .panel-header button { background: transparent; border: 0; cursor: pointer; padding: 4px;
                           color: #6b7280; }
    .panel-header button:hover { color: #111827; }
    .flyout { position: absolute; right: 12px; top: 48px; background: white; border: 1px solid #e5e7eb;
              border-radius: 12px; padding: 12px; width: 260px; box-shadow: 0 8px 20px rgba(0,0,0,0.12);
              display: none; z-index: 2147483601; }
    .flyout.open { display: block; }
    .flyout label { display: flex; gap: 8px; padding: 6px 0; cursor: pointer; }
    .flyout .warn { font-size: 12px; color: #92400e; margin-top: 8px; line-height: 1.4; }
    .transcript { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
    .turn { max-width: 85%; padding: 8px 12px; border-radius: 14px; word-wrap: break-word; white-space: pre-wrap; }
    .turn.user { align-self: flex-end; background: #2563eb; color: white; }
    .turn.assistant { align-self: flex-start; background: #f3f4f6; color: #111827; }
    .turn.assistant .caret { display: inline-block; width: 6px; height: 14px; vertical-align: -2px;
                             background: currentColor; opacity: .6; animation: blink 1s step-end infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    .tool-group { align-self: flex-start; max-width: 100%; font-size: 12px;
                  color: #6b7280; background: #f9fafb; border: 1px solid #e5e7eb;
                  border-radius: 8px; padding: 6px 10px; cursor: pointer; }
    .tool-group .summary { display: flex; align-items: center; gap: 6px; }
    .tool-group .summary .chevron { margin-left: auto; opacity: 0.5; transition: transform .15s; }
    .tool-group.open .summary .chevron { transform: rotate(90deg); }
    .tool-group .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%;
                       background: #9ca3af; }
    .tool-group.live .dot { background: #2563eb; animation: tool-pulse 1s ease-in-out infinite; }
    @keyframes tool-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
    .tool-group .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tool-group .body { display: none; margin-top: 6px; padding-top: 6px;
                        border-top: 1px dashed #e5e7eb;
                        font-family: ui-monospace, monospace; max-height: 220px; overflow: auto; }
    .tool-group.open .body { display: block; }
    .tool-group .line { padding: 2px 0; color: #4b5563; white-space: nowrap;
                        overflow: hidden; text-overflow: ellipsis; }
    .tool-group .line[data-error="true"] { color: #b91c1c; }
    .input-row { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e5e7eb; }
    .input-row textarea { flex: 1; min-height: 36px; max-height: 120px; resize: none;
                          border: 1px solid #d1d5db; border-radius: 8px; padding: 8px;
                          font: inherit; }
    .input-row button { padding: 0 14px; border: 0; border-radius: 8px; cursor: pointer;
                        background: #2563eb; color: white; font-weight: 600; }
    .input-row button[disabled] { opacity: .5; cursor: not-allowed; }
    .input-row .cancel { background: #ef4444; }
    .toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 24px;
             background: #111827; color: white; padding: 10px 18px; border-radius: 10px;
             font: 14px -apple-system,system-ui,sans-serif; z-index: 2147483602;
             opacity: 0; transition: opacity .2s ease; }
    .toast.show { opacity: 1; }
    .fab-tip { position: fixed; right: 96px; bottom: 28px; padding: 12px 14px;
               background: rgba(17,24,39,.94); color: white; border-radius: 10px;
               font: 12px/1.55 -apple-system,system-ui,sans-serif; max-width: 280px;
               z-index: 2147483601; box-shadow: 0 8px 20px rgba(0,0,0,0.18);
               opacity: 0; transform: translateX(8px);
               transition: opacity .25s ease, transform .25s ease; }
    .fab-tip.show { opacity: 1; transform: translateX(0); }
    .fab-tip::after { content: ""; position: absolute; right: -7px; bottom: 28px;
                      border: 7px solid transparent; border-left-color: rgba(17,24,39,.94); }
    .fab-tip .x { position: absolute; top: 4px; right: 8px; cursor: pointer;
                  opacity: 0.55; font-size: 14px; line-height: 1; padding: 4px; }
    .fab-tip .x:hover { opacity: 1; }
    .fab-tip .row { display: flex; align-items: flex-start; gap: 8px; }
    .fab-tip .row + .row { margin-top: 8px; padding-top: 8px;
                            border-top: 1px solid rgba(255,255,255,0.1); }
    .fab-tip .row .icon { flex: 0 0 auto; opacity: 0.85; }
    .fab-tip .row .text { flex: 1; padding-right: 14px; }
  `;

  const PAPER_PLANE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  const CHAT_BUBBLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const COG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.6l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;

  shadow.innerHTML = `
    <style>${STYLE}</style>
    <div class="badge">Clawpage preview · localhost:${cfg.port}<button id="badge-x" aria-label="dismiss">×</button></div>
    <div class="fab-stack">
      <button id="__clawpage_chat_fab__" class="fab fab-chat" aria-label="Chat with Claude">${CHAT_BUBBLE}</button>
      <button id="__clawpage_publish_fab__" class="fab fab-publish" aria-label="${cfg.mode === 'update' ? 'Republish' : 'Publish'}">${PAPER_PLANE}</button>
    </div>
    <div class="panel" id="chat-panel" role="dialog" aria-modal="false" aria-label="Chat with Claude">
      <div class="panel-header">
        <div class="title">Chat with Claude</div>
        <span id="mode-badge" class="mode-badge" data-mode="scoped">Edits</span>
        <button id="cog" aria-label="Settings">${COG}</button>
        <button id="close-panel" aria-label="Close">×</button>
        <div class="flyout" id="tools-flyout">
          <div style="font-weight:600;margin-bottom:6px">Tools</div>
          <label><input type="radio" name="tools" value="scoped" checked> Edits only (recommended)</label>
          <label><input type="radio" name="tools" value="full"> Full Claude (Bash, network, MCP)</label>
          <div class="warn">Full Claude lets the assistant run shell commands and fetch URLs on your machine. Resets to Edits only when preview restarts.</div>
        </div>
      </div>
      <div class="transcript" id="transcript"></div>
      <div class="input-row">
        <textarea id="chat-input" placeholder="Tell Claude what to change… (Enter to send, Shift+Enter for newline)"></textarea>
        <button id="send">Send</button>
      </div>
    </div>
  `;

  // toggle panel
  const panel = shadow.getElementById("chat-panel");
  const chatFab = shadow.getElementById("__clawpage_chat_fab__");

  // Hide chat UI entirely when claude isn't available — publish-only mode.
  if (cfg.claudeAvailable === false) {
    if (chatFab) chatFab.remove();
    if (panel) panel.remove();
  } else {
    chatFab.addEventListener("click", () => panel.classList.toggle("open"));
    shadow.getElementById("close-panel").addEventListener("click", () => panel.classList.remove("open"));
  }
  shadow.getElementById("badge-x").addEventListener("click", () => {
    const b = shadow.querySelector(".badge"); if (b) b.remove();
  });

  // tools flyout
  const cog = shadow.getElementById("cog");
  const flyout = shadow.getElementById("tools-flyout");
  const modeBadge = shadow.getElementById("mode-badge");
  if (cog) cog.addEventListener("click", (e) => { e.stopPropagation(); flyout.classList.toggle("open"); });
  for (const r of shadow.querySelectorAll('input[name="tools"]')) {
    r.addEventListener("change", (e) => {
      const v = e.target.value;
      if (v === "full" && !confirm("Full Claude lets the assistant run shell commands. Continue?")) {
        shadow.querySelector('input[name="tools"][value="scoped"]').checked = true;
        return;
      }
      modeBadge.dataset.mode = v;
      modeBadge.textContent = v === "full" ? "Full" : "Edits";
    });
  }

  // ---------- runtime state ----------
  const transcript = shadow.getElementById("transcript");
  const sendBtn = shadow.getElementById("send");
  const input = shadow.getElementById("chat-input");
  const publishBtn = shadow.getElementById("__clawpage_publish_fab__");

  let activeRequestId = null;
  let activeAssistantTurn = null;
  let activeToolGroup = null;
  let activeToolCount = 0;
  const toolLineEls = new Map(); // toolUseId → line element inside the active group

  function append(el) { transcript.appendChild(el); transcript.scrollTop = transcript.scrollHeight; }
  function turn(role, text) {
    const d = document.createElement("div");
    d.className = "turn " + role;
    d.textContent = text;
    return d;
  }

  function toolLabel(name, input) {
    if (name === "Edit") return `✎ Edited ${shortPath(input?.file_path)}`;
    if (name === "Write") return `✚ Wrote ${shortPath(input?.file_path)}`;
    if (name === "Read") return `👁 Read ${shortPath(input?.file_path)}`;
    if (name === "Glob") return `🔍 Glob ${input?.pattern || ""}`;
    if (name === "Grep") return `🔍 Grep ${input?.pattern || ""}`;
    if (name === "Bash") return `▶ Bash ${truncate(input?.command, 60)}`;
    return `🔧 ${name}`;
  }
  function shortPath(p) {
    if (!p) return "";
    const parts = String(p).split("/");
    return parts.length > 2 ? ".../" + parts.slice(-2).join("/") : p;
  }
  function truncate(s, n) {
    if (!s) return "";
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function ensureToolGroup() {
    if (activeToolGroup) return activeToolGroup;
    const g = document.createElement("div");
    g.className = "tool-group live";
    g.innerHTML = `<div class="summary">
        <span class="dot"></span>
        <span class="label">Working…</span>
        <span class="chevron">›</span>
      </div>
      <div class="body"></div>`;
    g.addEventListener("click", () => g.classList.toggle("open"));
    activeToolGroup = g;
    activeToolCount = 0;
    append(g);
    return g;
  }
  function pushTool(toolUseId, name, input) {
    const g = ensureToolGroup();
    activeToolCount += 1;
    g.querySelector(".label").textContent = toolLabel(name, input);
    const line = document.createElement("div");
    line.className = "line";
    line.textContent = toolLabel(name, input);
    g.querySelector(".body").appendChild(line);
    toolLineEls.set(toolUseId, line);
  }
  function finalizeToolGroup() {
    if (!activeToolGroup) return;
    activeToolGroup.classList.remove("live");
    const label = activeToolGroup.querySelector(".label");
    if (label) label.textContent = `✓ ${activeToolCount} tool call${activeToolCount === 1 ? "" : "s"}`;
  }
  function showToast(text) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 250); }, 1500);
  }

  function modeNow() {
    return shadow.querySelector('input[name="tools"]:checked')?.value || "scoped";
  }

  async function send() {
    const message = input.value.trim();
    if (!message || activeRequestId) return;
    append(turn("user", message));
    input.value = "";
    sendBtn.disabled = true;
    publishBtn.disabled = true;
    activeAssistantTurn = turn("assistant", "");
    const caret = document.createElement("span"); caret.className = "caret";
    activeAssistantTurn.appendChild(caret);
    append(activeAssistantTurn);

    try {
      const res = await fetch("/__preview__/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Preview-Token": cfg.token },
        body: JSON.stringify({ message, toolsMode: modeNow() }),
      });
      const j = await res.json();
      if (res.status === 202) activeRequestId = j.requestId;
      else { activeAssistantTurn.textContent = `(error: ${j.error || res.status})`; resetState(); }
    } catch (err) {
      activeAssistantTurn.textContent = `(error: ${err.message})`;
      resetState();
    }
  }
  function resetState() {
    activeRequestId = null;
    activeAssistantTurn = null;
    activeToolGroup = null;
    activeToolCount = 0;
    toolLineEls.clear();
    sendBtn.disabled = false;
    publishBtn.disabled = false;
  }

  if (sendBtn) sendBtn.addEventListener("click", send);
  if (input) input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // ---------- SSE ----------
  const es = new EventSource(`/__preview__/events?t=${encodeURIComponent(cfg.token)}`);
  es.addEventListener("assistant_text", (e) => {
    const data = JSON.parse(e.data);
    if (data.requestId !== activeRequestId || !activeAssistantTurn) return;
    const caret = activeAssistantTurn.querySelector(".caret");
    activeAssistantTurn.insertBefore(document.createTextNode(data.delta), caret);
  });
  es.addEventListener("tool_use", (e) => {
    const data = JSON.parse(e.data);
    if (data.requestId !== activeRequestId) return;
    pushTool(data.toolUseId, data.name, data.input);
  });
  es.addEventListener("tool_result", (e) => {
    const data = JSON.parse(e.data);
    const line = toolLineEls.get(data.toolUseId);
    if (!line) return;
    if (data.isError) {
      line.dataset.error = "true";
      if (activeToolGroup) activeToolGroup.classList.add("open");
    }
  });
  es.addEventListener("chat_done", (e) => {
    const data = JSON.parse(e.data);
    if (data.requestId !== activeRequestId) return;
    finalizeToolGroup();
    if (activeAssistantTurn) {
      const caret = activeAssistantTurn.querySelector(".caret");
      if (caret) caret.remove();
      if (!data.ok) { activeAssistantTurn.textContent += `\n(error: ${data.error || "unknown"})`; }
    }
    resetState();
  });
  es.addEventListener("reload", () => {
    showToast("Page updated");
    setTimeout(() => location.reload(), 300);
  });

  publishBtn.addEventListener("click", async () => {
    if (publishBtn.disabled) return;
    publishBtn.disabled = true;
    sendBtn.disabled = true;
    showToast("Publishing…");
    try {
      const res = await fetch("/__preview__/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Preview-Token": cfg.token },
      });
      if (res.status !== 202) {
        const j = await res.json().catch(() => ({}));
        showToast(`Publish error: ${j.error || res.status}`);
        publishBtn.disabled = false; sendBtn.disabled = false;
      }
    } catch (err) {
      showToast(`Publish error: ${err.message}`);
      publishBtn.disabled = false; sendBtn.disabled = false;
    }
  });

  es.addEventListener("publish_started", () => { showToast("Publishing…"); });
  es.addEventListener("publish_done", (e) => {
    const data = JSON.parse(e.data);
    if (data.ok) { showToast("Published! Redirecting…"); }
    else {
      showToast(`Publish failed: ${data.errorCode || "error"}`);
      publishBtn.disabled = false; sendBtn.disabled = false;
      // open chat panel and surface error so user can see/retry
      panel.classList.add("open");
      const errTurn = document.createElement("div");
      errTurn.className = "turn assistant";
      errTurn.textContent = `Publish failed: ${data.errorCode || ""} ${data.errorMessage || ""}`.trim();
      append(errTurn);
    }
  });
  es.addEventListener("navigate", (e) => {
    const data = JSON.parse(e.data);
    setTimeout(() => { window.location.href = data.url; }, 800);
  });

  // tab close → best-effort quit
  window.addEventListener("pagehide", () => {
    try {
      navigator.sendBeacon("/__preview__/quit?t=" + encodeURIComponent(cfg.token), "");
    } catch {}
  });

  // restore transcript across reloads (chat-only)
  if (transcript) {
    const TRANSCRIPT_KEY = "__clawpage_preview_transcript__";
    try {
      const prev = sessionStorage.getItem(TRANSCRIPT_KEY);
      if (prev) transcript.innerHTML = prev;
    } catch {}
    window.addEventListener("beforeunload", () => {
      try { sessionStorage.setItem(TRANSCRIPT_KEY, transcript.innerHTML); } catch {}
    });
  }

  // ---------- onboarding bubble (single, one-time per browser) ----------
  const ONBOARD_KEY = "__clawpage_preview_onboarded__";
  function showOnboardingBubble() {
    try { if (localStorage.getItem(ONBOARD_KEY)) return; } catch { return; }
    const rows = [];
    if (cfg.claudeAvailable !== false) {
      rows.push({
        icon: "💬",
        text: "Chat to refine — type any change, see it apply live.",
        anchorId: "__clawpage_chat_fab__",
      });
    }
    rows.push({
      icon: "🚀",
      text: cfg.mode === "update"
        ? "Republish — push your local edits live."
        : "Publish — go live on clawpage.ai.",
      anchorId: "__clawpage_publish_fab__",
    });

    const tip = document.createElement("div");
    tip.className = "fab-tip";
    tip.innerHTML = `<span class="x" aria-label="dismiss">×</span>`;
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span class="icon"></span><span class="text"></span>`;
      row.querySelector(".icon").textContent = r.icon;
      row.querySelector(".text").textContent = r.text;
      tip.appendChild(row);
    }
    shadow.appendChild(tip);
    requestAnimationFrame(() => tip.classList.add("show"));

    const dismiss = () => {
      tip.classList.remove("show");
      setTimeout(() => tip.remove(), 250);
    };
    tip.querySelector(".x").addEventListener("click", (e) => { e.stopPropagation(); dismiss(); });
    // Dismiss when ANY referenced FAB is clicked (one-shot).
    let dismissed = false;
    const oneShot = () => { if (!dismissed) { dismissed = true; dismiss(); } };
    for (const r of rows) {
      const fab = shadow.getElementById(r.anchorId);
      if (fab) fab.addEventListener("click", oneShot, { once: true });
    }
    setTimeout(dismiss, 12000);

    try { localStorage.setItem(ONBOARD_KEY, "1"); } catch {}
  }
  setTimeout(showOnboardingBubble, 400);
})();
