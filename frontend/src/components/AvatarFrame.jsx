import { resolveAvatarUrl } from "@/lib/avatar";

const RARITIES = ["basic", "improved", "rare", "epic", "legendary"];

const FRAME_ASSETS = {
  basic: "/avatar-frames/basic.png",
  improved: "/avatar-frames/improved.png",
  rare: "/avatar-frames/rare.png",
  epic: "/avatar-frames/epic.png",
  legendary: "/avatar-frames/legendary.png",
};

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
  imageClassName = "",
  onLoad,
  onError,
}) {
  const resolvedSrc = resolveAvatarUrl(src);
  const resolvedRarity = resolveAvatarRarity(rarity, src);

  return (
    <div
      className={`avatar-frame avatar-frame--${resolvedRarity} avatar-frame--${size} ${className}`}
      data-rarity={resolvedRarity}
    >
      <div className="avatar-frame__portrait" style={{ backgroundColor: color }}>
        {resolvedSrc ? (
          <img
            src={resolvedSrc}
            alt={alt}
            className={`avatar-frame__portrait-image ${imageClassName}`}
            onLoad={onLoad}
            onError={onError}
          />
        ) : (
          <span className="avatar-frame__initials">{initials}</span>
        )}
      </div>

      <img
        className="avatar-frame__art"
        src={FRAME_ASSETS[resolvedRarity]}
        alt=""
        aria-hidden="true"
        draggable="false"
      />
    </div>
  );
}
