/**
 * WebDesk isolation SW — sole controller for this scope.
 * Firefox is strict about COOP changing across history entries; clients must
 * activate via location.replace(), not reload(), when toggling isolation.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => /webdesk|ffwasm|coi/i.test(k))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING" || event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
  event.respondWith(handle(req));
});

async function handle(req) {
  let response;
  try {
    response = await fetch(req);
  } catch (err) {
    console.error("[webdesk-coi-sw] fetch failed", err);
    throw err;
  }

  if (response.status === 0) return response;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return response;

  const headers = new Headers(response.headers);

  // COOP same-origin is required for crossOriginIsolated.
  headers.set("Cross-Origin-Opener-Policy", "same-origin");

  // credentialless: still enables isolation, fewer third-party CORP failures
  // than require-corp (fonts, CDNs). Both work for SharedArrayBuffer in modern FF/Chrome.
  headers.set("Cross-Origin-Embedder-Policy", "credentialless");

  if (!headers.has("Cross-Origin-Resource-Policy")) {
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
