import { BookOpen, Gift, Mail, Sparkles } from "lucide-react";
import { petItemAsset } from "./petPlayroomState";
import { getRoomLayers } from "./petRoom";

export function eventObject(id) {
  if (id === "window-butterfly") return "butterfly";
  if (id === "visitor-cat") return "visitor";
  if (id === "hidden-key") return "key";
  if (id === "plant-crash" || id === "moon-plant") return "plant";
  if (id?.includes("box")) return "box";
  if (["lost-yarn", "under-shelf-noise", "night-zoomies"].includes(id)) return "ball";
  return "spark";
}
function ObjectArt({ kind }) {
  if (kind === "visitor") return <img src="/pet/room/v3/cat/look-left.webp" alt="" draggable={false} />;
  if (kind === "plant") return <img src="/pet/room/v2/items/plant-moon.webp" alt="" draggable={false} />;
  if (kind === "curtain") return <span className="play-curtain-art" />;
  if (kind === "scraps") return <img className="play-cardboard-scraps" src={petItemAsset("box")} alt="" draggable={false} />;
  if (kind === "spark") return <Sparkles size={28} />;
  return <img src={petItemAsset(kind)} alt="" draggable={false} />;
}
export default function PetWorldEvents({ snapshot, disabled, setSheet, claimGift, navigate, onInspect }) {
  const event = snapshot.daily_event, activeKind = eventObject(event?.id);
  const usePlacedPlant = activeKind === "plant" && getRoomLayers(snapshot).some((item) => item.id === "plant-moon");
  const marks = (snapshot.life?.scene_marks || []).filter((mark) => mark.kind !== "mess" && mark.source !== event?.id);
  return <div className="play-world-events">
    {marks.map((mark) => <button key={mark.id} className={`play-scene-prop prop-${mark.kind} remembered`} aria-label={`Спогад: ${mark.label}`} disabled={disabled} onClick={() => onInspect ? onInspect(mark.kind) : navigate("/pet/journal")}><ObjectArt kind={mark.kind} /></button>)}
    {snapshot.story?.current_scene && <button className="play-letter" aria-label="Лист: сюжетна пригода" disabled={disabled} onClick={() => setSheet("story")}><Mail size={30} /><i /></button>}
    {event && !usePlacedPlant && <button className={`play-scene-prop prop-${activeKind} current`} aria-label={event.title} disabled={disabled} onClick={() => setSheet("event")}><ObjectArt kind={activeKind} /><i /></button>}
    {snapshot.gift?.available && <button className="play-gift" aria-label="Забрати подарунок котика" disabled={disabled} onClick={claimGift}><Gift size={31} /><i /></button>}
    <button className="play-album" aria-label="Щоденник пригод" disabled={disabled} onClick={() => navigate("/pet/journal")}><BookOpen size={25} /></button>
  </div>;
}
