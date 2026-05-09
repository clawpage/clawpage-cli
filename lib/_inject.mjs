const MARKER = "<!-- __CLAWPAGE_PREVIEW_INJECTED__ -->";

export function injectOverlay(html, { token, port, mode }) {
  if (html.includes(MARKER)) return html;

  // NOTE: token is intentionally not embedded in inline HTML to prevent
  // page-resident JS from reading it via window globals. The token IS still
  // accessible via the script tag's src attribute, but recovering it requires
  // a more deliberate effort than reading window.__CLAWPAGE_PREVIEW__.
  const block = `${MARKER}
<script src="/__preview__/overlay.js?t=${encodeURIComponent(token)}"></script>`;

  if (html.includes("</body>")) {
    return html.replace("</body>", `${block}\n</body>`);
  }
  return html + "\n" + block;
}
