// Development-only visual regression bench. Never calls the game API.
import { useState } from "react";
import PetCatSprite from "./PetCatSprite";
import "@/styles/petPlayroom.css";
import "@/styles/petPolish.css";
const snapshot = { pet: { name: "Піксель", trust: 10, stats: { energy: 80, mood: 80 }, inventory: { equipped: {}, items: [] } }, catalog: { items: [] } };
export default function PetRigPreview() {
  const [state, setState] = useState("idle"), [target, setTarget] = useState({ x: 50, y: 84 }), [look, setLook] = useState(null), [still, setStill] = useState(false), [paused, setPaused] = useState(false);
  const [replay, setReplay] = useState(0), [step, setStep] = useState(0);
  const [slow, setSlow] = useState(false), [contacts, setContacts] = useState(false);
  const select = state => { setState(state); setReplay(value => value + 1); };
  return <main style={{ minHeight: "100dvh", background: "#211a2d", color: "#ffe9c8", padding: 12, fontFamily: "sans-serif" }}>
    <h1 style={{ fontSize: 18 }}>Піксель · нові 2D-анімації</h1><p>Локальний стенд — не змінює стан гри.</p>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBlock: 12 }}>
      {["idle", "eat", "clean", "purr", "refuse", "sniff", "sleep", "pounce", "tired", "yawn"].map(s => <button key={s} onClick={() => select(s)} aria-pressed={s === state} style={{ padding: 10, border: "1px solid #cda46e", borderRadius: 8 }}>{s}</button>)}
      <button onClick={() => { setState("idle"); setTarget({ x: 26, y: 84 }); }}>Ліворуч</button>
      <button onClick={() => { setState("idle"); setTarget({ x: 74, y: 84 }); }}>Праворуч</button>
      <button onClick={() => { setState("idle"); setTarget({ x: 50, y: 65 }); }}>Углиб</button>
      <button onClick={() => setStill(v => !v)} aria-pressed={still}>Мінімум рухів</button>
      <button onClick={() => setPaused(v => !v)} aria-pressed={paused}>Пауза</button>
      <button onClick={() => setStep(value => value + 1)} disabled={!paused || still}>Крок 0,025 с</button>
      <button onClick={() => setReplay(value => value + 1)}>Повторити реакцію</button>
      <button onClick={() => setSlow(value => !value)} aria-pressed={slow}>Швидкість ×0,25</button>
      <button onClick={() => setContacts(value => !value)} aria-pressed={contacts}>Контакт лап</button>
    </div>
    <div style={{ position: "relative", width: "min(100%, 550px)", height: "min(70vh, 620px)", margin: "auto", background: "radial-gradient(at 50% 80%,#5d455d,#292234)", borderRadius: 20 }} onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); setLook({ x: (e.clientX - r.left) / r.width * 100, y: (e.clientY - r.top) / r.height * 100 }); }}>
      <div style={{ position: "absolute", left: "8%", right: "8%", bottom: "16%", height: 1, background: "#ad927150" }} />
      <PetCatSprite pose={state === "sleep" ? "sleep" : "sit"} reaction={state} actionKey={replay} debugStep={step} debugSpeed={slow ? .25 : 1} debugContacts={contacts} snapshot={snapshot} chaseTarget={target} lookTarget={look} quiet={still} paused={paused} onClick={() => select("purr")} />
    </div>
  </main>;
}
