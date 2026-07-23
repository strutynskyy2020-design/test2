/* TM6 Bonus — Service Worker
 * Dynamic data is always network-only.
 * App shell uses network-first so new deployments replace old PWA files promptly.
 */
const VERSION = "tm6-v65";
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const PRECACHE_URLS = [
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

const offlineJson = () =>
  new Response(JSON.stringify({ success: false, error: "offline" }), {
    status: 503,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isDynamicRequest =
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/.netlify/functions/");

  // Never cache goals, authentication, API, or Netlify Function responses.
  if (isDynamicRequest) {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(() => offlineJson())
    );
    return;
  }

  // Navigation: always ask the network first so fresh deployments appear without hard refresh.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // Hashed JS/CSS: network first, cached copy only as an offline fallback.
  if (
    isSameOrigin &&
    (url.pathname.endsWith(".js") || url.pathname.endsWith(".css"))
  ) {
    event.respondWith(
      fetch(request, { cache: "no-cache" })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Images/icons may be cached for offline use.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && isSameOrigin) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
