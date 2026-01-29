const CACHE_NAME = "webnotes-v20";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/hljs-extra-langs.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// Install: cache same-origin static assets only
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
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
      return self.clients.matchAll().then((clients) => {
        clients.forEach((client) => client.postMessage({ type: "SW_UPDATED" }));
      });
    })
  );
  self.clients.claim();
});

// Fetch: network-only for API, stale-while-revalidate for same-origin static assets
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Only handle same-origin requests — let the browser handle CDN loads natively
  if (url.origin !== self.location.origin) return;

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
        if (response.ok && e.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      }).catch(() =>
        cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
      );

      return cached || fetchPromise;
    })
  );
});
