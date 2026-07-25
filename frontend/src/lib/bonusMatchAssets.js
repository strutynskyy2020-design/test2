const ASSET_VERSION = "80";
const PIECES_ATLAS = `/bonus-match/atlas/pieces-v80.webp?v=${ASSET_VERSION}`;
const OBSTACLES_ATLAS = `/bonus-match/atlas/obstacles-v80.webp?v=${ASSET_VERSION}`;

const makeSprite = (atlas, index, columns, rows) => {
  const column = index % columns;
  const row = Math.floor(index / columns);
  return Object.freeze({
    backgroundImage: `url("${atlas}")`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${columns * 100}% ${rows * 100}%`,
    backgroundPosition: `${columns > 1 ? (column / (columns - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`,
  });
};

const pieceNames = ["coin", "star", "gift", "cube", "zap", "trophy"];
const obstacleNames = ["ice", "chain", "crate", "stone", "crystal", "web", "shield", "slime", "metal", "core"];

export const BONUS_MATCH_PIECE_SPRITES = Object.freeze(
  Object.fromEntries(pieceNames.map((name, index) => [name, makeSprite(PIECES_ATLAS, index, 3, 2)])),
);

export const BONUS_MATCH_OBSTACLE_SPRITES = Object.freeze(
  Object.fromEntries(obstacleNames.map((name, index) => [name, makeSprite(OBSTACLES_ATLAS, index, 5, 2)])),
);

export const BONUS_MATCH_ARTWORK = Object.freeze([
  PIECES_ATLAS,
  OBSTACLES_ATLAS,
]);

let artworkPromise = null;

const decodeImage = (src) => new Promise((resolve) => {
  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = "high";
  image.onload = async () => {
    try {
      if (typeof image.decode === "function") await image.decode();
      resolve({ src, ok: image.naturalWidth > 0 && image.naturalHeight > 0 });
    } catch (_) {
      resolve({ src, ok: image.naturalWidth > 0 && image.naturalHeight > 0 });
    }
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
