(function () {
  const cfg = window.__CLAWPAGE_PREVIEW__;
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
    .tool { align-self: flex-start; font-size: 12px; color: #6b7280; padding: 4px 8px;
            background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; }
    .tool[data-error="true"] { color: #b91c1c; background: #fef2f2; border-color: #fecaca; }
    .tool .body { display: none; margin-top: 6px; font-family: ui-monospace, monospace;
                  white-space: pre-wrap; max-height: 200px; overflow: auto; }
    .tool.open .body { display: block; }
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
  shadow.getElementById("__clawpage_chat_fab__").addEventListener("click", () => {
    panel.classList.toggle("open");
  });
  shadow.getElementById("close-panel").addEventListener("click", () => panel.classList.remove("open"));
  shadow.getElementById("badge-x").addEventListener("click", () => {
    const b = shadow.querySelector(".badge"); if (b) b.remove();
  });

  // tools flyout
  const cog = shadow.getElementById("cog");
  const flyout = shadow.getElementById("tools-flyout");
  const modeBadge = shadow.getElementById("mode-badge");
  cog.addEventListener("click", (e) => { e.stopPropagation(); flyout.classList.toggle("open"); });
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
})();
