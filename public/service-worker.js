const CACHE = "trajets-hdf-v2.14.15-vercel";
const ASSETS = [
  "/", "/index.html", "/style.css", "/app.js",
  "/v2133-patch.js", "/v2134-dedupe.js", "/v2135-asct-viewer.js",
  "/asct-original-29.js", "/asct-original-30.js", "/asct-original-34.js", "/asct-original-35.js", "/asct-original-40.js", "/asct-original-41.js", "/v2136-asct-original.js", "/v2144-taxi-board.js", "/v21413-evo-autumn.js",
  "/asct-compact.json", "/roster-index.json", "/roster-taxis.json", "/station-abbreviations.json", "/roster-technical-trains.json",
  "/roster-w-autumn-1.json", "/roster-w-autumn-2.json", "/roster-w-autumn-3.json", "/roster-w-autumn-4.json",
  "/roster-evo-autumn-1.json", "/roster-evo-autumn-2.json", "/roster-evo-autumn-3.json", "/roster-evo-autumn-4.json", "/roster-evo-autumn-directions.json",
  "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"
];
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  const networkFirst = url.pathname === "/" || url.pathname.endsWith(".html") || url.pathname.endsWith(".js") || url.pathname.endsWith(".json");
  if(networkFirst){
    event.respondWith(fetch(event.request).then(response=>{
      if(response && response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
      return response;
    }).catch(()=>caches.match(event.request).then(cached=>cached||caches.match("/"))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).catch(()=>caches.match("/"))));
});
