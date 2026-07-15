// Register the TM6 Bonus service worker for PWA install / offline shell.
// Safe no-op in dev if SW fails.
export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // Only register when served over https or on localhost
  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (window.location.protocol !== "https:" && !isLocal) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js?v=14", { scope: "/", updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[PWA] Service worker registration failed", err);
      });
  });
}
