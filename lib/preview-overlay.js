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
           display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 20px rgba(0,0,0,0.18);
           transition: transform .12s ease, box-shadow .12s ease; }
    .fab:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.22); }
    .fab-publish { background: #2563eb; color: white; width: 60px; height: 60px; }
    .fab-chat { background: #f3f4f6; color: #111827; }
    .fab svg { width: 24px; height: 24px; }
    .badge { position: fixed; top: 14px; right: 14px; background: rgba(17,24,39,.85); color: #f9fafb;
             padding: 6px 10px; border-radius: 999px; font: 500 12px/1 -apple-system,system-ui,sans-serif;
             z-index: 2147483600; display: flex; align-items: center; gap: 8px; }
    .badge button { background: transparent; border: 0; color: inherit; cursor: pointer; padding: 0 0 0 4px; }
  `;

  const PAPER_PLANE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  const CHAT_BUBBLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

  shadow.innerHTML = `
    <style>${STYLE}</style>
    <div class="badge">Clawpage preview · localhost:${cfg.port}<button id="badge-x" aria-label="dismiss">×</button></div>
    <div class="fab-stack">
      <button id="__clawpage_chat_fab__" class="fab fab-chat" aria-label="Chat with Claude">${CHAT_BUBBLE}</button>
      <button id="__clawpage_publish_fab__" class="fab fab-publish" aria-label="Publish">${PAPER_PLANE}</button>
    </div>
  `;

  shadow.getElementById("badge-x").addEventListener("click", () => {
    const b = shadow.querySelector(".badge"); if (b) b.remove();
  });
  // FAB click handlers wired in later tasks.
})();
