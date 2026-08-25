const CACHE = "trajets-hdf-v2.13.3-vercel";
const ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/v2133-patch.js",
  "/asct-compact.json",
  "/roster-index.json",
  "/roster-taxis.json",
  "/station-abbreviations.json",
  "/roster-technical-trains.json",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).catch(() => caches.match("/"))
    )
  );
});
