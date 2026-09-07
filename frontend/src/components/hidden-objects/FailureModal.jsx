import { useEffect, useRef } from "react";
import { ArrowLeft, RotateCcw, SearchX } from "lucide-react";
import { getMistakeLimit, getMistakesUsed } from "./sessionState";

const focusableButtons = (element) => [...(element?.querySelectorAll("button:not(:disabled)") || [])];

export default function FailureModal({ session, open, busy, onReplay, onClose }) {
  const dialogRef = useRef(null);
  const replayButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = focusableButtons(dialogRef.current);
      if (!buttons.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (open && !busy) replayButtonRef.current?.focus();
  }, [busy, open]);

  if (!open || !session) return null;
  const mistakes = getMistakesUsed(session);
  const limit = getMistakeLimit(session);
  const found = Number(session.found_ids?.length || 0);
  const total = Number(session.targets?.length || 0);
  const usedPercent = limit ? Math.min(100, mistakes / limit * 100) : 100;

  return (
    <div className="hidden-modal-backdrop hidden-failure-backdrop" data-testid="hidden-object-failure">
      <section
        ref={dialogRef}
        className="hidden-result-card hidden-failure-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="hidden-failure-title"
        aria-describedby="hidden-failure-description"
      >
        <div className="hidden-failure-icon"><SearchX size={38} /></div>
        <span className="hidden-eyebrow">СПРАВУ НЕ РОЗКРИТО</span>
        <h2 id="hidden-failure-title">Ліміт промахів вичерпано</h2>
        <p id="hidden-failure-description">Спробуй ще раз: уважно оглядай сцену й використовуй підказки для найскладніших предметів.</p>

        <div className="hidden-failure-limit" aria-label={limit === null ? `${mistakes} промахів` : `${mistakes} з ${limit} допустимих промахів`}>
          <div><span>Промахи</span><strong>{mistakes}{limit === null ? "" : `/${limit}`}</strong></div>
          <div><span>Знайдено</span><strong>{found}/{total}</strong></div>
          <i aria-hidden="true"><b style={{ width: `${usedPercent}%` }} /></i>
        </div>

        <div className="hidden-failure-actions">
          <button ref={replayButtonRef} type="button" className="hidden-primary-button" onClick={onReplay} disabled={busy}>
            <RotateCcw size={18} /> Спробувати ще
          </button>
          <button type="button" className="hidden-secondary-button" onClick={onClose} disabled={busy}>
            <ArrowLeft size={18} /> До справ
          </button>
        </div>
      </section>
    </div>
  );
}
