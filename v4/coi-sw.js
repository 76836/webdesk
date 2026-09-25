/**
 * WebDesk isolation SW — sole controller for /webdesk/v4/ scope.
 * Injects COOP + COEP so the desktop can be crossOriginIsolated.
 * Do not register any other service worker under this scope.
 */
self.addEventListener("install", (event) => {
  // Take over immediately
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop any old caches from prior experiments
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("webdesk-") || k.startsWith("ffwasm-") || k.startsWith("coi"))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Bypass odd cache modes that throw in SW
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") {
    return;
  }

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

  // Opaque / error responses cannot be rewritten
  if (response.status === 0) {
    return response;
  }

  // Only rewrite same-origin responses (Pages HTML, JS, CSS, etc.)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  // require-corp is what enables full isolation; third-party assets need CORP
  // or must be same-origin. WebDesk should prefer local assets when COI is on.
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  // Help same-origin assets used as CORP consumers
  if (!headers.has("Cross-Origin-Resource-Policy")) {
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
