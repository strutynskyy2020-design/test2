import {
  derivePetLifeView, derivePetPose, getRoomLayers, mergeRoomPlacement,
  isUsablePetImage, petRefetchInterval, snapRoomPlacement,
} from "./petRoom";
import {
  activeLaserTargets, eventFinishPayload, memoryFinishPayload,
  normalizeGameId, publicGameChallenge, withClientDuration,
} from "./petGames";

describe("layered pet room helpers", () => {
  test("care reactions expire into the normal energy pose", () => {
    const actedAt = Date.parse("2026-09-04T12:00:00Z");
    const pet = { stats: { energy: 80 }, daily: { last_action: "feed", last_action_at: new Date(actedAt).toISOString() } };

    expect(derivePetPose(pet, actedAt + 5_000)).toBe("eat");
    expect(derivePetPose(pet, actedAt + 13_000)).toBe("sit");
    expect(derivePetPose({ ...pet, stats: { energy: 20 } }, actedAt + 13_000)).toBe("sleep");
  });

  test("a story or random-event reaction temporarily controls the cat pose", () => {
    const reactedAt = Date.parse("2026-09-04T12:00:00Z");
    const pet = {
      stats: { energy: 80 },
      daily: {
        narrative_pose: "play",
        narrative_reaction_at: new Date(reactedAt).toISOString(),
        last_action: "feed",
        last_action_at: new Date(reactedAt - 1_000).toISOString(),
      },
    };

    expect(derivePetPose(pet, reactedAt + 5_000)).toBe("play");
    expect(derivePetPose(pet, reactedAt + 13_000)).toBe("sit");
  });

  test("active expedition hides the cat before every other pose rule", () => {
    expect(derivePetPose({ expedition: { status: "active" }, stats: { energy: 10 } })).toBe("away");
  });

  test("ended life state hides the cat before care pose rules", () => {
    const actedAt = Date.parse("2026-09-04T12:00:00Z");
    const pet = {
      survival: { status: "runaway" },
      expedition: { status: "claimed" },
      stats: { energy: 80 },
      daily: { last_action: "feed", last_action_at: new Date(actedAt).toISOString() },
    };

    expect(derivePetPose(pet, actedAt + 5_000)).toBe("away");
  });

  test("maps strict survival warnings and debuffs into render-safe copy", () => {
    const life = derivePetLifeView({
      stats: { satiety: 18, mood: 30, energy: 12, health: 42, cleanliness: 20 },
      survival: {
        status: "alive",
        condition: "sick",
        illness: "weakness",
        mood_state: "do_not_touch",
        warning: { severity: "danger", title: "Небезпека", message: "Здоров’я продовжує падати" },
      },
    });

    expect(life).toMatchObject({ alive: true, tone: "danger", label: "Захворів", riskLabel: "Здоров’я продовжує падати" });
    expect(life.debuffs).toEqual(expect.arrayContaining(["Сильна слабкість", "Не чіпай мене", "Сильний голод", "Брудно", "Майже немає сил"]));
    expect(typeof life.riskLabel).toBe("string");
  });

  test("describes terminal states without exposing active interactions", () => {
    expect(derivePetLifeView({ survival: { status: "runaway", condition: "critical" }, stats: {} })).toMatchObject({
      alive: false,
      status: "runaway",
      label: "Котик пішов",
      debuffs: [],
    });
    expect(derivePetLifeView({ survival: { status: "dead", condition: "critical" }, stats: {} })).toMatchObject({
      alive: false,
      status: "dead",
      label: "Життя завершилося",
    });
  });

  test("polls a living pet and stops polling terminal states", () => {
    expect(petRefetchInterval({ pet: { survival: { status: "alive" } } })).toBe(60_000);
    expect(petRefetchInterval({ pet: { survival: { status: "alive" }, expedition: { status: "active" } } })).toBe(30_000);
    expect(petRefetchInterval({ pet: { survival: { status: "dead" } } })).toBe(false);
  });

  test("treats a transparent 1x1 service-worker fallback as a failed cat sprite", () => {
    expect(isUsablePetImage({ naturalWidth: 1, naturalHeight: 1 })).toBe(false);
    expect(isUsablePetImage({ naturalWidth: 512, naturalHeight: 512 })).toBe(true);
    expect(isUsablePetImage(null)).toBe(false);
  });

  test("normalizes three distinct public minigame contracts", () => {
    const memory = publicGameChallenge({ game_id: "memory", public_challenge: { kind:"sequence", palette_size:4, cues:[3,1,0], cue_ms:520, min_duration_ms:3600 } });
    const laser = publicGameChallenge({ game_id: "laser", public_challenge: { kind:"timed-targets", lanes:4, targets:[{id:7,lane:2,at_ms:900,window_ms:420}], duration_ms:18000, min_duration_ms:15000, answer_key:"private" } });
    const sorting = publicGameChallenge({ game_id: "sorting", public_challenge: { kind:"sorting", lanes:[{id:0,label:"До миски"}], cards:[{id:2,label:"Рибка",icon:"fish",correct_lane:0}], duration_ms:30000, min_duration_ms:3000 } });

    expect(memory).toMatchObject({ kind:"sequence", cues:[3,1,0], durationMs:25000 });
    expect(laser).toMatchObject({ kind:"timed-targets", lanes:4, targets:[{id:7,lane:2,atMs:900,windowMs:420}] });
    expect(sorting).toMatchObject({ kind:"sorting", cards:[{id:2,label:"Рибка",icon:"fish"}] });
    expect(sorting.cards[0]).not.toHaveProperty("correct_lane");
    expect(normalizeGameId("light")).toBe("laser");
  });

  test("shows laser targets only inside the server-valid tap window", () => {
    const target = { id:4, lane:1, atMs:1000, windowMs:420 };
    expect(activeLaserTargets([target], 924, new Set())).toEqual([]);
    expect(activeLaserTargets([target], 925, new Set())).toEqual([target]);
    expect(activeLaserTargets([target], 1421, new Set())).toEqual([]);
    expect(activeLaserTargets([target], 1100, new Set([4]))).toEqual([]);
  });

  test("builds server-scored finish payloads and bounds reported client time", () => {
    expect(memoryFinishPayload([1,"2",3])).toEqual({ moves:[1,2,3] });
    expect(eventFinishPayload([{ target_id:3, at_ms:810, lane:2 }, { target_id:4, at_ms:1200 }])).toEqual({ events:[{ target_id:3, at_ms:810, lane:2 }, { target_id:4, at_ms:1200 }] });
    expect(withClientDuration({ moves:[1] }, 900, 3600, 25000).client_duration_ms).toBe(3600);
    expect(withClientDuration({ moves:[1] }, 40000, 3600, 25000).client_duration_ms).toBe(26000);
  });

  test("renders equipped layers and owned trophies but not stale or collar entries", () => {
    const room = (asset, zIndex, extra = {}) => ({ asset, x: 50, y: 50, width: 20, z_index: zIndex, ...extra });
    const snapshot = {
      pet: {
        inventory: {
          items: ["bed-basic", "camera-retro", "collar-violet"],
          equipped: { bed: "bed-basic", floor: "missing-rug", collar: "collar-violet", shelf: "camera-retro" },
        },
      },
      catalog: {
        items: [
          { id: "bed-basic", slot: "bed", room: room("/bed.webp", 30) },
          { id: "rug-cyan", slot: "floor", room: room("/rug.webp", 20) },
          { id: "collar-violet", slot: "collar", room: room("/collar.webp", 45) },
          { id: "camera-retro", slot: "expedition", room: room("/camera.webp", 14, { slot: "shelf" }) },
        ],
      },
    };

    expect(getRoomLayers(snapshot).map((item) => item.id)).toEqual(["camera-retro", "bed-basic"]);
    snapshot.pet.inventory.equipped.shelf = null;
    expect(getRoomLayers(snapshot).map((item) => item.id)).toEqual(["bed-basic"]);
  });

  test("merges only saved x/y coordinates without mutating catalog geometry", () => {
    const item = {
      id: "rug-cyan",
      room: { asset: "/rug.webp", x: 50, y: 72, width: 68, z_index: 20, anchor: "center" },
    };

    const moved = mergeRoomPlacement(item, { "rug-cyan": { x: 44, y: 76, width: 999, z_index: 999 } });

    expect(moved.room).toEqual({ asset: "/rug.webp", x: 44, y: 76, width: 68, z_index: 20, anchor: "center" });
    expect(item.room.x).toBe(50);
    expect(mergeRoomPlacement(item, { "rug-cyan": { x: "bad", y: 76 } })).toBe(item);
  });

  test("snaps positions to the 2% grid and enforces item movement bounds", () => {
    const room = {
      x: 50,
      y: 70,
      width: 20,
      move_bounds: { min_x: 20, max_x: 80, min_y: 50, max_y: 80 },
    };

    expect(snapRoomPlacement(room, 63.1, 93)).toEqual({ x: 64, y: 80 });
    expect(snapRoomPlacement(room, 3, 47)).toEqual({ x: 20, y: 50 });
    expect(snapRoomPlacement(room, Number.NaN, undefined)).toEqual({ x: 50, y: 70 });
  });

  test("room layers apply persisted per-user positions", () => {
    const snapshot = {
      pet: {
        room_layout: { "bed-basic": { x: 62, y: 82 } },
        inventory: { items: ["bed-basic"], equipped: { bed: "bed-basic" } },
      },
      catalog: {
        items: [{ id: "bed-basic", slot: "bed", room: { asset: "/bed.webp", x: 50, y: 77, width: 59, z_index: 30 } }],
      },
    };

    expect(getRoomLayers(snapshot)[0].room).toMatchObject({ x: 62, y: 82, width: 59, z_index: 30 });
    expect(getRoomLayers(snapshot, { "bed-basic": { x: 46, y: 74 } })[0].room).toMatchObject({ x: 46, y: 74 });
  });
});
