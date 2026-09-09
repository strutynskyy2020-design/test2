import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ArrowLeft, ArrowRight, Feather } from "lucide-react";
import api from "@/lib/api";
import "@/styles/pixel-campaign.css";

export const usePixelOrigin = () => new URLSearchParams(useLocation().search).get("from") === "pixel";

export function PixelGameLink({ enabled, onReturn, disabled = false }) {
  const [goal, setGoal] = useState(null);
  useEffect(() => {
    let active = true;
    if (enabled) api.get("/pet/campaign").then(({ data }) => {
      if (active) setGoal(data.step);
    }).catch(() => {});
    return () => { active = false; };
  }, [enabled]);
  if (!enabled) return null;
  return <button type="button" className="pixel-game-link" onClick={onReturn} disabled={disabled}><ArrowLeft size={17} /><span>До кімнати Пікселя<small>{goal?.title || "Перемагай, збирай пір’їнки й продовжуй історію"}</small></span><Feather size={18} /></button>;
}

export function PixelGameReward({ enabled, game, sessionId, onReturn }) {
  const [receipt, setReceipt] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setReceipt(null); setFailed(false);
    if (enabled && sessionId) api.post("/pet/campaign/claim", { game, session_id: sessionId })
      .then(({ data }) => { if (active) setReceipt(data.reward); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [enabled, game, sessionId, attempt]);
  if (!enabled) return null;
  return <div className="pixel-game-reward" role="status">
    <p>{receipt ? receipt.feathers > 0 ? receipt.duplicate ? `${receipt.feathers} пір’їнок уже зараховано` : `+${receipt.feathers} пір’їнок для кімнати` : "Цей рівень уже враховано. Повтор не додає пір’їнок або сюжетного прогресу" : failed ? "Перемога збережена. Пір’їнки перевіримо при поверненні в кімнату." : "Зберігаємо пір’їнки для Пікселя…"}</p>
    {receipt?.quest && <p>Сюжетне проходження зараховано.</p>}
    {receipt?.banked && <p>Нове проходження збережено для майбутнього завдання цієї гри.</p>}
    {failed && <button type="button" onClick={() => setAttempt(n => n + 1)}>Повторити перевірку</button>}{" "}
    <button type="button" onClick={onReturn}>До Пікселя <ArrowRight size={14} style={{ display: "inline" }} /></button>
  </div>;
}

