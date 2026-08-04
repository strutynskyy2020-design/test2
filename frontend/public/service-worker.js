/* VPDK Bonus — Service Worker
 * v135 fixes exact male/female diamond-frame detection and renders rarity frames in every employee report avatar.
 * v134 pins the exact floral crystal frame supplied for all female diamond avatars and busts stale frame caches.
 * v133 adds temporary admin-issued diamond avatars, separate male/female frames, and the permanent diamond challenge.
 * v129 fixes misspelled activation period boundaries and prevents month/yesterday data mixing.
 * v124 publishes reports for every operator found in TM7/TM10 and auto-fills missing goal rows.
 * v117 adds per-team bank administration and resettable collection cycles.
 * v116 adds private per-team banks for the 15 000 Point group-meeting goal.
 * v115 preserves the shared “Загальний підсумок” in Google reports and refreshes stale report cache.
 * v114 adds the unified notification center, Web Push delivery, scheduled workday
 * reminders, manager analytics, and Google-report publication notifications.
 * v113 audits every light-theme route for readable contrast, adds exact balance
 * correction, and reorganizes the store into compact avatar rarity shelves.
 * v112 keeps store purchases out of competitive ratings, updates Щедрий Куб rewards,
 * and opens Bonus Match / Sudoku in a scroll-locked game-only viewport.
 * v111 applies the VPDK rebrand, dark-first theme, refreshed PWA icons, and Sudoku light-theme polish.
 * v109 fixes net Point leaderboards and adds periods to the team rating.
 * v106 fixes admin goals access, team messages, settings compatibility, and projection source mapping.
 * v105 adds team-aware goals, scoped prizes, leader messages, and report-view tracking.
 * v104 keeps Google reports in a global IndexedDB-backed PWA cache and refreshes them silently.
 * v90 refreshes the cache for the game-only fullscreen, menu navigation, and transparent chain-overlay release.
 * v84 fixes rejected FetchEvent promises, navigation fallback, and stale registration URLs and protects image requests from Netlify's SPA fallback. A missing image must
 * never be cached as index.html, otherwise browsers can render a giant broken
 * image element over the board.
 */
const VERSION = "vpdk-v135";
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


self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { title: "VPDK Bonus", body: event.data ? event.data.text() : "Нове сповіщення" };
  }
  const title = payload.title || "VPDK Bonus";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/favicon-64.png",
    tag: payload.tag || `vpdk-${payload.kind || "notification"}`,
    renotify: Boolean(payload.renotify),
    data: {
      link: payload.link || "/",
      kind: payload.kind || "general",
      ...((payload.data && typeof payload.data === "object") ? payload.data : {}),
    },
    vibrate: [120, 60, 120],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = new URL(event.notification?.data?.link || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(link);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(link);
  })());
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
