const MARKER = "<!-- __CLAWPAGE_PREVIEW_INJECTED__ -->";

export function injectOverlay(html, { token, port, mode }) {
  if (html.includes(MARKER)) return html;

  const config = JSON.stringify({ token, port, mode });
  const block = `${MARKER}
<script>window.__CLAWPAGE_PREVIEW__ = ${config};</script>
<script src="/__preview__/overlay.js?t=${encodeURIComponent(token)}"></script>`;

  if (html.includes("</body>")) {
    return html.replace("</body>", `${block}\n</body>`);
  }
  return html + "\n" + block;
}
