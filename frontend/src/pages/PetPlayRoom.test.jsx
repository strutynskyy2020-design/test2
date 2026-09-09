import { act } from "react";
import { createRoot } from "react-dom/client";
import PetPlayRoom from "./PetPlayRoom";
import { gestureCompleted, insideRect, interactionFeedback, interactionRequest, petThought } from "./petPlayroomState";

jest.mock("./PetLiving", () => ({ usePetAmbience: jest.fn() }));
jest.mock("@/components/ui/drawer", () => ({
  Drawer: ({ open, children }) => open ? <div role="dialog">{children}</div> : null,
  DrawerContent: ({ children }) => <div>{children}</div>, DrawerHeader: ({ children }) => <div>{children}</div>,
  DrawerTitle: ({ children }) => <h2>{children}</h2>, DrawerDescription: ({ children }) => <p>{children}</p>,
}));
const snapshot = () => ({ date_key: "2026-09-07", server_time: "2026-09-07T09:00:00Z",
  pet: { name: "Піксель", appearance_id: "orange-tabby-v1", survival: { status: "alive", generation: 1, condition: "healthy" },
    stats: { satiety: 70, mood: 85, energy: 70, cleanliness: 60, health: 100 }, daily: {},
    inventory: { items: [], equipped: {} } },
  catalog: { items: [], room: { appearances: {} } }, life: { sound: "off", routine: { pose: "sit", zone: "bed" } },
  gift: { available: false },
});

describe("playroom rules", () => {
  test("first care and repeat play use distinct endpoints and carry frozen context", () => {
    const state = snapshot();
    expect(interactionRequest(state, "feed", "fish")).toEqual({ url: "/pet/care", body: { action: "feed", option: "fish", date_key: state.date_key, generation: 1 }, idempotent: true });
    state.pet.daily.care_actions = ["feed"];
    const request = interactionRequest(state, "feed", "fish", { date_key: "2026-09-06", generation: 1 });
    expect(request.url).toBe("/pet/interact");
    expect(request.body.date_key).toBe("2026-09-06");
    expect(request.body.request_id.length).toBeGreaterThan(8);
    expect(request.body.effects).toBeUndefined();
  });
  test("rejected daily touch is not submitted for another daily penalty", () => {
    const state = snapshot(); state.pet.daily.rejected_actions = ["pet"];
    expect(interactionRequest(state, "pet", "default").url).toBe("/pet/interact");
  });
  test("server refusal and picky reactions never become a happy eating pose", () => {
    expect(interactionFeedback({ rejected: true }, "pet").reaction).toBe("refuse");
    expect(interactionFeedback({ reaction: "picky" }, "feed").reaction).toBe("sniff");
    expect(interactionFeedback({ interaction: { reaction: "tired", accepted: false } }, "play").accepted).toBe(false);
  });
  test("health and hunger take priority over a happy thought", () => {
    const state = snapshot(); expect(petThought(state).action).toBe("pet");
    state.pet.stats.satiety = 20; expect(petThought(state).action).toBe("feed");
    state.pet.stats.health = 10; expect(petThought(state).action).toBe("health");
  });
  test("food needs an actual drop on the cat, not just a tap or unrelated drag", () => {
    const rect = { left: 20, top: 30, right: 120, bottom: 160 };
    expect(insideRect({ x: 50, y: 50 }, rect)).toBe(true);
    expect(gestureCompleted({ action: "feed", distance: 40 }, { x: 50, y: 50 }, rect)).toBe(true);
    expect(gestureCompleted({ action: "feed", distance: 2 }, { x: 50, y: 50 }, rect)).toBe(false);
    expect(gestureCompleted({ action: "feed", distance: 100 }, { x: 250, y: 50 }, rect)).toBe(false);
  });
  test("scrubbing needs contact; cancelling any gesture never completes care", () => {
    expect(gestureCompleted({ action: "clean", distance: 500, contactDistance: 10 })).toBe(false);
    expect(gestureCompleted({ action: "clean", contactDistance: 145 })).toBe(true);
    expect(gestureCompleted({ action: "pet", contactDistance: 65 })).toBe(true);
    expect(gestureCompleted({ action: "pet", contactDistance: 90, cancelled: true })).toBe(false);
  });
});

describe("visual-first pet screen", () => {
  let container, root, props;
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    props = { snapshot: snapshot(), online: true, busy: false, reducedMotion: true, perform: jest.fn().mockResolvedValue({}), navigate: jest.fn(), setSheet: jest.fn(), claimGift: jest.fn(), renderPanel: jest.fn((id) => <span>{`Деталі: ${id}`}</span>) };
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); delete global.IS_REACT_ACT_ENVIRONMENT; });
  const render = () => act(() => root.render(<PetPlayRoom {...props} />));
  const label = (text) => container.querySelector(`[aria-label="${text}"]`);
  const textButton = (text) => [...container.querySelectorAll("button")].find((node) => node.textContent === text);
  const pointer = (target, type, x, y) => {
    const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(e, "pointerId", { value: 1 });
    target.dispatchEvent(e);
  };
  test("main view has four needs and no statistics dashboard; menu reveals details", () => {
    render();
    expect(label("Турбота про котика").querySelectorAll("button")).toHaveLength(4);
    expect(container.textContent).not.toMatch(/70|85|100|Денний ритуал|ФОКУС ДНЯ/);
    act(() => label("Меню котика").click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => textButton("Стан котика").click());
    expect(container.textContent).toContain("Деталі: health");
  });
  test("keyboard/tap food alternative submits one care and no reward claim", async () => {
    render(); act(() => textButton("Їжа").click());
    expect(props.perform).not.toHaveBeenCalled();
    await act(async () => textButton("Пригостити").click());
    expect(props.perform).toHaveBeenCalledTimes(1);
    expect(props.perform.mock.calls[0][0].url).toBe("/pet/care");
    expect(props.perform.mock.calls[0][0].body.option).toBe("fish");
    expect(props.claimGift).not.toHaveBeenCalled();
  });
  test("dragging food over the cat does not write until release, then writes once", async () => {
    render(); act(() => textButton("Їжа").click());
    const food = label("Рибка"), stage = label("Ігрова кімната котика");
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 300, width: 300, height: 300 });
    container.querySelector('[data-testid="play-cat"]').getBoundingClientRect = () => ({ left: 80, top: 80, right: 220, bottom: 240 });
    act(() => { pointer(food, "pointerdown", 100, 380); pointer(food, "pointermove", 150, 150); });
    expect(props.perform).not.toHaveBeenCalled();
    await act(async () => pointer(food, "pointerup", 150, 150));
    expect(props.perform).toHaveBeenCalledTimes(1);
  });
  test("cancelled food drag does not award or change needs", () => {
    render(); act(() => textButton("Їжа").click());
    const food = label("Рибка");
    act(() => { pointer(food, "pointerdown", 100, 380); pointer(food, "pointercancel", 100, 200); pointer(food, "pointerup", 100, 200); });
    expect(props.perform).not.toHaveBeenCalled();
  });
  test("the click following a ball drag does not cancel its flight", async () => {
    render(); act(() => textButton("Гра").click());
    const ball = label("М’ячик"), stage = label("Ігрова кімната котика");
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 300, width: 300, height: 300 });
    act(() => { pointer(ball, "pointerdown", 100, 380); pointer(ball, "pointermove", 170, 240); });
    await act(async () => { pointer(ball, "pointerup", 180, 240); });
    expect(container.querySelector(".play-rolling-ball")).not.toBeNull();
    act(() => ball.click());
    expect(container.querySelector(".play-rolling-ball")).not.toBeNull();
  });
  test("a clean room says so before the player attempts a scrub", () => {
    props.snapshot.pet.stats.cleanliness = 98; render();
    act(() => textButton("Чистота").click());
    expect(container.querySelector(".play-tray-heading").textContent).toContain("У кімнаті вже чисто");
    expect(textButton("Помити").disabled).toBe(true);
    expect(container.querySelector(".play-scrub-surface")).toBeNull();
    expect(props.perform).not.toHaveBeenCalled();
  });
  test("a failed background refresh retains the scene and offers retry", () => {
    props.syncError = true; props.retrySync = jest.fn(); render();
    expect(container.querySelector('[data-testid="play-cat"]')).not.toBeNull();
    expect(textButton("Їжа").disabled).toBe(true);
    act(() => textButton("Повторити").click());
    expect(props.retrySync).toHaveBeenCalledTimes(1);
  });
  test("camera and collar are absent from the playroom", () => {
    render();
    expect(label("Зробити фото котика")).toBeNull();
    expect(container.querySelector(".play-collar-v3")).toBeNull();
  });
  test("two clicks while a request is pending never duplicate it", async () => {
    let resolve; props.perform = jest.fn(() => new Promise((r) => { resolve = r; }));
    render(); act(() => textButton("Чистота").click());
    act(() => { textButton("Помити").click(); textButton("Помити").click(); });
    expect(props.perform).toHaveBeenCalledTimes(1);
    await act(async () => resolve({}));
  });
  test("offline view retains the cat but disallows mutations", () => {
    props.online = false; props.busy = true; render();
    expect(container.querySelector('[data-testid="play-cat"]')).not.toBeNull();
    expect(textButton("Їжа").disabled).toBe(true);
    act(() => label("Піксель: торкнутися або погладити").click());
    expect(props.perform).not.toHaveBeenCalled();
  });
  test("critical warning remains visible without opening numbers", () => {
    props.snapshot.pet.survival.condition = "critical"; props.snapshot.pet.stats.health = 10; render();
    expect(container.textContent).toContain("Без допомоги котик може померти");
    act(() => container.querySelector(".play-urgent").click());
    expect(container.textContent).toContain("Деталі: health");
  });
  test.each(["dead", "runaway"])("%s pet stays absent and cannot be stroked", (status) => {
    props.snapshot.pet.survival.status = status; render();
    expect(container.querySelector('[data-testid="play-cat"]')).toBeNull();
    expect(textButton("Гра").disabled).toBe(true);
  });
  test("letter, event, gift and album open existing features", () => {
    props.snapshot.story = { current_scene: { id: "a" } };
    props.snapshot.daily_event = { id: "plant-crash", title: "Розбита рослина" };
    props.snapshot.gift.available = true; render();
    act(() => label("Лист: сюжетна пригода").click()); expect(props.setSheet).toHaveBeenCalledWith("story");
    act(() => label("Розбита рослина").click()); expect(props.setSheet).toHaveBeenCalledWith("event");
    act(() => label("Забрати подарунок котика").click()); expect(props.claimGift).toHaveBeenCalledTimes(1);
    act(() => label("Щоденник пригод").click()); expect(props.navigate).toHaveBeenCalledWith("/pet/journal");
  });
  test("a server-rejected touch has an unhappy reaction, not hearts", async () => {
    props.perform.mockResolvedValue({ rejected: true }); render();
    await act(async () => label("Піксель: торкнутися або погладити").click());
    expect(container.querySelector('[data-testid="play-cat"]').getAttribute("data-reaction")).toBe("refuse");
    expect(container.querySelector(".play-cat-love")).toBeNull();
  });
  test("changing day cancels an in-progress gesture", () => {
    render(); act(() => textButton("Їжа").click());
    const food = label("Рибка"); act(() => pointer(food, "pointerdown", 100, 380));
    props.snapshot = { ...props.snapshot, date_key: "2026-09-08" }; render();
    act(() => pointer(container, "pointerup", 120, 200));
    expect(props.perform).not.toHaveBeenCalled();
  });
  test("reopened server sleep keeps lamp off and wake sends an explicit command", async () => {
    props.snapshot.life.sleep = { active: true, ends_at: "2026-09-07T12:00:00Z" };
    render();
    expect(container.querySelector(".play-lights.off")).not.toBeNull();
    await act(async () => label("Увімкнути лампу").click());
    expect(props.perform.mock.calls[0][0]).toMatchObject({ url: "/pet/sleep", body: { action: "wake", generation: 1, date_key: "2026-09-07" } });
    // A local click alone must never pretend the server has woken the cat.
    expect(container.querySelector(".play-lights.off")).not.toBeNull();
  });
});
