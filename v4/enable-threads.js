// COOP/COEP service worker for WebDesk (scope /webdesk/).
// Register: navigator.serviceWorker.register('/webdesk/enable-threads.js', { scope: '/webdesk/' })

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function handleFetch(request) {
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
    return;
  }

  if (request.mode === 'no-cors') {
    request = new Request(request.url, {
      cache: request.cache,
      credentials: 'omit',
      headers: request.headers,
      integrity: request.integrity,
      destination: request.destination,
      keepalive: request.keepalive,
      method: request.method,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      signal: request.signal,
    });
  }

  let r = await fetch(request).catch((e) => {
    console.error('[webdesk-enable-threads] fetch', e);
    throw e;
  });

  if (r.status === 0) {
    return r;
  }

  const headers = new Headers(r.headers);
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');

  return new Response(r.body, {
    status: r.status,
    statusText: r.statusText,
    headers,
  });
}

self.addEventListener('fetch', function (e) {
  e.respondWith(handleFetch(e.request));
});
