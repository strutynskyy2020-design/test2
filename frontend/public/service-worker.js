/* TM6 Bonus — Service Worker
 * v90 refreshes the cache for the game-only fullscreen, menu navigation, and transparent chain-overlay release.
 * v84 fixes rejected FetchEvent promises, navigation fallback, and stale registration URLs and protects image requests from Netlify's SPA fallback. A missing image must
 * never be cached as index.html, otherwise browsers can render a giant broken
 * image element over the board.
 */
const VERSION = "tm6-v97";
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const PRECACHE_URLS = [
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/bonus-match/v90/cell.png?v=90",
  "/bonus-match/v90/board-frame.png?v=90",
  "/bonus-match/v90/coin.png?v=90",
  "/bonus-match/v90/trophy.png?v=90",
  "/bonus-match/v90/star.png?v=90",
  "/bonus-match/v90/cube.png?v=90",
  "/bonus-match/v90/zap.png?v=90",
  "/bonus-match/v90/gift.png?v=90",
  "/bonus-match/v90/stone.png?v=90",
  "/bonus-match/v90/crate.png?v=90",
  "/bonus-match/v90/chain.png?v=90",
  "/bonus-match/v90/web-overlay.png?v=90",
  "/bonus-match/v90/hit-1.png?v=90",
  "/bonus-match/v90/hit-2.png?v=90",
  "/bonus-match/atlas/obstacles-v85.webp?v=85",
];

const isImageRequest = (request, url) => (
  request.destination === "image"
  || /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(url.pathname)
);

const hasImageContentType = (response) => (
  Boolean(response)
  && response.ok
  && (response.headers.get("content-type") || "").toLowerCase().startsWith("image/")
);

const transparentImage = () => new Response(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>',
  {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
    },
  },
);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.allSettled(PRECACHE_URLS.map(async (path) => {
      const response = await fetch(path, { cache: "reload" });
      const url = new URL(path, self.location.origin);
      if (!response.ok) throw new Error(`Precache failed: ${path}`);
      if (isImageRequest(new Request(url), url) && !hasImageContentType(response)) {
        throw new Error(`Invalid image response: ${path}`);
      }
      await cache.put(path, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim())
  );
});

const offlineJson = () => new Response(JSON.stringify({ success: false, error: "offline" }), {
  status: 503,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isDynamicRequest = url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/functions/");

  if (isDynamicRequest) {
    event.respondWith(fetch(request, { cache: "no-store" }).catch(() => offlineJson()));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          await cache.put("/", response.clone());
        }
        return response;
      } catch (_) {
        const cachedShell = await caches.match("/") || await caches.match("/index.html");
        if (cachedShell) return cachedShell;
        return new Response(
          '<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#090711;color:white;font-family:system-ui;display:grid;place-items:center;min-height:100vh"><div>Немає з’єднання. Перевірте мережу та оновіть сторінку.</div></body></html>',
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
        );
      }
    })());
    return;
  }

  if (isSameOrigin && (url.pathname.endsWith(".js") || url.pathname.endsWith(".css"))) {
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

  if (isImageRequest(request, url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (hasImageContentType(cached)) return cached;
      if (cached) {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.delete(request);
      }
      try {
        const response = await fetch(request, { cache: "no-cache" });
        if (!hasImageContentType(response)) return transparentImage();
        if (isSameOrigin) {
          const cache = await caches.open(RUNTIME_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (_) {
        return transparentImage();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && isSameOrigin) {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (_) {
      return new Response("", {
        status: 503,
        statusText: "Offline",
        headers: { "Cache-Control": "no-store" },
      });
    }
  })());
});
