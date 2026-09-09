import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Cat, Feather, Gamepad2, Gift, Hand, Heart, Lamp, Menu, Moon, Package, Settings2, ShieldAlert, ShoppingBag, Utensils, Waves, X } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { derivePetLifeView, getKyivLight, getRoomLayers, roomLayerStyle, groundLayerIndex } from "./petRoom";
import { livingSceneState } from "./petLivingState";
import { usePetAmbience } from "./PetLiving";
import { PLAY_FOOD, PLAY_TOYS, gestureCompleted, insideRect, interactionFeedback, interactionRequest, petThought, playContext, petItemAsset, makePlayRequestId } from "./petPlayroomState";
import { dirtSpots, dirtIsClean, scrubDirt, pointInScene, wandReady } from "./petGestures";
import PetCatSprite from "./PetCatSprite";
import PetBall from "./PetBall";
import PetWorldEvents from "./PetWorldEvents";
import { usePetSounds } from "./usePetSounds";
import { careHint, sleepHint } from "./petCareView";
import PetRoomImage from "./PetRoomImage";
import "@/styles/petPlayroom.css";

const NEEDS = [{ id: "feed", stat: "satiety", label: "Їжа", Icon: Utensils, color: "#ffc45f" },
  { id: "play", stat: "mood", label: "Гра", Icon: Gamepad2, color: "#b9a0ff" },
  { id: "clean", stat: "cleanliness", label: "Чистота", Icon: Waves, color: "#68e3eb" },
  { id: "rest", stat: "energy", label: "Сон", Icon: Moon, color: "#91aaff" }];
const TITLES = { menu: "Наш маленький світ", health: "Як почувається котик", adventures: "Пригоди та заняття", editor: "Облаштувати кімнату", settings: "Затишок і налаштування", friends: "Котики друзів", ritual: "Подарунок від котика" };


export default function PetPlayRoom({ snapshot, perform, busy, online, reducedMotion, navigate, setSheet, claimGift, renderPanel, narrativeReplay, modalOpen, syncError, retrySync }) {
  const { pet, catalog = {}, life: living = {} } = snapshot;
  const [mode, setMode] = useState(null);
  const [food, setFood] = useState("fish");
  const [toy, setToy] = useState("wand");
  const [panel, setPanel] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [washed, setWashed] = useState(null);
  const dirtRef = useRef(null);
  const [toss, setToss] = useState(null);
  const [chase, setChase] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [visible, setVisible] = useState(() => !document.hidden);
  const [aim, setAim] = useState(0);
  const lookTarget = useRef(null);
  const [touching, setTouching] = useState(false);
  const [inspecting, setInspecting] = useState(null);
  const mess = living.scene_marks?.some((mark) => mark.kind === "mess");
  const canvas = useRef(null), cat = useRef(null), gesture = useRef(null), pending = useRef(false), suppressClick = useRef(0);
  const serverOffset = useRef(0);
  useEffect(() => { serverOffset.current = (Date.parse(snapshot.server_time) || Date.now()) - Date.now(); }, [snapshot.server_time]);
  usePetAmbience(living.sound === "ambient");
  const sound = usePetSounds(living.sound === "ambient");
  useEffect(() => { if (feedback) sound(feedback.reaction); }, [feedback, sound]);
  const clock = now + serverOffset.current;
  const life = derivePetLifeView(pet, clock);
  const away = !life.alive || pet.expedition?.status === "active";
  const cancelGesture = () => { gesture.current = null; setTouching(false); setCursor(null); setWashed(null); dirtRef.current = null; setAim(0); setToss(null); setChase(null); };
  useEffect(() => {
    const sync = () => { setVisible(!document.hidden); if (document.hidden) cancelGesture(); else setNow(Date.now()); };
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [visible]);
  useEffect(() => { cancelGesture(); setFeedback(null); setMode(null); }, [pet.survival?.generation, snapshot.date_key, away, online]);
  useEffect(() => { setWashed(null); dirtRef.current = null; }, [pet.stats?.cleanliness, mess]);
  useEffect(() => { if (living.sleep?.active) { cancelGesture(); setMode(null); } }, [living.sleep?.active]);
  useEffect(() => { if (panel || modalOpen) cancelGesture(); }, [panel, modalOpen]);
  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 6500);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  useEffect(() => { if (!inspecting) return undefined; const timer = window.setTimeout(() => setInspecting(null), 6500); return () => window.clearTimeout(timer); }, [inspecting]);
  const activeNarrative = narrativeReplay && now - narrativeReplay.replay_started_at < 12000 ? narrativeReplay : null;
  const scene = livingSceneState(snapshot, clock, { reducedMotion, narrativePose: activeNarrative?.pose, inspecting });
  const reaction = feedback?.reaction || "idle";
  const sleeping = living.sleep ? living.sleep.active : !mode && scene.pose === "sleep";
  const pose = away ? "away" : sleeping ? "sleep" : reaction === "eat" ? "eat" : reaction === "pounce" ? "play" : activeNarrative?.pose || (mode || feedback ? "sit" : scene.pose);
  const zone = mode || feedback ? pose === "eat" ? "bowl" : pose === "sleep" ? "bed" : null : scene.zone;
  const thought = petThought(snapshot, sleeping);
  const urgent = life.alive && ["critical", "sick", "neglected"].includes(life.condition);
  const locked = busy || !online || syncError || away || !visible || Boolean(panel || modalOpen);
  const openPanel = (id) => { cancelGesture(); setPanel(id); };
  const action = async (kind, option = "default", context = playContext(snapshot), touchZone = "head") => {
    if (locked || pending.current) return;
    const hint = careHint(snapshot, kind, clock, option, touchZone);
    if (hint.blocked) { setFeedback({ reaction: "idle", message: hint.text }); return; }
    // Stale gestures never apply to a new day or newly adopted pet.
    if (context.date_key !== snapshot.date_key || context.generation !== (pet.survival?.generation || 1)) return;
    pending.current = true;
    try {
      const result = await perform(interactionRequest(snapshot, kind, option, context, touchZone));
      if (result) {
        const next = interactionFeedback(result, kind);
        setFeedback(next);
      } else setFeedback({ reaction: kind === "feed" ? "sniff" : "idle", message: "Дію не зараховано. Перевір стан або спробуй ще раз." });
    } finally { pending.current = false; setWashed(null); dirtRef.current = null; }
  };
  const toggleSleep = async () => {
    if (locked || pending.current) return;
    if (!sleeping) { setMode(null); void action("rest"); return; }
    pending.current = true;
    try {
      const result = await perform({ url: "/pet/sleep", body: { action: "wake", ...playContext(snapshot), request_id: makePlayRequestId() } });
      if (result) setFeedback(result.interaction);
    } finally { pending.current = false; }
  };
  const selectMode = (id) => {
    cancelGesture();
    if (id === "rest") { void toggleSleep(); return; }
    if (sleeping && !(id === "feed" && pet.stats?.satiety < 20)) { setFeedback({ reaction: "sleep", message: "Спершу розбуди мене лампою." }); return; }
    setMode(mode === id ? null : id);
  };
  const begin = (event, kind, option, touchZone = "head") => {
    if (locked || pending.current || event.button > 0 || gesture.current) return;
    const hint = careHint(snapshot, kind, clock, option, touchZone);
    if (hint.blocked) { suppressClick.current = Date.now() + 500; setFeedback({ reaction: "idle", message: hint.text }); return; }
    setToss(null);
    setTouching(kind === "pet");
    gesture.current = { action: kind, option, zone: touchZone, distance: 0, contactDistance: 0, directionChanges: 0, startedAt: Date.now(), lastAt: Date.now(), velocity: { x: 0, y: 0 }, pointerId: event.pointerId, point: { x: event.clientX, y: event.clientY }, context: playContext(snapshot) };
    gesture.current.target = event.currentTarget.closest?.(".play-cat-touch") || cat.current;
    if (kind === "clean" && !dirtRef.current) dirtRef.current = dirtSpots(pet.stats?.cleanliness, mess);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event) => {
    if (!locked && !sleeping && !reducedMotion) {
      const bounds = canvas.current?.getBoundingClientRect();
      if (bounds?.width && insideRect({ x: event.clientX, y: event.clientY }, bounds)) {
        lookTarget.current = pointInScene({ x: event.clientX, y: event.clientY }, bounds);
      }
    }
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = { x: event.clientX, y: event.clientY }, rect = canvas.current?.getBoundingClientRect();
    const distance = Math.hypot(point.x - active.point.x, point.y - active.point.y);
    active.distance += distance;
    if (insideRect(point, active.target?.getBoundingClientRect(), 8) || active.action === "clean" && insideRect(point, rect)) active.contactDistance += distance;
    const previousPoint = active.point;
    const dt = Math.max(10, Date.now() - active.lastAt) / 1000;
    const velocity = { x: (point.x - previousPoint.x) / dt, y: (point.y - previousPoint.y) / dt };
    if (velocity.x * active.velocity.x + velocity.y * active.velocity.y < -500) active.directionChanges++;
    active.velocity = velocity; active.lastAt = Date.now(); active.point = point;
    if (rect?.width) {
      setCursor({ x: Math.max(3, Math.min(97, (point.x - rect.left) / rect.width * 100)), y: Math.max(3, Math.min(97, (point.y - rect.top) / rect.height * 100)), action: active.action });
      setAim(Math.max(-5, Math.min(5, (point.x - rect.left - rect.width / 2) / 30)));
      if (active.action === "play" && active.option === "wand") setChase({ x: (point.x - rect.left) / rect.width * 100 });
      if (active.action === "clean") {
        dirtRef.current = scrubDirt(dirtRef.current || [], pointInScene(previousPoint, rect), pointInScene(point, rect));
        setWashed(dirtRef.current);
      }
    }
  };
  const end = (event) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = { x: event.clientX, y: event.clientY }, rect = canvas.current?.getBoundingClientRect();
    const done = active.action === "clean" ? dirtIsClean(dirtRef.current || []) : active.action === "play" ? active.option === "wand" && wandReady(active, Date.now()) && insideRect(point, rect) : gestureCompleted(active, point, cat.current?.getBoundingClientRect(), rect);
    if (active.distance > 12) suppressClick.current = Date.now() + 500;
    gesture.current = null; setTouching(false); setCursor(null); setAim(0); setChase(null);
    if (active.action === "play" && active.option === "ball" && active.distance > 12 && insideRect(point, rect)) {
      setToss({ id: makePlayRequestId(), point: pointInScene(point, rect), velocity: { x: active.velocity.x / rect.width * 100, y: active.velocity.y / rect.height * 100 }, context: active.context });
    } else if (done) void action(active.action, active.option, active.context, active.zone);
  };
  const clickCat = (touchZone = "head") => {
    if (Date.now() < suppressClick.current) return;
    if (sleeping && !(mode === "feed" && pet.stats?.satiety < 20)) { setFeedback({ reaction: "sleep", message: "Я сплю… Увімкни лампу, щоб розбудити мене." }); return; }
    void action(mode === "feed" ? "feed" : mode === "play" ? "play" : mode === "clean" ? "clean" : "pet", mode === "feed" ? food : mode === "play" ? toy : "default", playContext(snapshot), touchZone);
  };
  const modeAction = mode === "feed" ? "feed" : mode === "play" ? "play" : mode === "clean" ? "clean" : "pet";
  const modeOption = mode === "feed" ? food : mode === "play" ? toy : "default";
  const tapAlternative = () => {
    if (locked || pending.current) return;
    const hint = careHint(snapshot, modeAction, clock, modeOption);
    if (hint.blocked) { setFeedback({ reaction: "idle", message: hint.text }); return; }
    if (mode === "play" && toy === "ball") {
      setToss({ id: makePlayRequestId(), point: { x: 20, y: 76 }, velocity: { x: 65, y: -13 }, context: playContext(snapshot) });
    } else void action(modeAction, modeOption);
  };
  const layers = getRoomLayers(snapshot);
  const stains = washed || dirtSpots(pet.stats?.cleanliness, mess);
  const modeHint = careHint(snapshot, modeAction, clock, modeOption);
  const renderItem = (item) => {
    const slot = item.room.slot || item.slot;
    const room = ["decor", "bowl", "toy"].includes(slot) ? { ...item.room, z_index: groundLayerIndex(item.room.y) + 2 } : item.room;
    const plantEvent = item.id === "plant-moon" && ["plant-crash", "moon-plant"].includes(snapshot.daily_event?.id);
    return <button key={item.id} type="button" className={`play-room-object ${mess && item.id === "plant-moon" ? "toppled" : ""}`} style={roomLayerStyle(room)} aria-label={plantEvent ? snapshot.daily_event.title : item.name} disabled={locked} onClick={() => plantEvent ? setSheet("event") : slot === "bowl" ? selectMode("feed") : slot === "bed" ? selectMode("rest") : slot === "toy" ? selectMode("play") : openPanel("editor")}><PetRoomImage src={item.room.asset} name={item.name} />{plantEvent && <span className="play-object-event-dot" aria-hidden="true" />}</button>;
  };
  return <div className={`pet-playroom ${reducedMotion || !visible ? "play-still" : ""}`} data-testid="pet-playroom" data-mode={mode || "room"} data-theme={living.theme || "cyber"} onPointerMove={move} onPointerUp={end} onPointerCancel={cancelGesture}>
    <header className="play-header"><button type="button" aria-label="Повернутися в застосунок" onClick={() => navigate("/")}><ArrowLeft /></button><button className="play-name" onClick={() => setSheet("rename")}><span>МІЙ УЛЮБЛЕНЕЦЬ</span><strong>{pet.name}</strong></button><button type="button" aria-label="Магазин" onClick={() => navigate("/pet/collection")}><ShoppingBag /></button><button type="button" aria-label="Меню котика" onClick={() => openPanel("menu")}><Menu /></button></header>
    {(!online || syncError) && <div className="play-network" role="status">Немає зв’язку з сервером · дії призупинено <button onClick={retrySync}>Повторити</button></div>}
    {urgent && <button className="play-urgent" onClick={() => openPanel("health")}><ShieldAlert size={20} /><span>{life.label}. {life.riskLabel || (pet.stats?.health <= 25 ? "Без допомоги котик може померти." : "Потрібна допомога — торкнись тут.")}</span></button>}
    <div className="play-stage-shell" data-light={sleeping ? "night" : getKyivLight(clock)}>
      <img className="play-backdrop" src={catalog.room?.background_asset || "/pet/room/v2/background.webp"} alt="" />
      <div className="play-canvas" ref={canvas} role="region" aria-label="Ігрова кімната котика" onPointerLeave={() => { lookTarget.current = null; }}>
        <img className="play-room-background" src={catalog.room?.background_asset || "/pet/room/v2/background.webp"} alt="" draggable={false} />
        {layers.map(renderItem)}
        <div className={`play-weather ${living.weather?.id || ""}`} aria-hidden="true" />
        {pose !== "away" && <PetCatSprite pose={pose} snapshot={snapshot} zone={zone} reaction={reaction === "idle" ? scene.reaction : reaction} actionKey={feedback} aim={aim || scene.aim || 0} lookTarget={cursor} lookTargetRef={lookTarget} catRef={cat} disabled={locked} quiet={reducedMotion} paused={!visible || Boolean(panel || modalOpen)} touching={touching} now={clock} chaseTarget={chase || scene.target} onClick={clickCat} onPointerDown={(e, touchZone) => { if (!sleeping) begin(e, modeAction, modeOption, touchZone); }} />}
        {stains.length > 0 && !away && <div className="play-dirt" aria-hidden="true">{stains.map((spot) => <i key={spot.id} data-spot-id={spot.id} style={{ left: `${spot.x}%`, top: `${spot.y}%`, opacity: spot.remaining * .85, transform: "translate(-50%, -50%)" }} />)}</div>}
        {mode === "play" && toy === "ball" && <PetBall toss={toss} paused={locked} catPosition={() => { const c = cat.current?.getBoundingClientRect(), roomRect = canvas.current?.getBoundingClientRect(); return c && roomRect ? pointInScene({ x: c.left + c.width / 2, y: c.bottom - 12 }, roomRect) : null; }} onPosition={(ball) => { setAim((ball.x - 50) / 6); setChase({ x: ball.x }); }} onBounce={() => sound("bounce")} onFinish={(played, context) => { setToss(null); setChase(null); if (played) void action("play", "ball", context); }} />}
        {mode === "clean" && !locked && stains.length > 0 && <div className="play-scrub-surface" onPointerDown={(e) => begin(e, "clean", "default")} aria-hidden="true" />}
        {mode === "play" && !locked && <div className="play-toy-surface" onPointerDown={(e) => begin(e, "play", toy)} aria-hidden="true" />}
        <div className={`play-lights ${sleeping ? "off" : ""}`} aria-hidden="true" />
        {!away && <button className="play-lamp" aria-label={sleeping ? "Увімкнути лампу" : "Вимкнути лампу та вкласти спати"} disabled={locked} onClick={() => selectMode("rest")}><Lamp size={23} /></button>}
        {!away && <PetWorldEvents snapshot={snapshot} disabled={locked} setSheet={setSheet} claimGift={claimGift} navigate={navigate} onInspect={(kind) => { setInspecting({ kind, at: now }); setFeedback({ reaction: "idle", message: ({ box: "Зазирну в коробку…", butterfly: "Бачиш, як пурхає?", visitor: "Мур-р… у нас гостя!", ball: "Знайшов свою іграшку!", curtain: "Тепер тут затишніше.", key: "Пам’ятаю цей маленький скарб." })[kind] || "Це нагадує нашу пригоду." }); }} />}
        {!away && <button className="play-thought" disabled={locked} onClick={() => thought.action === "health" ? openPanel("health") : thought.action === "pet" ? void action("pet") : selectMode(thought.action)}><span aria-hidden="true">{thought.symbol}</span><span>{feedback?.message || activeNarrative?.reaction_text || thought.text}</span></button>}
        {away && <div className="play-away"><Moon size={36} /><strong>{life.alive ? "Котик досліджує світ" : life.label}</strong><p>{life.alive ? "Повернеться з експедиції зі знахідками." : life.summary}</p><button onClick={() => openPanel(life.alive ? "adventures" : "health")}>{life.alive ? "Переглянути пригоду" : "Що далі?"}</button></div>}
        {cursor && <div className="play-tool-cursor" aria-hidden="true" style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }}>{cursor.action === "pet" ? "💛" : <img src={petItemAsset(cursor.action === "feed" ? food : cursor.action === "play" ? toy : "sponge")} alt="" draggable={false} />}</div>}
      </div>
      <button className="play-state-peek" onClick={() => openPanel("health")} aria-label="Переглянути стан і довіру котика"><Heart size={17} /><span>{life.label}</span></button>
    </div>
    <div className="play-toolbox">
      {["feed", "play", "clean"].includes(mode) ? <>
        <div className="play-tray-heading"><span role="status">{modeHint.text || (mode === "feed" ? "Перетягни їжу до котика" : mode === "play" ? toy === "ball" ? "Кинь м’ячик — котик побіжить за ним" : "Води пір’їнкою та змінюй напрям" : "Потри губкою брудні місця")}</span><button aria-label="Сховати предмети" onClick={() => { cancelGesture(); setMode(null); }}><X size={18} /></button></div>
        <div className="play-tray">
          {(mode === "feed" ? PLAY_FOOD : mode === "play" ? PLAY_TOYS : [{ id: "default", label: "Губка" }]).map((item) => <button key={item.id} type="button" className={modeOption === item.id ? "selected" : ""} aria-label={item.label} aria-pressed={modeOption === item.id} disabled={locked} onPointerDown={(e) => { if (mode === "feed") setFood(item.id); if (mode === "play") setToy(item.id); begin(e, modeAction, item.id); }} onClick={() => {
            // Pointer capture sends the post-drag click back to this button.
            if (Date.now() < suppressClick.current) return;
            if (mode === "feed") setFood(item.id);
            if (mode === "play") { setToy(item.id); setToss(null); setChase(null); }
          }}><img src={petItemAsset(item.id)} alt="" draggable={false} /><small>{item.label}</small></button>)}
          <button className="play-tap-alternative" disabled={locked || modeHint.blocked} onClick={tapAlternative}><Hand size={20} /><small>{mode === "feed" ? "Пригостити" : mode === "play" ? "Пограти" : "Помити"}</small></button>
          {mode === "play" && <button className="play-arcade-link" onClick={() => navigate("/pet/games")}><Gamepad2 /><small>Мініігри</small></button>}
        </div>
      </> : <div className="play-small-hint"><Hand size={15} /><span>{sleeping ? sleepHint(snapshot, clock) : careHint(snapshot, "pet", clock).text || "Проведи пальцем по голівці"}</span></div>}
    </div>
    <nav className="play-needs" aria-label="Турбота про котика">{NEEDS.map(({ id, stat, label, Icon, color }) => <button key={id} type="button" aria-pressed={mode === id || id === "rest" && sleeping} className={mode === id || id === "rest" && sleeping ? "selected" : ""} disabled={locked} onClick={() => selectMode(id)}><span className="play-need-ring" style={{ "--need": `${Math.max(0, Math.min(100, pet.stats?.[stat] ?? 0))}%`, "--need-color": pet.stats?.[stat] < 25 ? "#ff7d85" : color }}><Icon size={26} /></span><span>{label}</span><span className="sr-only">{pet.stats?.[stat] < 25 ? ": потребує уваги" : ""}</span></button>)}</nav>
    <div className="pet-sr-status" aria-live="polite" role="status">{feedback?.message || ""}</div>
    <Drawer open={Boolean(panel)} onOpenChange={(open) => !open && setPanel(null)} shouldScaleBackground={false}><DrawerContent className="pet-drawer play-detail-drawer"><DrawerHeader><DrawerTitle>{TITLES[panel] || "Кімната"}</DrawerTitle><DrawerDescription>{panel === "menu" ? "Усе інше — тут. Кімната залишається для гри." : "Подробиці та дії за потреби"}</DrawerDescription></DrawerHeader><div className="pet-drawer-body">{panel === "menu" ? <div className="play-menu-grid">{[["health", Heart, "Стан котика"], ["adventures", Feather, "Пригоди"], ["editor", Package, "Розставити речі"], ["settings", Settings2, "Налаштування"], ["friends", Cat, "Друзі"], ["ritual", Gift, "Денний ритуал"]].map(([id, Icon, label]) => <button key={id} onClick={() => setPanel(id)}><Icon /><span>{label}</span></button>)}<button onClick={() => navigate("/pet/games")}><Gamepad2 /><span>Три мініігри</span></button><button onClick={() => navigate("/pet/journal")}><BookOpen /><span>Щоденник</span></button></div> : renderPanel(panel, () => setPanel(null))}</div><button className="pet-secondary-button play-drawer-close" onClick={() => setPanel(panel === "menu" ? null : "menu")}>{panel === "menu" ? <X size={17} /> : <ArrowLeft size={17} />}{panel === "menu" ? "До котика" : "Назад до меню"}</button></DrawerContent></Drawer>
  </div>;
}
