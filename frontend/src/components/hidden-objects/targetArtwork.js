import atlases from "./artwork-v7.json";

// Slot lookup uses the target ID, never the shuffled tray position.
export function getTargetArtwork(levelId, target, catalog = atlases) {
  const atlas = catalog[String(levelId)];
  const slot = atlas?.slots?.[target.id];
  if (atlas?.image && Number.isInteger(slot) && slot >= 0 && slot < 16) {
    return { image: atlas.image, slot, columns: 4, rows: 4 };
  }
  return { image: target.image };
}
