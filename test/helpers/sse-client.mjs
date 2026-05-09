import http from "node:http";

export function connectSSE({ port, token }) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: "127.0.0.1", port,
      path: `/__preview__/events?t=${encodeURIComponent(token)}`,
      headers: { "X-Preview-Token": token, Accept: "text/event-stream" },
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE got ${res.statusCode}`));
        return;
      }
      const events = [];
      const waiters = [];
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const ev = parseEventBlock(block);
          if (ev) {
            events.push(ev);
            const w = waiters.find((x) => x.match(ev));
            if (w) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); }
          }
        }
      });
      resolve({
        events,
        async waitFor(matchFn, { timeoutMs = 5000 } = {}) {
          const found = events.find(matchFn);
          if (found) return found;
          return new Promise((res2, rej2) => {
            const timer = setTimeout(() => rej2(new Error("SSE timeout")), timeoutMs);
            waiters.push({ match: matchFn, resolve: (e) => { clearTimeout(timer); res2(e); } });
          });
        },
        close: () => req.destroy(),
      });
    });
    req.on("error", reject);
  });
}

function parseEventBlock(block) {
  let event = "message", data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (!data) return null;
  try { return { event, data: JSON.parse(data) }; } catch { return { event, data }; }
}
