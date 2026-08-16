// Kill-switch service worker.
//
// The app no longer registers a service worker (PWA support is disabled),
// but browsers keep a previously-registered worker until it is explicitly
// uninstalled. This file replaces the old workbox build so any browser still
// running it updates to this no-op worker, clears its caches, unregisters
// itself, and stops intercepting same-origin fetches. Keep serving this file;
// deleting it (404) would strand the old registration in visited browsers.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      await Promise.all(clients.map((client) => client.navigate(client.url)));
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  // No caching — every request goes straight to the network.
  event.respondWith(fetch(event.request));
});
