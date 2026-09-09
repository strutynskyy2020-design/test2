import { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { isUsablePetImage } from "./petRoom";

export default function PetRoomImage({ src, name }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setFailed(false); setAttempt(0); }, [src]);
  useEffect(() => {
    const recover = () => { setFailed(false); setAttempt(0); };
    window.addEventListener("online", recover);
    return () => window.removeEventListener("online", recover);
  }, []);
  useEffect(() => {
    if (!failed || attempt >= 2) return undefined;
    const timer = window.setTimeout(() => { setAttempt((n) => n + 1); setFailed(false); }, (attempt + 1) * 1200);
    return () => window.clearTimeout(timer);
  }, [failed, attempt]);
  return failed ? <span className="play-object-placeholder" title={name}><Package size={23} /><small>{name}</small></span> : <img key={`${src}-${attempt}`} src={src} alt="" draggable={false} onError={() => setFailed(true)} onLoad={(event) => { if (!isUsablePetImage(event.currentTarget)) setFailed(true); }} />;
}
