import { resolveAvatarUrl } from "@/lib/avatar";

const RARITIES = ["basic", "improved", "rare", "epic", "legendary", "diamond"];

const FRAME_ASSETS = {
  basic: "/avatar-frames/basic.png",
  improved: "/avatar-frames/improved.png",
  rare: "/avatar-frames/rare.png",
  epic: "/avatar-frames/epic.png",
  legendary: "/avatar-frames/legendary.png",
};

export const getDiamondAvatarVariant = (avatarUrl = "") => {
  const source = String(avatarUrl || "")
    .trim()
    .toLowerCase()
    .split("?")[0]
    .split("#")[0];
  const filename = source.split("/").pop() || "";
  return filename.startsWith("male-diamond-") ? "male" : "female";
};

const diamondFrameAsset = (avatarUrl = "") => (
  getDiamondAvatarVariant(avatarUrl) === "male"
    ? "/avatar-frames/diamond-male.png"
    : "/avatar-frames/diamond-female-floral-v135.webp"
);

export const resolveAvatarRarity = (rarity, avatarUrl = "") => {
  const normalized = String(rarity || "").trim().toLowerCase();
  if (RARITIES.includes(normalized)) return normalized;

  const source = String(avatarUrl || "").toLowerCase();
  if (source.includes("diamond")) return "diamond";
  if (source.includes("legendary")) return "legendary";
  if (source.includes("epic")) return "epic";
  if (source.includes("rare")) return "rare";
  if (source.includes("improved")) return "improved";
  return "basic";
};

export const resolveAvatarFrameAsset = (rarity, avatarUrl = "") => {
  const resolvedRarity = resolveAvatarRarity(rarity, avatarUrl);
  if (resolvedRarity === "diamond") return diamondFrameAsset(avatarUrl);
  return FRAME_ASSETS[resolvedRarity] || FRAME_ASSETS.basic;
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
  const frameAsset = resolveAvatarFrameAsset(resolvedRarity, src);
  const diamondVariant = resolvedRarity === "diamond"
    ? getDiamondAvatarVariant(src)
    : undefined;

  return (
    <div
      className={`avatar-frame avatar-frame--${resolvedRarity} avatar-frame--${size} ${className}`}
      data-rarity={resolvedRarity}
      data-diamond-variant={diamondVariant}
    >
      <div
        className={`avatar-frame__portrait ${resolvedSrc ? "avatar-frame__portrait--image" : "avatar-frame__portrait--fallback"}`}
        style={resolvedSrc ? undefined : { backgroundColor: color }}
      >
        {resolvedSrc ? (
          <img
            src={resolvedSrc}
            alt={alt}
            className={`avatar-frame__portrait-image ${imageClassName}`}
            decoding="async"
            onLoad={onLoad}
            onError={onError}
          />
        ) : (
          <span className="avatar-frame__initials">{initials}</span>
        )}
      </div>

      <img
        className="avatar-frame__art"
        src={frameAsset}
        alt=""
        aria-hidden="true"
        decoding="async"
        draggable="false"
      />
    </div>
  );
}
