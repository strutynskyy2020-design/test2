import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Armchair, Brain, Camera, Cat, Check, ChevronRight, Clock3, Feather, Heart, Leaf, MapPinned, Package, PawPrint, Search, Settings2, ShieldCheck, ShoppingBag, Sparkles, Volume2, VolumeX, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { getRoomLayers, roomLayerStyle } from "./petRoom";
import { sleepHint, careHint } from "./petCareView";
import "@/styles/petLiving.css";

const RARITIES = { basic: "Звичайний", improved: "Покращений", rare: "Рідкісний", epic: "Епічний", legendary: "Легендарний" };
const SKILL_ICONS = { hunter: PawPrint, explorer: MapPinned, actor: Camera, thinker: Brain, companion: Heart };
const MATERIAL_ICONS = { cardboard: Package, string: Sparkles, fabric: Armchair, leaf: Leaf, feather: Feather, photo: Sparkles };
export const lifeContext = (snapshot) => ({ date_key: snapshot.date_key, generation: snapshot.pet.survival?.generation || 1 });
export const canAffordPetItem = (item, wallet) => Object.entries(item.price || {}).length > 0 && Object.entries(item.price || {}).every(([key, amount]) => Number(wallet[key] || 0) >= amount);

function Materials({ snapshot }) {
  return <div className="pet-materials living-wallet" aria-label="Ваші матеріали">{Object.entries(snapshot.catalog?.materials || {}).map(([key, label]) => { const Icon = MATERIAL_ICONS[key] || Package; return <div key={key}><Icon size={18} /><strong>{snapshot.pet.inventory?.materials?.[key] || 0}</strong><span>{label}</span></div>; })}</div>;
}

export function ShopPanel({ snapshot, perform, busy }) {
  const [filter, setFilter] = useState("all");
  const [rarity, setRarity] = useState("all");
  const [pendingItem, setPendingItem] = useState(null);
  const { pet, catalog } = snapshot;
  const wallet = pet.inventory?.materials || {};
  const owned = new Set(pet.inventory?.items || []);
  const alive = pet.survival?.status === "alive";
  const visible = (catalog?.items || []).filter((item) => (rarity === "all" || rarity === item.rarity) && (filter === "all" || (filter === "owned" ? owned.has(item.id) : filter === "affordable" ? !owned.has(item.id) && canAffordPetItem(item, wallet) : !owned.has(item.id))));
  const purchase = async () => {
    if (!pendingItem) return;
    const result = await perform({ url: "/pet/shop/purchase", body: { ...pendingItem.context, item_id: pendingItem.item.id } });
    if (result) { toast.success(result.message); setPendingItem(null); }
  };
  const equip = async (item, remove) => {
    const result = await perform({ url: `/pet/collection/${remove ? "unequip" : "equip"}`, body: { item_id: item.id } });
    if (result) toast.success(result.message || "Кімнату оновлено");
  };
  return <div className="pet-panel living-shop" data-testid="pet-panel-collection">
    <header className="living-shop-hero"><span className="living-eyebrow">Речі з маленьких знахідок</span><h2>Крамничка затишку <ShoppingBag size={28} /></h2><p>Знахідки → нові речі. Без обмежень за рівнем.</p></header>
    <Materials snapshot={snapshot} />
    <div className="living-shop-controls"><div className="pet-filter-row" role="group" aria-label="Фільтри магазину" data-testid="pet-collection-filters">{[["all", "Усе"], ["affordable", "Вистачає"], ["new", "Ще не моє"], ["owned", "Мої речі"]].map(([id, label]) => <button type="button" key={id} aria-pressed={filter === id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{label}</button>)}</div><label className="living-select">Рідкість<select value={rarity} onChange={(event) => setRarity(event.target.value)}><option value="all">Усі предмети</option>{Object.entries(RARITIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
    {!alive && <p className="living-note">Магазин і ваші речі збережені. Встановлювати предмети можна після прихистку нового котика.</p>}
    <div className="living-shop-grid" data-testid="pet-collection-grid">{visible.map((item) => {
      const isOwned = owned.has(item.id), equipped = pet.inventory?.equipped?.[item.room?.slot || item.slot] === item.id;
      const affordable = canAffordPetItem(item, wallet), condition = snapshot.life?.condition?.[item.id] ?? 100;
      return <article className={`living-product rarity-${item.rarity}`} key={item.id} data-testid={`pet-collection-item-${item.id}`}>
        <div className="living-product-art"><img src={item.room?.asset} alt="" loading="lazy" decoding="async" width="160" height="140" />{equipped && <span><Check size={12} /> У кімнаті</span>}</div>
        <div className="living-product-copy"><small>{RARITIES[item.rarity] || item.rarity}</small><h3>{item.name}</h3><p>{item.description}</p></div>
        {isOwned ? <><span className="living-owned"><Check size={14} /> Ваша річ · стан {condition}%</span><button type="button" className="living-button" disabled={busy || !alive} aria-pressed={equipped} onClick={() => equip(item, equipped)}>{equipped ? "Забрати з кімнати" : "Поставити в кімнату"}</button></> : <>
          <div className="living-price" aria-label="Ціна">{Object.entries(item.price || {}).map(([key, amount]) => <span key={key} className={Number(wallet[key] || 0) < amount ? "missing" : ""}>{catalog.materials?.[key] || key} <b>{amount}</b><small>у вас {wallet[key] || 0}</small></span>)}</div>
          <button type="button" className="living-button living-button--buy" disabled={busy || !affordable} onClick={() => setPendingItem({ item, context: lifeContext(snapshot) })}><ShoppingBag size={15} />{affordable ? "Придбати" : "Бракує матеріалів"}</button>
        </>}
      </article>;
    })}</div>
    {!visible.length && <div className="pet-empty-card"><Search size={26} /><strong>Тут поки немає речей</strong><p>Змініть фільтр або назбирайте матеріали в кімнаті й експедиціях.</p></div>}
    <p className="living-note">Щоденний пошук, експедиції, мініігри та події приносять матеріали. Куплена річ залишається назавжди; ремонт необов’язковий і не впливає на шанс призу.</p>
    <Drawer open={Boolean(pendingItem)} dismissible={!busy} onOpenChange={(open) => !open && !busy && setPendingItem(null)}><DrawerContent className="pet-drawer"><DrawerHeader><DrawerTitle>Придбати {pendingItem?.item.name}?</DrawerTitle><DrawerDescription>Матеріали спишуться один раз. Покупка не встановлює предмет автоматично й не залежить від рівня дружби.</DrawerDescription></DrawerHeader><div className="living-purchase-confirm"><p>{Object.entries(pendingItem?.item.price || {}).map(([key, value]) => `${catalog.materials?.[key]} ×${value}`).join(" · ")}</p><button type="button" className="pet-primary-button" disabled={busy} onClick={purchase}>{busy ? "Купуємо…" : "Підтвердити покупку"}</button><button type="button" className="pet-secondary-button" disabled={busy} onClick={() => setPendingItem(null)}>Не зараз</button></div></DrawerContent></Drawer>
  </div>;
}

function useLifeClock(serverTime) {
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0);
  useEffect(() => {
    offset.current = (new Date(serverTime || "").getTime() || Date.now()) - Date.now();
    setNow(Date.now() + offset.current);
    const timer = window.setInterval(() => { if (!document.hidden) setNow(Date.now() + offset.current); }, 30_000);
    return () => window.clearInterval(timer);
  }, [serverTime]);
  return now;
}

function remaining(until, now) {
  const minutes = Math.max(0, Math.ceil((new Date(until).getTime() - now) / 60_000));
  return !minutes ? "Завершується…" : minutes >= 60 ? `${Math.floor(minutes / 60)} год ${minutes % 60} хв` : `${minutes} хв`;
}

export function LifeSummary({ snapshot }) {
  const now = useLifeClock(snapshot.server_time);
  const life = snapshot.life;
  if (!life || snapshot.pet.survival?.status !== "alive") return null;
  return <section className="living-summary"><div className="living-summary-heading"><Clock3 size={19} /><div><span className="living-eyebrow">Ритм котика · київський час</span><strong>{life.routine.label}</strong></div><span>до {life.routine.next_at}</span></div>
    {life.sleep?.active && <p className="living-sleep-note" role="status">{sleepHint(snapshot, now)}</p>}
    {life.care_preview.warning && <p className="living-warning">{life.care_preview.warning}</p>}
    <p className="living-reason"><PawPrint size={15} /><span>{life.mood_reason}</span></p>
    {life.debuff_until && new Date(life.debuff_until).getTime() > now && <p className="living-warning">Тимчасова реакція: ще {remaining(life.debuff_until, now)}. Потреби теж впливають на стан.</p>}
    {life.combos?.map((combo) => <div className="living-combo" key={combo.title}><strong>{combo.title}</strong><span>{combo.text}</span></div>)}
    <div className="living-forecasts">{life.forecasts?.map((forecast) => <span key={forecast.id}>{forecast.label}<b>≈ {forecast.hours} год</b></span>)}</div>
    <small className="living-muted">{life.forecast_paused ? "Зараз діє захист від часового погіршення потреб." : "Оцінка без нових дій: лише години погіршення, вихідні й пільговий час не враховано. Енергія поступово відновлюється."}</small>
  </section>;
}

export function LivingActivities({ snapshot, perform, busy }) {
  const life = snapshot.life;
  const now = useLifeClock(snapshot.server_time);
  const [selectedSearch, setSelectedSearch] = useState("shelf");
  const [activityScene, setActivityScene] = useState(null);
  const [steps, setSteps] = useState(0);
  const context = lifeContext(snapshot);
  if (!life || snapshot.pet.survival?.status !== "alive") return null;
  const act = async (kind, target, frozenContext = context) => {
    const result = await perform({ url: "/pet/life/activity", body: { ...frozenContext, kind, target } });
    if (result) { toast.success(result.message); setActivityScene(null); setSteps(0); }
  };
  const specialSteps = {
    hunter: ["Покажи пір’їнку", "Поведи її вбік", "Дай котику стрибнути"],
    explorer: ["Знайди перший слід", "Перевір куточок", "Познач маршрут"],
    actor: ["Запроси на сцену", "Покажи жест", "Збережи позу"],
    thinker: ["Розглянь знак", "Порівняй три сліди", "Підтверди здогадку"],
    companion: ["Сядь поруч", "Залиш котику простір", "Заверши тихий ритуал"],
  };
  return <div className="living-activities">
    <details className="living-details" open><summary><Search size={19} /><span>Пошук маленьких скарбів</span><small>{life.daily.search_used ? "До завтра" : "1 пошук сьогодні"}</small></summary><div className="living-details-body"><p>Оберіть одну зону. −10 енергії, −3 чистоти, +5 досвіду Дослідника.</p><div className="living-search-options">{[["shelf", "Полиця", "3 картони · 2 мотузки", Package], ["window", "Біля вікна", "2 листки · 1 пір’їнка", Leaf], ["bed", "За лежанкою", "2 тканини · 1 листок", Camera]].map(([id, label, detail, Icon]) => <button type="button" key={id} className={selectedSearch === id ? "selected" : ""} aria-pressed={selectedSearch === id} disabled={busy || life.daily.search_used || careHint(snapshot, "play", now).blocked} onClick={() => setSelectedSearch(id)}><Icon size={22} /><strong>{label}</strong><small>{detail}</small></button>)}</div><button type="button" className="living-button living-button--buy" disabled={busy || life.daily.search_used} onClick={() => act("search", selectedSearch)}><Search size={16} />{life.daily.search_used ? "Скарби на сьогодні знайдено" : "Дослідити обрану зону"}</button>{life.daily.search_used_receipt && <p role="status">{life.daily.search_used_receipt.message}</p>}</div></details>
    <details className="living-details"><summary><Brain size={19} /><span>Котячі таланти</span><small>5 напрямів</small></summary><div className="living-details-body"><p>Навички ростуть від турботи, подій та ігор. Одне тренування або особливе заняття на день. При 25 досвіду відкривається заняття; частина талантів дає додаткові варіанти в подіях. Без бонусів до Point.</p><div className="living-skill-grid">{life.skills.map((skill) => { const Icon = SKILL_ICONS[skill.id] || PawPrint; return <article key={skill.id}><div className="living-skill-heading"><Icon size={21} /><strong>{skill.name}</strong><small>{skill.xp}/100</small></div><progress max="100" value={skill.xp} aria-label={`Досвід: ${skill.name}`} /><p>{skill.description}</p><small>{skill.unlocked ? skill.unlock : `Ще ${25 - skill.xp} досвіду до відкриття`}</small><button type="button" className="living-button" disabled={busy || life.daily.skill_used || careHint(snapshot, "play", now).blocked} onClick={() => act("train", skill.id)}>Тренувати · −8 енергії</button>{skill.unlocked && <button type="button" className="living-button living-button--special" disabled={busy || life.daily.skill_used || careHint(snapshot, "play", now).blocked} onClick={() => { setSteps(0); setActivityScene({ skill, context }); }}><Sparkles size={14} /> Особливе заняття</button>}</article>; })}</div></div></details>
    <details className="living-details"><summary><Heart size={19} /><span>Що котик пам’ятає</span><small>{life.memories.length}/20</small></summary><div className="living-details-body"><p>Улюблена їжа: {life.preferences.food}. Іграшка: {life.preferences.toy}. Останні вчинки пояснюють реакції й розвивають характер.</p>{life.pending.map((pending) => <div className="living-pending" key={pending.id}><Clock3 size={17} /><div><strong>{pending.title}</strong><small>{remaining(pending.due_at, now)}</small></div></div>)}{life.memories.length ? <ol className="living-memories">{life.memories.map((memory) => <li key={memory.id} data-tone={memory.tone}><time>{new Date(memory.at).toLocaleDateString("uk-UA", { day: "numeric", month: "short", timeZone: "Europe/Kyiv" })}</time><strong>{memory.title}</strong><p>{memory.text}</p></li>)}</ol> : <p>Перші спогади з’являться після турботи й ваших рішень.</p>}</div></details>
    <Drawer open={Boolean(activityScene)} dismissible={!busy} onOpenChange={(open) => !open && !busy && setActivityScene(null)}><DrawerContent className="pet-drawer"><DrawerHeader><DrawerTitle>{activityScene?.skill.name}: час разом</DrawerTitle><DrawerDescription>Коротка спільна сценка, не змагання. Завершення: −12 енергії, +8 настрою та +8 досвіду.{activityScene?.skill.id === "companion" ? " Також +1 довіри." : ""}</DrawerDescription></DrawerHeader><div className={`living-special-scene living-special-scene--${activityScene?.skill.id}`}><img src={`/pet/room/v2/cat/cat-${activityScene?.skill.id === "hunter" ? "play" : activityScene?.skill.id === "companion" ? "sleep" : "sit"}.webp`} alt="Котик під час заняття" /><span>{steps + 1}/3</span><button type="button" className="living-button living-button--buy" disabled={busy} onClick={() => steps < 2 ? setSteps(steps + 1) : act("special", activityScene.skill.id, activityScene.context)}>{specialSteps[activityScene?.skill.id]?.[steps] || "Продовжити"}</button></div></DrawerContent></Drawer>
  </div>;
}

/** Optional generated tones only: no downloaded audio, no background playback. */
export function usePetAmbience(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    let audioContext;
    const stop = () => { if (audioContext) { void audioContext.close().catch(() => {}); audioContext = null; } };
    const play = () => {
      if (document.hidden || audioContext) return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      try {
        audioContext = new AudioContext();
        const volume = audioContext.createGain();
        volume.gain.value = .014;
        volume.connect(audioContext.destination);
        [130.81, 196, 261.63].forEach((frequency) => { const tone = audioContext.createOscillator(); tone.type = "sine"; tone.frequency.value = frequency; tone.connect(volume); tone.start(); });
        void audioContext.resume().catch(() => {});
      } catch (_) { stop(); }
    };
    const visibility = () => { if (document.hidden) stop(); };
    // Browsers require a gesture, including when the preference was restored.
    document.addEventListener("pointerdown", play);
    document.addEventListener("keydown", play);
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("pointerdown", play); document.removeEventListener("keydown", play); document.removeEventListener("visibilitychange", visibility); stop(); };
  }, [enabled]);
}

export function RoomLivingSettings({ snapshot, perform, busy }) {
  const [presetName, setPresetName] = useState("Моя кімната");
  const life = snapshot.life;
  const [overwriting, setOverwriting] = useState(null);
  if (!life) return null;
  const settings = async (body) => { const result = await perform({ method: "patch", url: "/pet/room/settings", body }); if (result) toast.success(result.message); };
  const preset = async (slot, action) => { const result = await perform({ url: "/pet/room/presets", body: { slot, action, name: presetName.trim() || "Моя кімната" } }); if (result) { toast.success(result.message); setOverwriting(null); } };
  const repair = async (item) => { const result = await perform({ url: "/pet/life/activity", body: { ...lifeContext(snapshot), kind: "repair", target: item.id } }); if (result) toast.success(result.message); };
  return <><div className="living-room-tools"><button type="button" disabled={busy} aria-pressed={life.sound === "ambient"} onClick={() => settings({ sound: life.sound === "ambient" ? "off" : "ambient" })}>{life.sound === "ambient" ? <Volume2 size={16} /> : <VolumeX size={16} />} Звук {life.sound === "ambient" ? "увімкнено" : "вимкнено"}</button></div><details className="living-details"><summary><Settings2 size={18} /><span>Стиль і збереження кімнати</span></summary><div className="living-details-body"><p>Чотири світлові атмосфери з легким декором. Без завантаження нових великих фонів. Звук почнеться після наступного торкання й вимкнеться, коли сховаєте застосунок.</p><div className="living-themes">{life.themes.map((theme) => <button type="button" key={theme.id} data-theme={theme.id} className={life.theme === theme.id ? "selected" : ""} aria-pressed={life.theme === theme.id} disabled={busy} onClick={() => settings({ theme: theme.id })}><span /><strong>{theme.name}</strong></button>)}</div>
      <label className="living-select">Назва збереження<input value={presetName} maxLength={30} onChange={(event) => setPresetName(event.target.value)} /></label><div className="living-presets">{[1, 2, 3].map((slot) => { const saved = life.presets.find((p) => p.id === String(slot)); return <div key={slot}><strong>{slot}. {saved?.name || "Вільний слот"}</strong><button type="button" disabled={busy} onClick={() => saved ? setOverwriting(slot) : preset(slot, "save")}>Зберегти сюди</button>{saved && <button type="button" disabled={busy} onClick={() => preset(slot, "load")}>Застосувати</button>}{overwriting === slot && <div className="living-overwrite" role="group" aria-label="Перезапис збереження"><span>Замінити «{saved?.name}» поточною кімнатою?</span><button type="button" disabled={busy} onClick={() => preset(slot, "save")}>Так, замінити</button><button type="button" onClick={() => setOverwriting(null)}>Скасувати</button></div>}</div>; })}</div>
      <h3>Догляд за речами</h3><p>Звичайний знос — 2% за відвіданий день, у брудній кімнаті — 7%. Це вигляд, не бонуси до призів. Відновлення: 1 картон + 1 мотузка за предмет.</p><div className="living-repairs">{(snapshot.catalog?.items || []).filter((item) => snapshot.pet.inventory?.items?.includes(item.id) && (life.condition[item.id] ?? 100) < 100).map((item) => <div key={item.id}><span>{item.name}<small>Стан {life.condition[item.id]}%</small></span><button type="button" disabled={busy || snapshot.pet.survival?.status !== "alive" || (snapshot.pet.inventory.materials.cardboard || 0) < 1 || (snapshot.pet.inventory.materials.string || 0) < 1 || life.daily.repairs?.includes(item.id)} onClick={() => repair(item)}><Wrench size={14} /> Відновити</button></div>)}</div>
    </div></details></>;
}

export function RoomPostcard({ room, catalog, pair }) {
  const snapshot = { pet: { inventory: { equipped: room?.equipped || {} }, room_layout: room?.room_layout || {} }, catalog };
  return <div className="living-postcard" data-theme={room?.theme || "nature"} role="img" aria-label={pair ? `Спільне фото: ${pair.map((cat) => cat.name).join(" і ")}` : `Кімната котика ${room?.name}`}>
    <img className="living-postcard-bg" src={catalog?.room?.background_asset || "/pet/room/v2/background.webp"} alt="" loading="lazy" decoding="async" />
    {getRoomLayers(snapshot).map((item) => <img className="pet-room-layer" key={item.id} style={roomLayerStyle(item.room)} src={item.room.asset} alt="" loading="lazy" decoding="async" />)}
    {(pair || [{ name: room?.name }]).map((cat, index) => <img className="living-postcard-cat" key={index} style={{ left: pair ? `${26 + index * 42}%` : "50%", width: pair ? "33%" : "38%" }} src="/pet/room/v2/cat/cat-sit.webp" alt="" loading="lazy" decoding="async" />)}
    <div className="living-theme-decor" aria-hidden="true" />
    <span className="living-postcard-label">{pair ? pair.map((cat) => cat.name).join(" + ") : room?.name}</span>
  </div>;
}

export function PetNeighborhood({ snapshot, perform, busy }) {
  const [open, setOpen] = useState(false);
  const [exhibition, setExhibition] = useState(false);
  const [cursor, setCursor] = useState("");
  const [visitor, setVisitor] = useState(null);
  const userId = snapshot.pet.user_id;
  const now = useLifeClock(snapshot.server_time);
  const rooms = useQuery({ queryKey: ["pet-neighbors", userId, exhibition, cursor], queryFn: async () => (await api.get("/pet/social/rooms", { params: { exhibition, after: cursor } })).data, enabled: open, staleTime: 10_000, retry: 1 });
  const inbox = useQuery({ queryKey: ["pet-inbox", userId], queryFn: async () => (await api.get("/pet/social/inbox")).data, enabled: open, staleTime: 10_000, refetchInterval: open ? 60_000 : false, retry: 1 });
  if (!snapshot.life) return null;
  const settings = async (body) => { const result = await perform({ method: "patch", url: "/pet/room/settings", body }); if (result) { toast.success(result.message); void rooms.refetch(); void inbox.refetch(); } };
  const send = async (url, body) => { const result = await perform({ url, body: { ...lifeContext(snapshot), ...body }, updateSnapshot: false }); if (result) { toast.success(result.message); void inbox.refetch(); } };
  const incoming = inbox.data?.items || [];
  const unavailable = busy || snapshot.pet.survival?.status !== "alive" || !snapshot.life.public_room;
  return <details className="living-details living-neighborhood" onToggle={(event) => setOpen(event.currentTarget.open)}><summary><PawPrint size={19} /><span>Котяче сусідство</span><small>Без рейтингу</small></summary>{open && <div className="living-details-body"><p>Показуйте тільки кімнату, ім’я котика та речі. Ваші потреби, ресурси й дані облікового запису залишаються приватними.</p>
    <label className="living-toggle"><input type="checkbox" checked={snapshot.life.public_room} disabled={busy} onChange={(event) => settings({ public_room: event.target.checked })} /><span>Дозволити гостям бачити мою кімнату</span></label>
    <label className="living-toggle"><input type="checkbox" checked={snapshot.life.exhibition} disabled={busy || !snapshot.life.public_room} onChange={(event) => settings({ exhibition: event.target.checked })} /><span>Участь у виставці затишку</span></label>
    <div className="pet-filter-row"><button type="button" aria-pressed={!exhibition} className={!exhibition ? "active" : ""} onClick={() => { setExhibition(false); setCursor(""); }}>Усі відкриті кімнати</button><button type="button" aria-pressed={exhibition} className={exhibition ? "active" : ""} onClick={() => { setExhibition(true); setCursor(""); }}>Виставка</button></div>
    {rooms.isLoading ? <p>Шукаємо сусідів…</p> : rooms.isError ? <p role="alert">{extractError(rooms.error, "Кімнати не завантажилися")} <button type="button" onClick={() => rooms.refetch()}>Повторити</button></p> : <><div className="living-neighbors">{rooms.data?.items?.map((room) => <button type="button" key={room.id} onClick={() => setVisitor(room)}><RoomPostcard room={room} catalog={snapshot.catalog} /><span>У гості до {room.name}<ChevronRight size={15} /></span></button>)}</div>{!rooms.data?.items?.length && <p>На цій сторінці ще немає відкритих кімнат. Участь добровільна.</p>}<div className="living-room-tools">{cursor && <button type="button" onClick={() => setCursor("")}>На початок</button>}{rooms.data?.next_cursor && <button type="button" onClick={() => setCursor(rooms.data.next_cursor)}>Наступні кімнати</button>}</div></>}
    <h3>Листівки й прогулянки</h3><p>Один знак уваги на день: реакція, символічні ласощі, листівка або запрошення. Прогулянка потребує згоди обох, триває 2 години й не перериває догляд.</p>{inbox.isError && <p role="alert">Не вдалося отримати листівки. <button type="button" onClick={() => inbox.refetch()}>Повторити</button></p>}
    {incoming.map((row) => <article className="living-social-message" key={row.id}><strong>{row.outgoing ? "Ви → " : "Вам від "}{row.other.name}</strong><span>{row.title}</span>{row.kind === "invite" && row.status === "pending" && !row.outgoing && <button type="button" className="living-button" disabled={unavailable} onClick={() => send("/pet/social/accept", { invitation_id: row.id })}>Прийняти запрошення</button>}{row.status === "accepted" && (new Date(row.ends_at).getTime() <= now ? <small>Прогулянка завершена. Дякуємо за компанію!</small> : <small>Прогулянка завершиться через {remaining(row.ends_at, now)}</small>)}</article>)}{!incoming.length && !inbox.isLoading && !inbox.isError && <p>Тут з’являться знаки уваги та спільні пригоди.</p>}
    <Drawer open={Boolean(visitor)} onOpenChange={(next) => !next && setVisitor(null)}><DrawerContent className="pet-drawer"><DrawerHeader><DrawerTitle>У гостях: {visitor?.name}</DrawerTitle><DrawerDescription>Дивіться, порівнюйте речі й залишайте один знак уваги на день. Тут не можна змінювати чужу кімнату.</DrawerDescription></DrawerHeader>{visitor && <div className="living-visit"><RoomPostcard room={visitor} catalog={snapshot.catalog} /><div className="living-compare">Спільних речей: {visitor.items.filter((id) => snapshot.pet.inventory.items.includes(id)).length} · У гостя: {visitor.items.length}<p>Ще немає у вас: {visitor.items.filter((id) => !snapshot.pet.inventory.items.includes(id)).map((id) => snapshot.catalog.items.find((item) => item.id === id)?.name).filter(Boolean).join(", ") || "Усі речі вже знайомі"}</p></div><div className="living-visit-actions">{[["heart", "Лапка симпатії", Heart], ["treat", "Ласощі-листівка", PawPrint], ["postcard", "Побажати затишку", Camera], ["invite", "Запросити гуляти", MapPinned]].map(([kind, label, Icon]) => <button type="button" className="living-button" key={kind} disabled={unavailable || inbox.data?.today_used} onClick={() => send("/pet/social/react", { target_id: visitor.id, kind })}><Icon size={16} />{label}</button>)}</div>{!snapshot.life.public_room && <p>Для взаємодії спочатку відкрийте свою кімнату гостям.</p>}{inbox.data?.today_used && <p>Ваш знак уваги вже надіслано. Новий доступний завтра.</p>}<button type="button" className="pet-secondary-button" onClick={() => setVisitor(null)}><X size={16} /> Повернутися додому</button></div>}</DrawerContent></Drawer>
  </div>}</details>;
}
