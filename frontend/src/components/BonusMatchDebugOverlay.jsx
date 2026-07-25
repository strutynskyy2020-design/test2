import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { bonusMatchDiagnostics } from "@/lib/bonusMatchDiagnostics";

const buttonBase = {
  border: "1px solid rgba(255,255,255,.12)",
  borderRadius: 12,
  minHeight: 40,
  padding: "0 12px",
  fontSize: 11,
  fontWeight: 900,
  cursor: "pointer",
};

export default function BonusMatchDebugOverlay({ getState }) {
  const [open, setOpen] = useState(false);
  const [alert, setAlert] = useState(null);
  const [summary, setSummary] = useState(() => bonusMatchDiagnostics.getSummary());

  useEffect(() => {
    document.documentElement.dataset.bonusDiagnostics = "v88";
    const refresh = () => setSummary(bonusMatchDiagnostics.getSummary());
    const timer = window.setInterval(refresh, 700);
    const onAlert = (event) => {
      setAlert(event.detail || { type: "unknown" });
      setOpen(true);
      refresh();
    };
    const onKeyDown = (event) => {
      if (event.altKey && event.shiftKey && event.code === "KeyB") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };

    window.addEventListener("bonusmatch:diagnostic-alert", onAlert);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("bonusmatch:diagnostic-alert", onAlert);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const fixedRight = useMemo(
    () => "max(12px, calc((100vw - 480px) / 2 + 12px))",
    [],
  );

  if (typeof document === "undefined") return null;

  const captureAndDownload = () => {
    const state = getState?.() || {};
    bonusMatchDiagnostics.snapshot("manual_export_requested", state, true);
    bonusMatchDiagnostics.download({ source: "debug-overlay", state });
    setSummary(bonusMatchDiagnostics.getSummary());
  };

  const copyLog = async () => {
    try {
      const state = getState?.() || {};
      bonusMatchDiagnostics.snapshot("manual_copy_requested", state, true);
      await bonusMatchDiagnostics.copy({ source: "debug-overlay", state });
      toast.success("Діагностичний лог скопійовано");
    } catch (error) {
      bonusMatchDiagnostics.log("diagnostics_copy_failed", { error }, "error");
      toast.error("Не вдалося скопіювати лог. Використай завантаження JSON");
    }
  };

  const captureNow = () => {
    bonusMatchDiagnostics.captureWatchdog("manual_board_capture", true);
    setSummary(bonusMatchDiagnostics.getSummary());
    toast.info("Стан дошки записано");
  };

  const clearLog = () => {
    bonusMatchDiagnostics.clear();
    setAlert(null);
    setSummary(bonusMatchDiagnostics.getSummary());
    toast.success("Діагностичний лог очищено");
  };

  return createPortal(
    <div
      data-testid="bonus-debug-overlay"
      style={{
        position: "fixed",
        right: fixedRight,
        bottom: 92,
        zIndex: 2147483647,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 10,
        pointerEvents: "none",
        fontFamily: "Nunito, system-ui, sans-serif",
      }}
    >
      {open && (
        <div
          role="dialog"
          aria-label="Діагностика Bonus Match"
          style={{
            width: "min(360px, calc(100vw - 24px))",
            maxHeight: "min(560px, calc(100vh - 190px))",
            overflow: "auto",
            border: "1px solid rgba(124,58,237,.7)",
            borderRadius: 18,
            padding: 14,
            color: "#F4F4F5",
            background: "rgba(12,10,18,.985)",
            boxShadow: "0 18px 50px rgba(0,0,0,.65)",
            pointerEvents: "auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ color: "#B78CFF", fontSize: 12, fontWeight: 1000, letterSpacing: ".08em" }}>🐞 BONUS DEBUG v88</div>
              <div style={{ marginTop: 4, color: "#71717A", fontSize: 10 }}>Alt + Shift + B відкриває панель</div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Закрити діагностику"
              style={{ ...buttonBase, minHeight: 30, padding: "0 10px", color: "#A1A1AA", background: "#18181B" }}
            >
              ×
            </button>
          </div>

          {alert && (
            <div style={{ marginTop: 10, border: "1px solid rgba(255,77,85,.45)", borderRadius: 12, padding: 10, color: "#FF9CA2", background: "rgba(255,77,85,.12)", fontSize: 11, fontWeight: 900 }}>
              Зафіксовано: {alert.type || "помилка"}. Завантаж JSON одразу.
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 12 }}>
            <div style={{ borderRadius: 12, padding: 9, background: "#17131F", textAlign: "center" }}>
              <div style={{ color: "#71717A", fontSize: 9, fontWeight: 900 }}>ПОДІЙ</div>
              <div style={{ marginTop: 2, color: "white", fontSize: 18, fontWeight: 1000 }}>{summary.eventCount}</div>
            </div>
            <div style={{ borderRadius: 12, padding: 9, background: "#211014", textAlign: "center" }}>
              <div style={{ color: "#A1A1AA", fontSize: 9, fontWeight: 900 }}>ПОМИЛОК</div>
              <div style={{ marginTop: 2, color: "#FF7A80", fontSize: 18, fontWeight: 1000 }}>{summary.errorCount}</div>
            </div>
            <div style={{ borderRadius: 12, padding: 9, background: "#101A1C", textAlign: "center" }}>
              <div style={{ color: "#71717A", fontSize: 9, fontWeight: 900 }}>ВЕРСІЯ</div>
              <div style={{ marginTop: 2, color: "#5EEBFF", fontSize: 18, fontWeight: 1000 }}>87</div>
            </div>
          </div>

          <div style={{ marginTop: 10, borderRadius: 12, padding: 10, background: "#111114", color: "#A1A1AA", fontSize: 10, lineHeight: 1.45, wordBreak: "break-word" }}>
            <div><strong style={{ color: "#D4D4D8" }}>Остання подія:</strong> {summary.lastEvent?.type || "немає"}</div>
            <div style={{ marginTop: 4 }}><strong style={{ color: "#D4D4D8" }}>Остання помилка:</strong> {summary.lastError?.type || "немає"}</div>
            <div style={{ marginTop: 4 }}><strong style={{ color: "#D4D4D8" }}>Сесія:</strong> {summary.sessionId}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            <button type="button" onClick={captureAndDownload} style={{ ...buttonBase, color: "white", background: "#7C3AED", borderColor: "#9B6BFF" }}>
              ⬇ JSON ЛОГ
            </button>
            <button type="button" onClick={copyLog} style={{ ...buttonBase, color: "#E4E4E7", background: "#1C1C22" }}>
              📋 КОПІЮВАТИ
            </button>
            <button type="button" onClick={captureNow} style={{ ...buttonBase, color: "#5EEBFF", background: "#102126", borderColor: "rgba(0,240,255,.28)" }}>
              📸 СТАН ДОШКИ
            </button>
            <button type="button" onClick={clearLog} style={{ ...buttonBase, color: "#A1A1AA", background: "#18181B" }}>
              🗑 ОЧИСТИТИ
            </button>
          </div>

          <div style={{ marginTop: 10, color: "#71717A", fontSize: 9, lineHeight: 1.4 }}>
            Лог зберігається у localStorage і не зникає після перезавантаження. Тіла API-запитів та значення query-параметрів не записуються.
          </div>
        </div>
      )}

      <button
        type="button"
        data-testid="bonus-debug-button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Відкрити діагностику Bonus Match"
        style={{
          pointerEvents: "auto",
          minWidth: 112,
          height: 46,
          padding: "0 14px",
          border: alert ? "2px solid #FF4D55" : "2px solid #7C3AED",
          borderRadius: 16,
          color: alert ? "#FFE4E6" : "#F3E8FF",
          background: alert ? "#5B1119" : "#241238",
          boxShadow: alert ? "0 0 24px rgba(255,77,85,.55)" : "0 0 24px rgba(124,58,237,.45)",
          fontSize: 12,
          fontWeight: 1000,
          letterSpacing: ".04em",
          cursor: "pointer",
        }}
      >
        🐞 DEBUG {summary.errorCount ? `(${summary.errorCount})` : "v88"}
      </button>
    </div>,
    document.body,
  );
}
