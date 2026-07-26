const ASSET_VERSION = "90";
const BASE = `/bonus-match/v90`;
const LEGACY_OBSTACLES_ATLAS = `/bonus-match/atlas/obstacles-v85.webp?v=85`;

const imageSprite = (name, extra = {}) => Object.freeze({
  backgroundImage: `url("${BASE}/${name}.png?v=${ASSET_VERSION}")`,
  backgroundRepeat: "no-repeat",
  backgroundSize: "contain",
  backgroundPosition: "center",
  ...extra,
});

const makeAtlasSprite = (index, columns = 5, rows = 2) => {
  const column = index % columns;
  const row = Math.floor(index / columns);
  return Object.freeze({
    backgroundImage: `url("${LEGACY_OBSTACLES_ATLAS}")`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${columns * 100}% ${rows * 100}%`,
    backgroundPosition: `${(column / (columns - 1)) * 100}% ${(row / (rows - 1)) * 100}%`,
  });
};

export const BONUS_MATCH_PIECE_SPRITES = Object.freeze({
  coin: imageSprite("coin"),
  trophy: imageSprite("trophy"),
  star: imageSprite("star"),
  cube: imageSprite("cube"),
  zap: imageSprite("zap"),
  gift: imageSprite("gift"),
});

export const BONUS_MATCH_OBSTACLE_SPRITES = Object.freeze({
  ice: makeAtlasSprite(0),
  chain: imageSprite("chain"),
  crate: imageSprite("crate"),
  stone: imageSprite("stone"),
  crystal: makeAtlasSprite(4),
  web: imageSprite("web-overlay"),
  shield: makeAtlasSprite(6),
  slime: makeAtlasSprite(7),
  metal: makeAtlasSprite(8),
  core: makeAtlasSprite(9),
});

export const BONUS_MATCH_CELL_IMAGE = `${BASE}/cell.png?v=${ASSET_VERSION}`;
export const BONUS_MATCH_BOARD_FRAME_IMAGE = `${BASE}/board-frame.png?v=${ASSET_VERSION}`;
export const BONUS_MATCH_HIT_BADGES = Object.freeze({
  1: `${BASE}/hit-1.png?v=${ASSET_VERSION}`,
  2: `${BASE}/hit-2.png?v=${ASSET_VERSION}`,
});

export const BONUS_MATCH_ARTWORK = Object.freeze([
  ...Object.values(BONUS_MATCH_PIECE_SPRITES).map((sprite) => sprite.backgroundImage.match(/url\("(.+)"\)/)?.[1]).filter(Boolean),
  ...["chain", "crate", "stone", "web-overlay", "cell", "board-frame", "hit-1", "hit-2"].map((name) => `${BASE}/${name}.png?v=${ASSET_VERSION}`),
  LEGACY_OBSTACLES_ATLAS,
]);

let artworkPromise = null;
const decodeImage = (src) => new Promise((resolve) => {
  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = "high";
  image.onload = async () => {
    try { if (typeof image.decode === "function") await image.decode(); } catch (_) {}
    resolve({ src, ok: image.naturalWidth > 0 && image.naturalHeight > 0 });
  };
  image.onerror = () => resolve({ src, ok: false });
  image.src = src;
});

export const preloadBonusMatchArtwork = () => {
  if (!artworkPromise) {
    artworkPromise = Promise.all(BONUS_MATCH_ARTWORK.map(decodeImage)).then((results) => ({
      ok: results.every((result) => result.ok),
      results,
    }));
  }
  return artworkPromise;
};
