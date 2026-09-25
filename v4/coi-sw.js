/* WebDesk COI service worker — injects isolation headers for SharedArrayBuffer. */
const CACHE = "webdesk-coi-v1";

/** @type {boolean} */
let headersEnabled = true;

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("message", (ev) => {
  const d = ev.data;
  if (!d || typeof d !== "object") return;
  if (d.type === "webdesk-coi-set") {
    headersEnabled = !!d.enabled;
    // Notify all clients of ack
    self.clients.matchAll({ type: "window" }).then((list) => {
      list.forEach((c) => c.postMessage({ type: "webdesk-coi-ack", enabled: headersEnabled }));
    });
  }
  if (d.type === "webdesk-coi-get") {
    ev.source?.postMessage({ type: "webdesk-coi-ack", enabled: headersEnabled });
  }
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" && req.method !== "HEAD") return;

  e.respondWith(
    (async () => {
      let res;
      try {
        res = await fetch(req);
      } catch {
        return Response.error();
      }
      if (!headersEnabled || res.status === 0) return res;

      // Only same-origin navigations + assets we control
      const url = new URL(req.url);
      if (url.origin !== self.location.origin) return res;

      const h = new Headers(res.headers);
      h.set("Cross-Origin-Opener-Policy", "same-origin");
      // credentialless is more compatible with mixed third-party assets
      h.set("Cross-Origin-Embedder-Policy", "credentialless");
      h.set("Cross-Origin-Resource-Policy", "cross-origin");

      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: h,
      });
    })()
  );
});
