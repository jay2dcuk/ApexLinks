const CACHE = "apexlinks-shell-v05";
const ASSETS = [
  "/",
  "/index.html",
  "/app.js",
  "/style.css",
  "/scoring.js",
  "/competition.js",
  "/operations.js",
  "/operations-ui.js",
  "/offline.js",
  "/print.html",
  "/print.js",
  "/print.css",
  "/manifest.webmanifest",
  "/icon.svg",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("apexlinks-shell-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !ASSETS.includes(url.pathname)
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      } catch {
        const cached = await cache.match(url.pathname);
        return (
          cached || new Response("Offline asset unavailable", { status: 503 })
        );
      }
    })(),
  );
});
