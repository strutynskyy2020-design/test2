import { Component } from "react";
import { RefreshCcw, TriangleAlert } from "lucide-react";

const clearVPDKCaches = async () => {
  if (typeof window === "undefined") return;
  try {
    if ("caches" in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("vpdk-")).map((key) => window.caches.delete(key)));
    }
  } catch (_) {
    // Cache cleanup is best-effort. A reload still gives the browser a fresh chance.
  }
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.update().catch(() => null)));
    }
  } catch (_) {
    // Service worker may be unavailable in restricted browser modes.
  }
};

export const recoverAppAndReload = async () => {
  await clearVPDKCaches();
  window.location.reload();
};

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("VPDK page render error", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="px-5 py-10">
        <section className="mx-auto max-w-lg rounded-3xl border border-[#FF5C00]/30 bg-[#1A1A1E] p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[#FF5C00]/30 bg-[#FF5C00]/10 text-[#FF5C00]">
            <TriangleAlert size={23} strokeWidth={2.8} />
          </div>
          <h2 className="mt-4 font-display text-xl text-white">РОЗДІЛ НЕ ЗАВАНТАЖИВСЯ</h2>
          <p className="mt-2 text-xs font-bold leading-relaxed text-zinc-500">Оновимо кеш застосунку й завантажимо актуальну версію. Дані акаунта не видаляються.</p>
          <button type="button" onClick={recoverAppAndReload} className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#FFB800] px-5 text-xs font-black uppercase tracking-wider text-black active:scale-95">
            <RefreshCcw size={16} strokeWidth={3} /> Оновити сторінку
          </button>
        </section>
      </div>
    );
  }
}
