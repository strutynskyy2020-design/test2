import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Armchair, BookOpen, Check, ChevronRight, Feather, Gamepad2, Heart, Home, KeyRound, LampDesk, LoaderCircle, LockKeyhole, MessageCircle, Search, Sparkles, X } from "lucide-react";
import api, { extractError } from "@/lib/api";
import { PixelMiniGames, PixelEnding } from "@/components/PixelCampaignViews";
import PetCatSprite from "./PetCatSprite";
import "@/styles/pixel-campaign.css";

const LegacyPet = lazy(() => import("./Pet"));
const ART = "/pet/story/v1/";
const POSTER = "/pet/room/v6/rig/sit-poster.webp";
const LOCATIONS = { room: "Кімната", workshop: "Майстерня", roof: "Сад на даху" };
// The rig receives a presentation-only model. Story relationships never invoke
// the legacy care API or its offline survival/decay rules.
const RIG_MODEL = { pet: { name: "Піксель", trust: 0, stats: { mood: 75, energy: 85 }, equipped: {}, inventory: [] }, catalog: [], room: { layers: [] } };

export default function PixelRoomRoute() {
  const location = useLocation();
  return new URLSearchParams(location.search).get("view") === "classic"
    ? <Suspense fallback={<div className="pixel-loading">Відкриваємо попередню кімнату…</div>}><LegacyPet /></Suspense>
    : <PixelCampaign />;
}

export function PixelDialogue({ campaign, busy, onAction, onClose }) {
  const { step, line, outcome, relationship } = campaign;
  const text = outcome || step.lines[line];
  const hasChoice = !outcome && line === step.lines.length - 1 && step.choices?.length > 0;
  const textRef = useRef(null);
  useEffect(() => { textRef.current?.focus({ preventScroll: true }); }, [step.id, line, outcome]);
  const speaker = step.speaker || "Піксель";
  const hurt = ["guarded", "hurt"].includes(relationship.key);
  return <section className={`pixel-dialogue ${hurt ? "is-distant" : ""}`} aria-label={`Розмова: ${speaker}`}>
    {speaker === "Піксель" && <div className="pixel-dialogue-portrait" aria-hidden="true"><img src={hurt ? ART + "portrait-guarded.webp" : POSTER} alt="" /></div>}
    <div className="pixel-dialogue-heading"><span><MessageCircle size={14} /> {speaker.toUpperCase()}</span><button type="button" onClick={onClose} aria-label="Згорнути розмову"><X size={19} /></button></div>
    <p ref={textRef} tabIndex={-1} className="pixel-dialogue-text">{text}</p>
    {hasChoice ? <div className="pixel-choices" aria-label="Твоє рішення">{step.choices.map(choice => <button key={choice.id} type="button" disabled={busy} onClick={() => onAction("choose", { choice_id: choice.id })}>{choice.label}<ChevronRight size={17} /></button>)}<small>Піксель запам’ятає твій вчинок.</small></div>
      : <div className="pixel-dialogue-actions">{!outcome && line < step.lines.length - 1 ? <button type="button" className="pixel-text-button" disabled={busy} onClick={() => onAction("skip")}>До кінця реплік</button> : <span className="pixel-scene-counter">{outcome ? "Рішення збережено" : `${line + 1} / ${step.lines.length}`}</span>}<button type="button" className="pixel-primary" disabled={busy} onClick={() => onAction("advance")}>{busy ? <LoaderCircle size={17} className="pixel-spin" /> : <>{outcome ? "Продовжити" : line === step.lines.length - 1 ? "До справи" : "Далі"}<ArrowRight size={16} /></>}</button></div>}
  </section>;
}

function FeatherBalance({ wallet }) {
  return <div className="pixel-wallet" aria-label={`Пір’їнки: ${wallet.feathers}. Золоті: ${wallet.gold}`}>
    <span title="Пір’їнки за рівні"><Feather size={19} />{wallet.feathers}</span><span className="is-gold" title="Золоті пір’їнки за розділи"><Feather size={19} />{wallet.gold}</span>
  </div>;
}

function CampaignJournal({ campaign }) {
  return <>
    <div className="pixel-section-intro"><span className="pixel-eyebrow">ВАША ІСТОРІЯ</span><h2>Те, що залишається</h2><p>Рішення, знахідки й розмови. Ці сторінки зберігають пройдений шлях.</p></div>
    <section className={`pixel-bond-card is-${campaign.relationship.key}`}><Heart size={21} /><div><strong>{campaign.relationship.label}</strong><p>{campaign.relationship.description}</p><small>{campaign.relationship.reason}</small></div></section>
    <div className="pixel-chapters">{campaign.chapters.map(chapter => <div key={chapter.id} className={campaign.completed.includes(chapter.id) ? "is-complete" : chapter.id === campaign.step.chapter ? "is-current" : ""}><span>{campaign.completed.includes(chapter.id) ? <Check size={17} /> : String(chapter.id).padStart(2, "0")}</span><div><strong>{chapter.title}</strong><small>{chapter.summary}</small></div>{chapter.id > campaign.step.chapter && <LockKeyhole size={15} />}</div>)}</div>
    {campaign.discoveries.length > 0 && <section className="pixel-discoveries"><h3>Знахідки</h3>{campaign.discoveries.map(item => <article key={item.id}><KeyRound size={21} /><div><strong>{item.title}</strong><p>{item.text}</p></div></article>)}</section>}
    <section className="pixel-journal-entries"><h3>Сторінки щоденника</h3>{campaign.journal.length === 0 ? <p>Перша сторінка ще попереду. Познайомся з Пікселем у кімнаті.</p> : [...campaign.journal].reverse().map((entry, i) => <details key={campaign.journal.length - i}><summary><span>{entry.kind === "choice" ? "РІШЕННЯ" : entry.kind === "chapter" ? "РОЗДІЛ" : "СПОГАД"}</span>{entry.title}</summary><p>{entry.text}</p>{entry.choice && <><blockquote>Ти: «{entry.choice}»</blockquote><p>{entry.speaker || "Піксель"}: «{entry.response}»</p></>}</details>)}</section>
  </>;
}

export function PixelCampaign() {
  const nav = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const location = useLocation();
  const [panel, setPanel] = useState(() => {
    const requested = new URLSearchParams(location.search).get("panel");
    return ["room", "decorate", "journal", "games", "ending"].includes(requested) ? requested : "room";
  });
  const [roomLocation, setRoomLocation] = useState("room");
  const [talking, setTalking] = useState(true);
  const [reaction, setReaction] = useState("idle");
  const [catMessage, setCatMessage] = useState("");
  const [assetError, setAssetError] = useState(false);
  const [retry, setRetry] = useState(0);
  const pending = useRef(false);
  const catTimer = useRef(null);
  const pageRef = useRef(null);
  const sheetRef = useRef(null);

  const accept = useCallback(data => {
    setCampaign(current => !current || data.revision >= current.revision ? data : current);
  }, []);
  const refresh = useCallback(async () => {
    const { data } = await api.get("/pet/campaign");
    accept(data);
    return data;
  }, [accept]);
  useEffect(() => {
    let active = true;
    api.get("/pet/campaign").then(({ data }) => { if (active) { accept(data); setError(""); } })
      .catch(e => { if (active) setError(extractError(e, "Не вдалося відкрити кімнату.")); });
    const focus = () => { if (!document.hidden && !pending.current) refresh().catch(() => {}); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => { active = false; window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); clearTimeout(catTimer.current); };
  }, [accept, refresh, retry]);

  const act = useCallback(async (kind, extra = {}) => {
    if (pending.current || !campaign) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const { data } = await api.post("/pet/campaign/action", { kind, step_id: campaign.step.id, revision: campaign.revision, ...extra });
      accept(data);
      if (kind === "buy" && ["workbench", "roof_garden"].includes(extra.item_id)) setRoomLocation(extra.item_id === "workbench" ? "workshop" : "roof");
      if (data.step.id !== campaign.step.id) { setTalking(true); setPanel(data.step.kind === "end" ? "ending" : "room"); }
    } catch (e) {
      setError(extractError(e, "Не вдалося зберегти дію. Спробуй ще раз."));
      if (e.response?.status === 409) await refresh().catch(() => {});
    } finally { pending.current = false; setBusy(false); }
  }, [campaign, accept, refresh]);

  useEffect(() => {
    if (panel !== "room") { sheetRef.current?.focus({ preventScroll: true }); }
  }, [panel]);
  const isDistant = campaign && ["guarded", "hurt"].includes(campaign.relationship.key);
  const catTarget = useMemo(() => ({ x: isDistant ? 65 : campaign?.relationship.key === "close" ? 44 : 50, y: isDistant ? 72 : 81 }), [isDistant, campaign?.relationship.key]);
  const touchCat = () => {
    if (!campaign) return;
    clearTimeout(catTimer.current);
    setReaction(isDistant ? "look" : "purr");
    setCatMessage(isDistant ? "Зараз я хочу трохи побути сам." : campaign.relationship.key === "close" ? "Залишайся. Тут вистачить місця для нас обох." : "Я тут. То що робитимемо далі?");
    catTimer.current = setTimeout(() => { setReaction("idle"); setCatMessage(""); }, 3500);
  };

  if (!campaign) return <div className="pixel-loading" role="status">{error ? <><p>{error}</p><button type="button" className="pixel-primary" onClick={() => { setError(""); setRetry(r => r + 1); }}>Спробувати знову</button></> : <><LoaderCircle className="pixel-spin" /><p>Піксель чекає біля вікна…</p></>}<button type="button" className="pixel-text-button" onClick={() => nav("/")}>На головну</button></div>;
  const { step, wallet } = campaign;
  const dialogue = panel === "room" && talking && step.kind === "dialogue";
  const openGoal = () => {
    if (step.kind === "dialogue") setTalking(true);
    else if (step.kind === "game") setPanel("games");
    else if (step.kind === "decorate") setPanel("decorate");
    else setPanel("ending");
  };
  const scene = (campaign.locations || ["room"]).includes(roomLocation) ? roomLocation : "room";
  const inRoom = scene === "room";
  const background = inRoom ? (campaign.equipped.renovation ? "/pet/story/v2/room-restored.webp" : ART + "room.webp") : `/pet/story/v2/${scene === "workshop" && campaign.equipped.workshop ? "workshop-restored" : scene}.webp`;
  const goalItem = campaign.catalog.find(item => item.id === step.item);
  const shopItems = [...campaign.catalog].sort((a, b) => (a.id === step.item ? -10 : a.unlocked && !a.owned ? -1 : a.owned ? 1 : 2) - (b.id === step.item ? -10 : b.unlocked && !b.owned ? -1 : b.owned ? 1 : 2));
  return <div ref={pageRef} className={`pixel-campaign bond-${campaign.relationship.key} ${dialogue ? "is-dialogue-open" : ""}`} data-testid="pixel-campaign" onKeyDown={e => {
    if (e.key === "Escape") { setPanel("room"); setTalking(false); pageRef.current?.querySelector(".pixel-goal")?.focus(); }
  }}>
    <div className="pixel-scene" aria-hidden="true">
      <img className="pixel-room-background" src={background} alt="" onError={() => setAssetError(true)} />
      {inRoom && campaign.equipped.lamp && <><span className="pixel-lamp-light" /><img className="pixel-room-lamp" src={ART + "lamp.webp"} alt="" /></>}
      {inRoom && campaign.flags?.access !== "forced" && campaign.equipped.cushion && <img className={`pixel-room-cushion at-${campaign.placement}`} src={ART + "cushion.webp"} alt="" />}
      {inRoom && campaign.discoveries.some(d => d.id === "letter") && <span className="pixel-room-letter"><KeyRound size={12} /></span>}
      {inRoom && campaign.equipped.album && <img className="pixel-room-album" src={ART + "album.webp"} alt="" />}
      {inRoom && campaign.equipped.plant && <img className="pixel-room-fern" src="/pet/story/v2/fern.webp" alt="" />}
      {inRoom && campaign.equipped.clock && <img className="pixel-room-clock" src="/pet/story/v2/clock.webp" alt="" />}
    </div>
    {campaign.cat_present !== false && <div className={`pixel-room-actors ${dialogue ? "is-speaking" : ""}`}><div className="pixel-room-cat"><PetCatSprite pose="sit" snapshot={RIG_MODEL} reaction={reaction} actionKey={catMessage} chaseTarget={catTarget} paused={panel !== "room" || dialogue} onClick={touchCat} disabled={dialogue || panel !== "room"} /></div></div>}
    <div className="pixel-room-vignette" />
    <header className="pixel-topbar"><button type="button" className="pixel-icon-button" onClick={() => nav("/")} aria-label="На головну VPDK"><ArrowLeft size={20} /></button><div><h1>Піксель</h1><span>Кімната з історією</span></div><FeatherBalance wallet={wallet} /></header>
    <div className="pixel-top-content">
      <button type="button" className="pixel-chapter-label" onClick={() => setPanel("journal")}>АКТ {["I", "II", "III", "IV"][Math.min(3, Math.floor((step.chapter - 1) / 6))]} <span /> {step.kind === "end" ? "ІСТОРІЮ ЗАВЕРШЕНО" : `РОЗДІЛ ${String(step.chapter).padStart(2, "0")}`}<BookOpen size={13} /></button>
      {panel === "room" && <button type="button" className="pixel-goal" onClick={openGoal}><span className="pixel-goal-icon">{step.kind === "decorate" ? <LampDesk size={25} /> : step.kind === "game" ? step.game === "bonus_match" ? <Sparkles size={25} /> : <Search size={25} /> : <MessageCircle size={25} />}</span><span className="pixel-goal-copy"><small>{step.kind === "dialogue" ? "ПІКСЕЛЬ ХОЧЕ ПОГОВОРИТИ" : step.kind === "end" ? "ВАШ ФІНАЛ" : "ЗАРАЗ У ВАШІЙ ІСТОРІЇ"}</small><strong>{step.title}</strong><span>{step.kind === "game" ? `${campaign.progress} / ${step.count} · ${step.cta}` : step.kind === "decorate" ? `${wallet.feathers} / ${goalItem?.price || 20} пір’їнок · Облаштувати` : step.kind === "end" ? "Переглянути завершення" : "Продовжити розмову"}</span></span><ChevronRight size={21} /></button>}
      {panel === "room" && (campaign.locations?.length > 1) && <nav className="pixel-location-tabs" aria-label="Локації Світлиці">{campaign.locations.map(id => <button type="button" key={id} aria-pressed={scene === id} onClick={() => setRoomLocation(id)}>{LOCATIONS[id]}</button>)}</nav>}
    </div>
    {error && <div role="alert" className="pixel-error">{error}<button type="button" onClick={() => setError("")} aria-label="Приховати повідомлення"><X size={16} /></button></div>}
    {assetError && <p className="pixel-asset-error">Не вдалося завантажити фон. Онови сторінку, щоб повернути кімнату.</p>}
    {catMessage && panel === "room" && !dialogue && <p className="pixel-cat-bubble" role="status">{catMessage}</p>}
    {panel !== "room" && <section ref={sheetRef} tabIndex={-1} className="pixel-sheet" aria-label={{decorate: "Облаштування кімнати", journal: "Щоденник", games: "Мініігри", ending: "Завершення історії"}[panel]}>
      <button type="button" className="pixel-sheet-close pixel-icon-button" onClick={() => setPanel("room")} aria-label="Повернутися в кімнату"><X size={21} /></button>
      {(panel === "journal" || (panel === "ending" && !campaign.ending)) ? <CampaignJournal campaign={campaign} /> : panel === "games" ? <PixelMiniGames campaign={campaign} onPlay={nav} /> : panel === "ending" && campaign.ending ? <PixelEnding campaign={campaign} busy={busy} onContact={() => act("contact")} onJournal={() => setPanel("journal")} /> : <>
        <div className="pixel-section-intro"><span className="pixel-eyebrow">МАЛЕНЬКІ ЗМІНИ, ВЛАСНА ІСТОРІЯ</span><h2>Кімната стає вашою</h2><p>Перемагай у мінііграх і повертай сюди тепло.</p></div>
        <div className="pixel-shop">{shopItems.map(item => <article key={item.id} className={`pixel-shop-item ${!item.unlocked ? "is-locked" : ""} ${step.item === item.id ? "is-current-project" : ""}`}><div className="pixel-item-art"><img loading="lazy" decoding="async" src={["workshop", "renovation", "roof"].includes(item.slot) ? item.image.replace(".webp", ".thumb.webp") : item.image.startsWith("/") ? item.image : ART + item.image} alt={item.title} /></div><div className="pixel-item-copy"><h3>{item.title}</h3><p>{item.description}</p><button type="button" className={item.owned ? "pixel-owned" : "pixel-primary"} disabled={busy || !item.unlocked || item.owned || wallet[item.currency] < item.price} onClick={() => act("buy", { item_id: item.id })}>{item.owned ? <><Check size={15} />У кімнаті</> : !item.unlocked ? <><LockKeyhole size={14} />Пізніше за сюжетом</> : <><Feather size={15} />{item.price}{item.currency === "gold" ? " золоті" : ""} · Встановити</>}</button>{item.unlocked && !item.owned && wallet[item.currency] < item.price && <small>Потрібно ще {item.price - wallet[item.currency]} {item.currency === "gold" ? "золотих пір’їнок за розділи" : "пір’їнок за мініігри"}</small>}</div></article>)}</div>
        <div className="pixel-economy"><Feather size={18} /><p>10 пір’їнок за перше проходження кожного рівня. Повтори не дають пір’їнок і не просувають сюжет. Нові рівні, пройдені наперед, зарахуються в майбутніх завданнях своєї гри. За завершений розділ — 1 золота; розмова в розділі 16 проходить без нагороди.</p></div>
        <button type="button" className="pixel-legacy-link" onClick={() => nav("/pet/collection")}>Попередня колекція та догляд<ArrowRight size={15} /></button>
      </>}
    </section>}
    <div className="pixel-bottom-content">
      {dialogue ? <PixelDialogue campaign={campaign} busy={busy} onAction={act} onClose={() => setTalking(false)} /> : panel === "room" && <>
        <button type="button" className={`pixel-relationship is-${campaign.relationship.key}`} onClick={() => setPanel("journal")}><Heart size={14} /><span>{campaign.relationship.label}</span><ChevronRight size={13} /></button>
        {["game", "end"].includes(step.kind) && <p className="pixel-mission-context">{step.description}</p>}
        <PixelMiniGames compact campaign={campaign} onPlay={nav} />
      </>}
      <nav className="pixel-nav" aria-label="Кімната Пікселя">{[{ id: "room", label: "Кімната", Icon: Home }, { id: "games", label: "Мініігри", Icon: Gamepad2 }, { id: "decorate", label: "Облаштувати", Icon: Armchair }, { id: "journal", label: "Щоденник", Icon: BookOpen }].map(({ id, label, Icon }) => <button type="button" key={id} aria-current={panel === id ? "page" : undefined} onClick={() => setPanel(id)}><Icon size={22} /><span>{label}</span>{id === "journal" && campaign.completed.length > 0 && <i>{campaign.completed.length}</i>}</button>)}</nav>
    </div>
  </div>;
}

