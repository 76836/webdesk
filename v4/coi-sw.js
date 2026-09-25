/* Deprecated local SW.
 * Site-wide isolation uses https://76836.github.io/enable-threads.js (scope /).
 * WebDesk registers that root worker from coi-bootstrap.js — do not register this file.
 */
self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
