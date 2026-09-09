import { act } from "react";
import { createRoot } from "react-dom/client";
import { dirtSpots, scrubDirt, dirtIsClean, throwBall, stepBall, wandReady } from "./petGestures";
import PetCatSprite, { catSequence, clearRigAssetCache } from "./PetCatSprite";
import PetWorldEvents, { eventObject } from "./PetWorldEvents";
import { interactionRequest } from "./petPlayroomState";
import { livingSceneState } from "./petLivingState";
import { usePetSounds } from "./usePetSounds";

const state = () => ({ date_key: "2026-09-07", pet: { name: "Піксель", stats: { energy: 20 }, survival: { status: "alive", generation: 1 }, inventory: { equipped: {} }, daily: {} }, life: { sleep: { active: false } }, catalog: { items: [] } });
test("scrubbing empty space or one spot cannot clean the whole room", () => {
  let spots = dirtSpots(30);
  expect(scrubDirt(spots, { x: 0, y: 0 }, { x: 90, y: 0 })).toEqual(spots);
  const { x, y } = spots[0];
  for (let i = 0; i < 6; i++) spots = scrubDirt(spots, { x: x - 8, y }, { x: x + 8, y });
  expect(spots[0].remaining).toBe(0);
  expect(dirtIsClean(spots)).toBe(false);
  for (const spot of spots) for (let i = 0; i < 6; i++) spots = scrubDirt(spots, { x: spot.x - 8, y: spot.y }, { x: spot.x + 8, y: spot.y });
  expect(dirtIsClean(spots)).toBe(true);
  expect(dirtIsClean([])).toBe(false);
  expect(dirtSpots(100)).toHaveLength(0);
  expect(dirtSpots(100, true)).toHaveLength(6);
});
test("ball rolls, bounces, slows and eventually stops within the floor", () => {
  let ball = throwBall({ x: 90, y: 60 }, { x: 80, y: -45 });
  const speed = Math.hypot(ball.vx, ball.vy);
  for (let i = 0; i < 260 && !ball.stopped; i++) {
    ball = stepBall(ball, .016, null);
    expect(ball.x).toBeGreaterThanOrEqual(9); expect(ball.x).toBeLessThanOrEqual(91);
    expect(ball.y).toBeGreaterThanOrEqual(58); expect(ball.y).toBeLessThanOrEqual(87);
  }
  expect(ball.stopped).toBe(true); expect(ball.bounces).toBeGreaterThan(0);
  expect(ball.distance).toBeGreaterThan(8); expect(Math.hypot(ball.vx, ball.vy)).toBeLessThan(speed);
});
test("feather requires changes of direction, unlike a single ball throw", () => {
  expect(wandReady({ distance: 200, directionChanges: 0, startedAt: 0 }, 800)).toBe(false);
  expect(wandReady({ distance: 200, directionChanges: 3, startedAt: 0 }, 100)).toBe(false);
  expect(wandReady({ distance: 200, directionChanges: 3, startedAt: 0 }, 800)).toBe(true);
});
test("real frame sequences preserve sleep priority and reduced motion", () => {
  expect(catSequence({ pose: "sleep", reaction: "purr" })).toBe("sleep");
  expect(catSequence({ pose: "sit", walking: "walk-left" })).toBe("walk-left");
  expect(catSequence({ pose: "sit", reaction: "eat", quiet: true })).toBe("eat");
  expect(catSequence({ pose: "sit", walking: "walk-right", quiet: true })).toBe("idle");
});
test("only server-confirmed sleep turns lights off; repeats use sleep endpoint", () => {
  const snapshot = state();
  expect(livingSceneState(snapshot, Date.now()).pose).not.toBe("sleep");
  snapshot.life.sleep.active = true;
  expect(livingSceneState(snapshot, Date.now()).pose).toBe("sleep");
  snapshot.pet.daily.care_actions = ["rest"];
  expect(interactionRequest(snapshot, "rest", "default").url).toBe("/pet/sleep");
  expect(interactionRequest(snapshot, "pet", "default", undefined, "belly").body.zone).toBe("belly");
});

describe("sprite loading and room props", () => {
  let root, host, OriginalImage, requests;
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    requests = []; OriginalImage = global.Image;
    clearRigAssetCache();
    global.Image = class { constructor() { this.naturalWidth = 256; this.naturalHeight = 342; requests.push(this); } };
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); global.Image = OriginalImage; delete global.IS_REACT_ACT_ENVIRONMENT; });
  const cat = (reaction) => <PetCatSprite pose="sit" snapshot={state()} reaction={reaction} aim={0} now={0} quiet={true} onClick={jest.fn()} onPointerDown={jest.fn()} />;
  test("all rig parts load together; reactions never swap full-cat frames", async () => {
    act(() => root.render(cat("idle")));
    await act(async () => requests.forEach((image) => image.onload?.()));
    expect(host.querySelector('[data-rig-ready="true"]')).not.toBeNull();
    const previous = [...host.querySelectorAll("svg image")].map(image => image.getAttribute("href"));
    const count = requests.length;
    act(() => root.render(cat("eat")));
    expect([...host.querySelectorAll("svg image")].map(image => image.getAttribute("href"))).toEqual(previous);
    expect(requests).toHaveLength(count);
    expect(host.querySelector(".play-cat-frame")).toBeNull();
    expect(host.querySelectorAll(".play-cat-touch")).toHaveLength(2); // Belly stays hidden until trust is sufficient.
  });
  test("missing layers keep the approved poster, never a retired cat", async () => {
    await act(async () => root.render(cat("idle")));
    await act(async () => requests.forEach(image => image.onerror?.()));
    expect(host.querySelector(".play-cat-frame").getAttribute("src")).toContain("v6/rig/sit-poster.webp");
    expect(host.querySelector('img[src*="v2/"]')).toBeNull();
    act(() => host.querySelector(".play-cat-frame").dispatchEvent(new Event("error")));
    expect(host.querySelector('[role="img"]')).not.toBeNull();
  });
  test("resolved event props open memories instead of replaying rewards", () => {
    const snapshot = state(), navigate = jest.fn(), setSheet = jest.fn();
    snapshot.life.scene_marks = [{ id: "box", kind: "box", source: "surprise-box", label: "Тунель" }];
    act(() => root.render(<PetWorldEvents snapshot={snapshot} navigate={navigate} setSheet={setSheet} />));
    act(() => host.querySelector('[aria-label="Спогад: Тунель"]').click());
    expect(navigate).toHaveBeenCalledWith("/pet/journal"); expect(setSheet).not.toHaveBeenCalled();
    expect(eventObject("window-butterfly")).toBe("butterfly");
    expect(eventObject("visitor-cat")).toBe("visitor");
  });
});

test("optional sound requires a gesture and closes when muted", () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const previous = window.AudioContext, oscillator = () => ({ frequency: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() }, connect: jest.fn(), disconnect: jest.fn(), start: jest.fn(), stop: jest.fn() });
  const ctx = { state: "running", currentTime: 0, resume: jest.fn().mockResolvedValue(), close: jest.fn().mockResolvedValue(), createOscillator: jest.fn(oscillator), createGain: () => ({ gain: { setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() }, connect: jest.fn(), disconnect: jest.fn() }) };
  window.AudioContext = jest.fn(() => ctx);
  const host = document.createElement("div"), root = createRoot(host);
  let play;
  function Harness({ enabled }) { play = usePetSounds(enabled); return null; }
  act(() => root.render(<Harness enabled={true} />));
  act(() => play("eat")); expect(window.AudioContext).not.toHaveBeenCalled();
  act(() => document.dispatchEvent(new Event("pointerdown")));
  act(() => play("eat")); expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
  act(() => root.render(<Harness enabled={false} />)); expect(ctx.close).toHaveBeenCalledTimes(1);
  act(() => play("eat")); expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
  act(() => root.unmount()); window.AudioContext = previous; delete global.IS_REACT_ACT_ENVIRONMENT;
});
