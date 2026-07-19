import { resolveAvatarUrl } from "@/lib/avatar";

const RARITIES = ["basic", "improved", "rare", "epic", "legendary"];

export const resolveAvatarRarity = (rarity, avatarUrl = "") => {
  const normalized = String(rarity || "").trim().toLowerCase();
  if (RARITIES.includes(normalized)) return normalized;

  const source = String(avatarUrl || "").toLowerCase();
  if (source.includes("legendary")) return "legendary";
  if (source.includes("epic")) return "epic";
  if (source.includes("rare")) return "rare";
  if (source.includes("improved")) return "improved";
  return "basic";
};

export default function AvatarFrame({
  src,
  alt = "Аватар",
  initials = "?",
  color = "#FFB800",
  rarity,
  size = "md",
  className = "",
  imageClassName = "scale-[1.22]",
  onLoad,
  onError,
}) {
  const resolvedSrc = resolveAvatarUrl(src);
  const resolvedRarity = resolveAvatarRarity(rarity, src);

  return (
    <div className={`avatar-frame avatar-frame--${resolvedRarity} avatar-frame--${size} ${className}`}>
      <div className="avatar-frame__orbit" aria-hidden="true" />
      <div className="avatar-frame__crown" aria-hidden="true">◆</div>
      <div className="avatar-frame__shell">
        <div className="avatar-frame__image" style={{ backgroundColor: color }}>
          {resolvedSrc ? (
            <img
              src={resolvedSrc}
              alt={alt}
              className={`h-full w-full object-cover ${imageClassName}`}
              onLoad={onLoad}
              onError={onError}
            />
          ) : (
            <span className="avatar-frame__initials">{initials}</span>
          )}
        </div>
      </div>
      <span className="avatar-frame__gem avatar-frame__gem--left" aria-hidden="true" />
      <span className="avatar-frame__gem avatar-frame__gem--right" aria-hidden="true" />
    </div>
  );
}
