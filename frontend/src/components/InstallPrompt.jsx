import { useEffect, useState } from "react";
import { Share, Plus, Download, X, Smartphone } from "lucide-react";

const DISMISS_KEY = "callhub_pwa_dismissed_at";
const DISMISS_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const isIos = () => {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent || "";
  const isIphoneIpad = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  // iPadOS 13+ reports as MacIntel with touch
  const isIpadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return isIphoneIpad || isIpadOS;
};

const isStandalone = () => {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
};

const wasDismissedRecently = () => {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return Date.now() - parseInt(raw, 10) < DISMISS_MS;
  } catch {
    return false;
  }
};

export default function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState("ios"); // "ios" | "generic"
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    if (isStandalone() || wasDismissedRecently()) return;

    // Chrome / Android — beforeinstallprompt
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setMode("generic");
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iOS Safari — show manual instructions (no beforeinstallprompt on iOS)
    if (isIos()) {
      const t = setTimeout(() => setVisible(true), 2500);
      setMode("ios");
      return () => {
        clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      };
    }

    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setVisible(false);
  };

  const installNow = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch {}
    setDeferredPrompt(null);
    dismiss();
  };

  if (!visible) return null;

  return (
    <div
      data-testid="pwa-install-prompt"
      className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[60] w-[92%] max-w-[440px] pointer-events-auto"
    >
      <div className="relative bg-[#1A1A1E] border-2 border-[#39FF14]/60 rounded-3xl p-4 shadow-[0_0_24px_rgba(57,255,20,0.25)]">
        <button
          data-testid="pwa-install-dismiss"
          onClick={dismiss}
          aria-label="Закрити"
          className="absolute top-2 right-2 w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-zinc-400 active:scale-95"
        >
          <X size={16} strokeWidth={3} />
        </button>

        <div className="flex items-start gap-3 pr-6">
          <div className="w-12 h-12 rounded-2xl bg-[#39FF14]/15 border-2 border-[#39FF14]/60 flex items-center justify-center shrink-0">
            <Smartphone size={22} strokeWidth={3} color="#39FF14" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-black text-sm uppercase tracking-wider">
              Встанови як застосунок
            </div>
            <div className="text-zinc-400 text-xs mt-0.5">
              Швидкий доступ з робочого екрану, повний екран без браузера
            </div>
          </div>
        </div>

        {mode === "ios" ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 bg-[#0A0A0A] border border-white/10 rounded-2xl px-3 py-2">
              <div className="w-7 h-7 rounded-lg bg-[#00F0FF]/15 border border-[#00F0FF]/40 flex items-center justify-center">
                <Share size={14} strokeWidth={3} color="#00F0FF" />
              </div>
              <div className="text-xs text-white/90">
                1. Натисни <span className="font-black text-[#00F0FF]">Share</span> в Safari
              </div>
            </div>
            <div className="flex items-center gap-2 bg-[#0A0A0A] border border-white/10 rounded-2xl px-3 py-2">
              <div className="w-7 h-7 rounded-lg bg-[#FFB800]/15 border border-[#FFB800]/40 flex items-center justify-center">
                <Plus size={14} strokeWidth={3} color="#FFB800" />
              </div>
              <div className="text-xs text-white/90">
                2. Обери <span className="font-black text-[#FFB800]">На екран «Домів»</span>
              </div>
            </div>
          </div>
        ) : (
          <button
            data-testid="pwa-install-btn"
            onClick={installNow}
            className="arcade-btn w-full bg-[#39FF14] border-[#1a7a0a] text-[#0A0A0A] py-3 mt-3 flex items-center justify-center gap-2"
          >
            <Download size={16} strokeWidth={3} />
            <span className="font-display text-base leading-none">Встановити</span>
          </button>
        )}
      </div>
    </div>
  );
}
