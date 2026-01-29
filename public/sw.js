const CACHE_NAME = "webnotes-v2";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css",
];

const ALLOWED_CACHE_ORIGINS = [self.location.origin, "https://cdnjs.cloudflare.com"];

// Install: cache static assets
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all([
        cache.addAll(STATIC_ASSETS),
        // CDN assets may fail due to CORS/tracking prevention — ignore failures
        ...CDN_ASSETS.map((url) =>
          cache.add(url).catch(() => console.warn("SW: could not cache", url))
        ),
      ])
    )
  );
  self.skipWaiting();
});

// Activate: clean old caches and notify clients to reload
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => {
      // Notify all clients that a new version is available
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => client.postMessage({ type: "SW_UPDATED" }));
      });
    })
  );
  self.clients.claim();
});

// Fetch: network-first for API, stale-while-revalidate for static assets
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // API requests: network-only, no caching
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: "Offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  // Static assets: stale-while-revalidate (serve cache, update in background)
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request).then((response) => {
        // Only cache same-origin and known CDN responses
        if (response.ok && e.request.method === "GET") {
          const responseOrigin = new URL(response.url).origin;
          if (ALLOWED_CACHE_ORIGINS.includes(responseOrigin)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
        }
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
