import { act } from "react";
import { createRoot } from "react-dom/client";
import { ShopPanel, canAffordPetItem } from "./PetLiving";
import { livingCatOffset, livingSceneState } from "./petLivingState";

jest.mock("@/lib/api", () => ({ __esModule: true, default: {}, extractError: () => "Помилка" }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/components/ui/drawer", () => ({
  Drawer: ({ open, children }) => open ? <div role="dialog">{children}</div> : null,
  DrawerContent: ({ children }) => <div>{children}</div>,
  DrawerHeader: ({ children }) => <div>{children}</div>,
  DrawerTitle: ({ children }) => <h2>{children}</h2>,
  DrawerDescription: ({ children }) => <p>{children}</p>,
}));

const snapshot = () => ({
  date_key: "2026-09-07", server_time: "2026-09-07T09:00:00Z",
  pet: { user_id: "a", name: "Піксель", friendship_level: 1, survival: { status: "alive", generation: 1 }, stats: { energy: 80 }, daily: {},
    inventory: { items: ["bed-basic"], materials: { cardboard: 5, leaf: 2, feather: 1 }, equipped: { bed: "bed-basic" } }, room_layout: {} },
  life: { condition: {}, routine: { pose: "sit", zone: "bed" } },
  catalog: { materials: { cardboard: "Картон", leaf: "Листок", feather: "Пір’їнка" }, items: [
    { id: "bed-basic", name: "Лежанка", slot: "bed", rarity: "basic", price: { cardboard: 2 }, room: { asset: "/pet/bed.webp", x: 50, y: 77, width: 59, z_index: 30, anchor: "bottom" } },
    { id: "rug-cyan", name: "Килим", slot: "floor", rarity: "improved", unlock_level: 8, price: { cardboard: 5, leaf: 2, feather: 1 }, room: { asset: "/pet/rug.webp", x: 50, y: 72, width: 68, z_index: 20, anchor: "center" } },
  ] },
});

describe("material shop", () => {
  let container, root;
  beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); delete global.IS_REACT_ACT_ENVIRONMENT; });
  const button = (text) => [...container.querySelectorAll("button")].find((b) => b.textContent === text);

  test("shows price, never level locks, and purchases only after confirmation", async () => {
    const perform = jest.fn().mockResolvedValue({ message: "Придбано" });
    const state = snapshot();
    act(() => root.render(<ShopPanel snapshot={state} perform={perform} busy={false} />));
    expect(button("Придбати").disabled).toBe(false);
    expect(container.textContent).not.toContain("Рівень 8");
    expect(container.textContent).toContain("Картон");
    act(() => button("Придбати").click());
    expect(perform).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    // Refetch must not silently retarget an open confirmation to a new cat/day.
    const next = { ...state, date_key: "2026-09-08", pet: { ...state.pet, survival: { status: "alive", generation: 2 } } };
    act(() => root.render(<ShopPanel snapshot={next} perform={perform} busy={false} />));
    await act(async () => button("Підтвердити покупку").click());
    expect(perform).toHaveBeenCalledWith({ url: "/pet/shop/purchase", body: { item_id: "rug-cyan", date_key: "2026-09-07", generation: 1 } });
  });

  test("insufficient wallet and offline state disable spending", () => {
    const state = snapshot();
    state.pet.inventory.materials.feather = 0;
    act(() => root.render(<ShopPanel snapshot={state} perform={jest.fn()} busy={false} />));
    expect(button("Бракує матеріалів").disabled).toBe(true);
    act(() => root.render(<ShopPanel snapshot={snapshot()} perform={jest.fn()} busy />));
    expect(button("Придбати").disabled).toBe(true);
  });

  test("owned furniture retains equip and remove actions without repurchase", async () => {
    const perform = jest.fn().mockResolvedValue({ message: "Знято" });
    act(() => root.render(<ShopPanel snapshot={snapshot()} perform={perform} busy={false} />));
    await act(async () => button("Забрати з кімнати").click());
    expect(perform).toHaveBeenCalledWith({ url: "/pet/collection/unequip", body: { item_id: "bed-basic" } });
  });

  test("missing price does not accidentally enable free purchases", () => {
    expect(canAffordPetItem({}, { cardboard: 5 })).toBe(false);
    expect(canAffordPetItem({ price: { leaf: 2 } }, { leaf: 1 })).toBe(false);
    expect(canAffordPetItem({ price: { leaf: 2 } }, { leaf: 2 })).toBe(true);
  });
});

describe("living room movement", () => {
  const now = Date.parse("2026-09-07T09:00:00Z");
  test.each(["dead", "runaway"])("%s overrides narrative replay and daily animation", (status) => {
    const state = snapshot(); state.pet.survival.status = status;
    expect(livingSceneState(state, now, { narrativePose: "play" }).pose).toBe("away");
  });
  test("active expedition stays away during narrative replay", () => {
    const state = snapshot(); state.pet.expedition = { status: "active" };
    expect(livingSceneState(state, now, { narrativePose: "sit" }).pose).toBe("away");
  });
  test("cat sleeps at night and does not roam", () => {
    const state = snapshot(); state.life.routine = { pose: "sleep", zone: "bed" };
    expect(livingSceneState(state, Date.parse("2026-09-07T23:00:00Z"))).toMatchObject({ pose: "sleep", zone: "bed", roaming: false, night: true });
  });
  test("reduced-motion users get stable room zones", () => {
    expect(livingSceneState(snapshot(), now, { reducedMotion: true })).toMatchObject({ pose: "sit", zone: "bed", roaming: false });
  });
  test("recent care wins over routine and follows the bowl", () => {
    const state = snapshot(); state.pet.daily = { last_action: "feed", last_action_at: new Date(now).toISOString() };
    expect(livingSceneState(state, now + 5000)).toMatchObject({ pose: "eat", zone: "bowl", roaming: false });
  });
  test("moving bed changes the cat ground anchor", () => {
    const state = snapshot(); state.pet.room_layout = { "bed-basic": { x: 60, y: 76 } };
    const offset = livingCatOffset(state, { x: 50, y: 74, width: 37 }, "bed", "sit");
    expect(offset).toEqual({ x: 10, y: 6 });
  });
  test("targets remain inside room even with edge furniture placements", () => {
    const offset = livingCatOffset(snapshot(), { x: 50, y: 74, width: 47 }, "window", "sleep");
    expect(50 + offset.x + 47 / 2).toBeLessThanOrEqual(98);
    expect(74 + offset.y).toBeLessThanOrEqual(81);
  });
});
