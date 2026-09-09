import { derivePetPose, getRoomLayers } from "./petRoom";

export function livingSceneState(snapshot, now, { editing = false, reducedMotion = false, narrativePose = null, inspecting = null } = {}) {
  const { pet, life } = snapshot;
  const basePose = derivePetPose(pet, now);
  if (basePose === "away" || !life || editing) return { pose: basePose, zone: null, roaming: false };
  if (life.sleep?.active) return { pose: "sleep", zone: "bed", roaming: false, night: true };
  const recent = (date) => { const age = now - new Date(date || "").getTime(); return Number.isFinite(age) && age >= 0 && age <= 12_000; };
  const activeCare = recent(pet.daily?.last_action_at) || recent(pet.daily?.narrative_reaction_at);
  const activeActivity = recent(life.activity?.at);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hourCycle: "h23" }).format(now));
  const routine = life.routine?.slots?.find((row) => hour >= row.start && hour < row.end) || life.routine || {};
  const tired = Number(pet.stats?.energy) < 35 || Boolean(pet.survival?.illness);
  let pose = narrativePose || (activeCare ? basePose : activeActivity ? life.activity.pose : tired ? "sleep" : routine.pose) || basePose;
  if (life.sleep && pose === "sleep") pose = "sit"; // Dozing is not server-confirmed sleep.
  const roaming = !reducedMotion && !activeCare && !activeActivity && !narrativePose && !tired && pose !== "sleep";
  const scheduledZone = routine.zone || "bed";
  const roamZone = [scheduledZone, "window", "toy"][Math.floor(now / 24_000) % 3];
  const zone = pose === "eat" ? "bowl" : pose === "sleep" ? "bed" : activeActivity ? life.activity.zone : roaming ? roamZone : pose === "play" ? "toy" : scheduledZone;
  const event = snapshot.daily_event?.id;
  const kind = inspecting?.kind || (event === "window-butterfly" ? "butterfly" : event === "visitor-cat" ? "visitor" : event?.includes("box") ? "box" : event === "lost-yarn" ? "ball" : null) || life.scene_marks?.find((mark) => ["box", "ball", "visitor", "curtain"].includes(mark.kind))?.kind;
  const interested = inspecting || Math.floor(now / 1000) % 40 >= 28;
  if (kind && interested && !tired && !activeCare && !activeActivity && !narrativePose && !reducedMotion) {
    const reactions = {
      butterfly: { target: { x: 68, y: 76 }, aim: 3, reaction: "right" },
      visitor: { target: { x: 66, y: 75 }, aim: 3, reaction: "purr" },
      box: { target: { x: 33, y: 85 }, aim: -3, reaction: "sniff" },
      ball: { target: { x: 66, y: 86 }, aim: 3, reaction: "pounce" },
      curtain: { target: { x: 63, y: 77 }, aim: 3, reaction: "purr" },
      key: { target: { x: 34, y: 76 }, aim: -3, reaction: "left" },
    };
    if (reactions[kind]) return { pose: "sit", zone: null, roaming: true, ...reactions[kind], night: hour < 7 || hour >= 22 };
  }
  return { pose, zone, roaming, night: hour < 7 || hour >= 22 };
}

export function livingCatOffset(snapshot, config, zone, pose) {
  if (!zone || !config) return { x: 0, y: 0 };
  const layers = getRoomLayers(snapshot);
  const item = layers.find((row) => (row.room.slot || row.slot) === zone);
  const target = zone === "bowl" ? { x: (item?.room.x ?? 15) + 19, y: item?.room.y ?? 79 }
    : zone === "toy" ? { x: (item?.room.x ?? 85) - 17, y: (item?.room.y ?? 73) + 1 }
    : zone === "shelf" ? { x: (item?.room.x ?? 18) + 15, y: 72 }
    : zone === "window" ? { x: 70, y: 73 }
    : { x: item?.room.x ?? 50, y: (item?.room.y ?? 77) + (pose === "sleep" ? -3 : 4) };
  const halfWidth = Number(config.width || 40) / 2;
  const x = Math.max(halfWidth + 2, Math.min(98 - halfWidth, target.x));
  const y = Math.max(58, Math.min(90, target.y));
  return { x: x - Number(config.x || 50), y: y - Number(config.y || 74) };
}
