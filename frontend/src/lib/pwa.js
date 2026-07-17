// Register and actively refresh the TM6 Bonus service worker.
// New deployments activate immediately and reload the open app once.
export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (window.location.protocol !== "https:" && !isLocal) return;

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        "/service-worker.js?v=30",
        { scope: "/", updateViaCache: "none" }
      );

      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      const checkForUpdate = () => registration.update().catch(() => {});
      checkForUpdate();

      // Check periodically while the application remains open.
      window.setInterval(checkForUpdate, 5 * 60 * 1000);

      // Mobile PWAs often stay suspended. Check as soon as they become visible again.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });
      window.addEventListener("focus", checkForUpdate);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[PWA] Service worker registration failed", err);
    }
  });
}
