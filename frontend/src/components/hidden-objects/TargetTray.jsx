import { useState } from "react";
import { Lightbulb, Search } from "lucide-react";
import ObjectIcon from "@/components/hidden-objects/ObjectIcon";
import { getTargetArtwork } from "./targetArtwork";

function TargetPicture({ target, artwork }) {
  const [failed, setFailed] = useState(false);
  const isAtlas = Number.isInteger(artwork.slot);
  const spriteStyle = isAtlas ? {
    width: `${artwork.columns * 100}%`, height: `${artwork.rows * 100}%`,
    left: `${-(artwork.slot % artwork.columns) * 100}%`,
    top: `${-Math.floor(artwork.slot / artwork.columns) * 100}%`,
  } : undefined;
  return (
    <div className="hidden-target-picture">
      {artwork.image && !failed ? (
        <div className={isAtlas ? "hidden-target-sprite" : "hidden-target-legacy-picture"}>
          <img src={artwork.image} alt={target.label} width="76" height="68" style={spriteStyle} draggable="false" decoding="async" onError={() => setFailed(true)} />
        </div>
      ) : <ObjectIcon name={target.icon} size={36} />}
    </div>
  );
}

export default function TargetTray({ session, busy, onHint }) {
  const found = new Set(session.found_ids || []);
  const total = session.targets?.length || 0;
  const foundCount = found.size;
  const progress = total ? Math.round((foundCount / total) * 100) : 0;
  const hintsLeft = Math.max(0, Number(session.hints_total || 0) - Number(session.hints_used || 0));

  return (
    <section className="hidden-target-tray" aria-label="Предмети для пошуку">
      <div className="hidden-target-progress-row">
        <div aria-live="polite" aria-atomic="true">
          <span><Search size={14} /> ЗНАЙДЕНО</span>
          <strong>{foundCount}/{total}</strong>
        </div>
        <div className="hidden-target-progress" role="progressbar" aria-valuemin="0" aria-valuemax={total} aria-valuenow={foundCount}>
          <i style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="hidden-target-list" role="list">
        {session.targets?.map((target) => {
          const isFound = found.has(target.id);
          const artwork = getTargetArtwork(session.level_id, target);
          return (
            <div key={target.id} role="listitem" title={target.label} className={`hidden-target-chip ${isFound ? "is-found" : ""}`} data-testid={`hidden-object-target-${target.id}`}>
              <TargetPicture key={`${artwork.image || target.id}:${artwork.slot ?? "single"}`} target={target} artwork={artwork} />
              <span>{target.label}</span>
              {isFound && <b aria-label="Знайдено">✓</b>}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="hidden-hint-button"
        onClick={onHint}
        disabled={busy || hintsLeft <= 0 || foundCount >= total}
        data-testid="hidden-object-hint"
      >
        <Lightbulb size={22} strokeWidth={3} />
        <span>ПІДКАЗКА</span>
        <small>{hintsLeft} залишилось</small>
      </button>
    </section>
  );
}
