import { getTargetArtwork } from "./targetArtwork";

const catalog = { 4: { image: "/hidden-objects/icons-v7/level-04.example.webp", slots: { key: 7, bird: 8 } } };

test("maps generated artwork by stable target ID, independent of tray ordering", () => {
  const result = ["bird", "key"].map(id => getTargetArtwork(4, { id }, catalog));
  expect(result.map(item => item.slot)).toEqual([8, 7]);
  expect(result[0].image).toBe(result[1].image);
  expect(result.every(item => item.columns === 4 && item.rows === 4)).toBe(true);
});

test("has a safe compatibility fallback for an unknown level or target", () => {
  expect(getTargetArtwork(99, { id: "key", image: "/old.webp" }, catalog)).toEqual({ image: "/old.webp" });
  expect(getTargetArtwork(4, { id: "missing" }, catalog)).toEqual({ image: undefined });
  expect(getTargetArtwork(4, { id: "key" }, { 4: { ...catalog[4], slots: { key: 22 } } })).toEqual({ image: undefined });
});
