import fs from "node:fs";
import path from "node:path";

export function bundlePageProject({ pageDir }) {
  const indexPath = path.join(pageDir, "index.html");
  const cssPath = path.join(pageDir, "default.css");
  const jsPath = path.join(pageDir, "default.js");

  if (!fs.existsSync(indexPath)) {
    throw new Error(`index.html not found in page dir: ${pageDir}`);
  }

  let html = fs.readFileSync(indexPath, "utf8");

  const hasDefaultCss = fs.existsSync(cssPath);
  const hasDefaultJs = fs.existsSync(jsPath);

  if (hasDefaultCss) {
    const css = fs.readFileSync(cssPath, "utf8");
    html = html.replaceAll("__DEFAULT_CSS__", css);
    html = html.replace(
      /<link[^>]*href=["'][^"']*default\.css["'][^>]*>/gi,
      `<style>\n${css}\n</style>`,
    );
  } else {
    html = html.replaceAll("__DEFAULT_CSS__", "");
  }

  if (hasDefaultJs) {
    const js = fs.readFileSync(jsPath, "utf8");
    html = html.replaceAll("__DEFAULT_JS__", js);
    html = html.replace(
      /<script[^>]*src=["'][^"']*default\.js["'][^>]*>\s*<\/script>/gi,
      `<script>\n${js}\n</script>`,
    );
  } else {
    html = html.replaceAll("__DEFAULT_JS__", "");
  }

  // __CONTENT_HTML__ is left as-is: the agent must have already replaced it in index.html.
  // If it is still present here, the non-empty content gate in the publish checklist will catch it.
  return html;
}
