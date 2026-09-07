import { useEffect, useRef } from "react";
import { ChevronRight, RotateCcw, Sparkles, Star, Trophy, X } from "lucide-react";

const formatTime = (seconds = 0) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;

export default function ResultModal({ result, maxLevel, onNext, onReplay, onClose }) {
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!result) return undefined;
    const previousFocus = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onCloseRef.current?.();
    };
    closeButtonRef.current?.focus();
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [result]);

  if (!result) return null;
  return (
    <div className="hidden-modal-backdrop">
      <section className="hidden-result-card" role="dialog" aria-modal="true" aria-label="Рівень завершено">
        <button ref={closeButtonRef} type="button" className="hidden-result-close" onClick={onClose} aria-label="Закрити"><X size={19} /></button>
        <div className="hidden-result-trophy"><Trophy size={36} /></div>
        <span className="hidden-eyebrow">СПРАВУ РОЗКРИТО</span>
        <h2>{result.title}</h2>
        <div className="hidden-result-stars" aria-label={`${result.stars} зірки`}>
          {[1, 2, 3].map((value) => <Star key={value} size={30} fill={value <= result.stars ? "currentColor" : "none"} className={value <= result.stars ? "is-on" : ""} />)}
        </div>
        <div className="hidden-result-metrics">
          <div><span>Час</span><strong>{formatTime(result.elapsed)}</strong></div>
          <div><span>Промахи</span><strong>{result.mistakes}</strong></div>
          <div><span>Підказки</span><strong>{result.hints_used}</strong></div>
        </div>
        <div className="hidden-result-reward"><Sparkles size={18} /><span>+{result.points_awarded} Point · +{result.xp_awarded} XP</span></div>
        <div className="hidden-result-actions">
          <button type="button" className="hidden-secondary-button" onClick={onReplay}><RotateCcw size={18} /> Ще раз</button>
          <button type="button" className="hidden-primary-button" onClick={onNext}>{result.level >= maxLevel ? "До справ" : "Наступна справа"}<ChevronRight size={19} /></button>
        </div>
      </section>
    </div>
  );
}
