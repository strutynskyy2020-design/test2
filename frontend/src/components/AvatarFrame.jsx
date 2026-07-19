import { useId } from "react";
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

const Crystal = ({ x, y, size = 7, fill, rotate = 0 }) => (
  <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
    <path d={`M0 ${-size} L${size * 0.72} 0 L0 ${size} L${-size * 0.72} 0 Z`} fill={fill} />
    <path d={`M0 ${-size * 0.7} L${size * 0.34} 0 L0 ${size * 0.55} Z`} fill="rgba(255,255,255,.72)" />
  </g>
);

function FrameArtwork({ rarity, ids }) {
  const { metal, accent, glow, dark } = ids;

  if (rarity === "basic") {
    return (
      <>
        <circle cx="60" cy="60" r="48" fill="none" stroke={`url(#${dark})`} strokeWidth="11" />
        <circle cx="60" cy="60" r="47" fill="none" stroke={`url(#${metal})`} strokeWidth="5" strokeDasharray="35 6 18 6" />
        <circle cx="60" cy="60" r="41" fill="none" stroke="rgba(255,255,255,.24)" strokeWidth="1.6" />
        {[0, 90, 180, 270].map((angle) => (
          <g key={angle} transform={`rotate(${angle} 60 60)`}>
            <path d="M60 4 L68 13 L60 19 L52 13 Z" fill={`url(#${metal})`} stroke="#20242b" strokeWidth="1" />
          </g>
        ))}
      </>
    );
  }

  if (rarity === "improved") {
    return (
      <g filter={`url(#${glow})`}>
        <circle cx="60" cy="60" r="47" fill="none" stroke={`url(#${dark})`} strokeWidth="9" />
        <circle cx="60" cy="60" r="45" fill="none" stroke={`url(#${accent})`} strokeWidth="4" strokeDasharray="26 5" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, index) => (
          <g key={angle} transform={`rotate(${angle} 60 60)`}>
            <path d="M60 3 L69 13 L65 24 L60 20 L55 24 L51 13 Z" fill={`url(#${accent})`} opacity={index % 2 ? 0.72 : 1} />
          </g>
        ))}
        <Crystal x={60} y={8} size={7} fill={`url(#${accent})`} />
        <Crystal x={60} y={112} size={6} fill={`url(#${accent})`} />
      </g>
    );
  }

  if (rarity === "rare") {
    return (
      <g filter={`url(#${glow})`}>
        <circle cx="60" cy="60" r="47" fill="none" stroke={`url(#${dark})`} strokeWidth="10" />
        <path d="M60 8 L82 13 L101 29 L111 52 L107 77 L91 99 L66 111 L39 107 L17 91 L8 66 L13 39 L31 17 Z" fill="none" stroke={`url(#${accent})`} strokeWidth="5" />
        <circle cx="60" cy="60" r="42" fill="none" stroke="rgba(137,225,255,.7)" strokeWidth="1.5" strokeDasharray="12 5" />
        {[0, 90, 180, 270].map((angle) => (
          <g key={angle} transform={`rotate(${angle} 60 60)`}>
            <path d="M60 0 L73 13 L66 29 L60 24 L54 29 L47 13 Z" fill={`url(#${accent})`} stroke="#b8ecff" strokeWidth="1" />
          </g>
        ))}
        <Crystal x={60} y={9} size={8} fill={`url(#${accent})`} />
        <Crystal x={60} y={111} size={7} fill={`url(#${accent})`} />
      </g>
    );
  }

  if (rarity === "epic") {
    const leaves = [-72, -54, -36, -18, 18, 36, 54, 72];
    return (
      <g filter={`url(#${glow})`}>
        <circle cx="60" cy="60" r="47" fill="none" stroke={`url(#${dark})`} strokeWidth="9" />
        <circle cx="60" cy="60" r="44" fill="none" stroke={`url(#${accent})`} strokeWidth="3.5" />
        {leaves.map((angle) => (
          <g key={`l-${angle}`} transform={`rotate(${angle} 60 60)`}>
            <path d="M18 47 C5 38 4 24 16 13 C21 26 29 34 38 39 C31 42 25 45 18 47 Z" fill={`url(#${accent})`} />
          </g>
        ))}
        {leaves.map((angle) => (
          <g key={`r-${angle}`} transform={`rotate(${180 - angle} 60 60)`}>
            <path d="M18 47 C5 38 4 24 16 13 C21 26 29 34 38 39 C31 42 25 45 18 47 Z" fill={`url(#${accent})`} opacity=".82" />
          </g>
        ))}
        <Crystal x={60} y={7} size={9} fill={`url(#${accent})`} />
        <Crystal x={60} y={113} size={9} fill={`url(#${accent})`} />
        <Crystal x={14} y={60} size={5} fill={`url(#${accent})`} rotate={90} />
        <Crystal x={106} y={60} size={5} fill={`url(#${accent})`} rotate={90} />
      </g>
    );
  }

  return (
    <g filter={`url(#${glow})`}>
      <circle cx="60" cy="60" r="47" fill="none" stroke={`url(#${dark})`} strokeWidth="10" />
      <circle cx="60" cy="60" r="44" fill="none" stroke={`url(#${accent})`} strokeWidth="4" />
      {[0, 26, 52, 78, 102, 128, 154, 180].map((angle, index) => (
        <g key={`wing-left-${angle}`} transform={`rotate(${angle - 78} 60 60)`}>
          <path d="M18 49 C4 40 1 25 9 10 C20 25 31 33 41 37 C34 43 27 47 18 49 Z" fill={`url(#${accent})`} opacity={0.72 + (index % 3) * 0.12} />
        </g>
      ))}
      {[0, 26, 52, 78, 102, 128, 154, 180].map((angle, index) => (
        <g key={`wing-right-${angle}`} transform={`rotate(${angle + 102} 60 60)`}>
          <path d="M18 49 C4 40 1 25 9 10 C20 25 31 33 41 37 C34 43 27 47 18 49 Z" fill={`url(#${accent})`} opacity={0.72 + (index % 3) * 0.12} />
        </g>
      ))}
      <path d="M37 17 L45 2 L55 13 L60 -1 L65 13 L75 2 L83 17 L72 25 L48 25 Z" fill={`url(#${accent})`} stroke="#fff0a1" strokeWidth="1" />
      <Crystal x={60} y={11} size={9} fill={`url(#${accent})`} />
      <Crystal x={60} y={111} size={8} fill={`url(#${accent})`} />
      <Crystal x={16} y={49} size={5} fill="#9ad9ff" rotate={-18} />
      <Crystal x={104} y={49} size={5} fill="#9ad9ff" rotate={18} />
      <Crystal x={22} y={79} size={4.5} fill="#ad79ff" rotate={20} />
      <Crystal x={98} y={79} size={4.5} fill="#ad79ff" rotate={-20} />
    </g>
  );
}

export default function AvatarFrame({
  src,
  alt = "Аватар",
  initials = "?",
  color = "#FFB800",
  rarity,
  size = "md",
  className = "",
  imageClassName = "scale-[1.16]",
  onLoad,
  onError,
}) {
  const rawId = useId();
  const uid = rawId.replace(/:/g, "");
  const resolvedSrc = resolveAvatarUrl(src);
  const resolvedRarity = resolveAvatarRarity(rarity, src);
  const ids = {
    metal: `avatar-metal-${uid}`,
    accent: `avatar-accent-${uid}`,
    glow: `avatar-glow-${uid}`,
    dark: `avatar-dark-${uid}`,
  };

  return (
    <div className={`avatar-frame avatar-frame--${resolvedRarity} avatar-frame--${size} ${className}`} data-rarity={resolvedRarity}>
      <div className="avatar-frame__portrait" style={{ backgroundColor: color }}>
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

      <svg className="avatar-frame__art" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={ids.metal} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f4f6f8" />
            <stop offset=".3" stopColor="#777e89" />
            <stop offset=".55" stopColor="#272b31" />
            <stop offset=".78" stopColor="#bfc4cc" />
            <stop offset="1" stopColor="#4b515b" />
          </linearGradient>
          <linearGradient id={ids.dark} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#090a0c" />
            <stop offset=".5" stopColor="#272a31" />
            <stop offset="1" stopColor="#050506" />
          </linearGradient>
          <linearGradient id={ids.accent} x1="0" y1="0" x2="1" y2="1">
            {resolvedRarity === "improved" && <><stop offset="0" stopColor="#d9ff8b" /><stop offset=".35" stopColor="#61ff35" /><stop offset=".7" stopColor="#0c9b2b" /><stop offset="1" stopColor="#b6ff57" /></>}
            {resolvedRarity === "rare" && <><stop offset="0" stopColor="#d9f8ff" /><stop offset=".28" stopColor="#42cfff" /><stop offset=".62" stopColor="#0065ff" /><stop offset="1" stopColor="#6de2ff" /></>}
            {resolvedRarity === "epic" && <><stop offset="0" stopColor="#f4b8ff" /><stop offset=".3" stopColor="#c443ff" /><stop offset=".68" stopColor="#5f13cf" /><stop offset="1" stopColor="#ef7cff" /></>}
            {resolvedRarity === "legendary" && <><stop offset="0" stopColor="#fff4a6" /><stop offset=".25" stopColor="#ffd83c" /><stop offset=".55" stopColor="#f08c00" /><stop offset=".78" stopColor="#ffcf24" /><stop offset="1" stopColor="#fff0a1" /></>}
            {resolvedRarity === "basic" && <><stop offset="0" stopColor="#f4f6f8" /><stop offset=".45" stopColor="#747b86" /><stop offset="1" stopColor="#2d3138" /></>}
          </linearGradient>
          <filter id={ids.glow} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation={resolvedRarity === "legendary" ? "2.6" : resolvedRarity === "epic" ? "2.2" : "1.6"} result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <FrameArtwork rarity={resolvedRarity} ids={ids} />
      </svg>
      <span className="avatar-frame__spark avatar-frame__spark--one" aria-hidden="true" />
      <span className="avatar-frame__spark avatar-frame__spark--two" aria-hidden="true" />
      <span className="avatar-frame__spark avatar-frame__spark--three" aria-hidden="true" />
    </div>
  );
}
