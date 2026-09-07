import "@/styles/pet.css";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle, Armchair, Backpack, BedDouble, Bell, BookOpen, Brain, Camera,
  Cat, Check, ChevronRight, Circle, Clock3, Crosshair, Edit3, Gamepad2, Gift,
  Hand, Heart, Home, Leaf, LoaderCircle, Lock, MapPinned, Moon, Package,
  PawPrint, Puzzle, RotateCcw, Shirt, Sparkles, Sprout, Star, Utensils,
  Waves, WifiOff, X,
} from "lucide-react";
import { toast } from "sonner";

import {
  Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter,
  DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { useApp } from "@/context/AppContext";
import api, { extractError } from "@/lib/api";
import {
  derivePetLifeView, derivePetPose, getKyivLight, getRoomLayers, petRefetchInterval,
  isUsablePetImage, roomLayerStyle, ROOM_GRID_PERCENT, ROOM_REACTIONS, snapRoomPlacement,
} from "./petRoom";
import {
  activeLaserTargets, eventFinishPayload, laserTargetPosition, memoryFinishPayload,
  normalizeGameId, publicGameChallenge, withClientDuration,
} from "./petGames";

const TAB_ITEMS = [
  { id: "room", label: "Кімната", icon: Home },
  { id: "games", label: "Ігри", icon: Gamepad2 },
  { id: "journal", label: "Щоденник", icon: BookOpen },
  { id: "collection", label: "Колекція", icon: Package },
];

const INTENTS = [
  { id: "explore", label: "Досліджувати", icon: MapPinned, color: "purple" },
  { id: "learn", label: "Навчатися", icon: Brain, color: "cyan" },
  { id: "build", label: "Облаштувати", icon: Armchair, color: "amber" },
];

const ITEM_ICONS = { bed: BedDouble, bowl: Utensils, wand: Sparkles, sparkles: Sparkles, waves: Waves, badge: Shirt, sprout: Sprout, castle: Package, camera: Camera, moon: Moon };
const MATERIAL_ICONS = { cardboard: Package, string: Circle, fabric: Shirt, feather: Sparkles, leaf: Leaf, photo: Camera };
const LOADOUT_ICONS = { backpack: Backpack, camera: Camera, bell: Bell, blanket: Moon };
const SORTING_ICONS = { fish: Utensils, cookie: Circle, bone: Gift, circle: Circle, ball: Circle, feather: Sparkles, camera: Camera, book: BookOpen, sprout: Sprout, bowl: Utensils, mouse: Cat, lamp: Sparkles, package: Package };
const GAME_COLORS = ["#FFB800", "#00F0FF", "#A78BFA", "#39FF14"];

const HOTSPOTS = [
  { id: "shelf", label: "Полиця", icon: Package, className: "pet-hotspot--shelf", followSlot: "shelf", x: 20, y: 29 },
  { id: "window", label: "Подія біля вікна", icon: Sparkles, className: "pet-hotspot--window" },
  { id: "cat", label: "Погладити кота", icon: Hand, className: "pet-hotspot--cat" },
  { id: "toy", label: "Обрати іграшку", icon: Gamepad2, className: "pet-hotspot--toy", followSlot: "toy", x: 87, y: 52 },
  { id: "bowl", label: "Обрати їжу", icon: Utensils, className: "pet-hotspot--bowl", followSlot: "bowl", x: 15, y: 69 },
  { id: "bed", label: "Вкласти відпочити", icon: Moon, className: "pet-hotspot--bed", followSlot: "bed", x: 64, y: 67 },
  { id: "gift", label: "Перевірити подарунок", icon: Gift, className: "pet-hotspot--gift" },
];

const FOOD_OPTIONS = [
  { id: "balanced", name: "Збалансований корм", detail: "+25 ситості", icon: Utensils },
  { id: "fish", name: "Рибка", detail: "+18 ситості · +8 настрою", icon: Sparkles },
  { id: "crunchy", name: "Хрумкий корм", detail: "+30 ситості", icon: Circle },
];

const TOY_OPTIONS = [
  { id: "wand", name: "Неонова вудочка", detail: "+20 настрою · прив'язаність", icon: Sparkles },
  { id: "ball", name: "М'ячик", detail: "+24 настрою · більше руху", icon: Circle },
  { id: "puzzle", name: "Головоломка", detail: "+14 настрою · кмітливість", icon: Puzzle },
];

const createIdempotencyKey = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `pet-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const formatEventTime = (value) => {
  if (!value) return "Щойно";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Нещодавно";
  return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Kyiv" }).format(date);
};

const formatRemaining = (endsAt, nowMs) => {
  const remaining = Math.max(0, new Date(endsAt).getTime() - nowMs);
  if (!Number.isFinite(remaining) || remaining <= 0) return "Готово";
  const totalMinutes = Math.ceil(remaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours} год ${minutes} хв` : `${minutes} хв`;
};

const clampPercent = (value) => Math.max(0, Math.min(100, Number(value) || 0));

const roomDraftFromSnapshot = (snapshot) => Object.fromEntries(
  getRoomLayers(snapshot).map((item) => [item.id, { x: Number(item.room.x), y: Number(item.room.y) }]),
);

const roomLayoutSignature = (layout = {}) => JSON.stringify(
  Object.entries(layout)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([itemId, position]) => [itemId, Number(position?.x), Number(position?.y)]),
);

function PetLoading() {
  return (
    <section className="pet-page pet-state-page" data-testid="pet-loading" aria-live="polite">
      <div className="pet-loader-orbit"><Cat size={28} /><span /></div>
      <h1 className="font-display">ПІКСЕЛЬ ПРОКИДАЄТЬСЯ</h1>
      <p>Готуємо кімнату та сьогоднішні пригоди…</p>
    </section>
  );
}

function PetError({ error, onRetry }) {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <section className="pet-page pet-state-page" data-testid={offline ? "pet-offline" : "pet-error"}>
      <div className="pet-state-icon">{offline ? <WifiOff /> : <AlertCircle />}</div>
      <h1 className="font-display">{offline ? "КІМНАТА ОФЛАЙН" : "КІТ СХОВАВСЯ"}</h1>
      <p>{offline ? "Дії та подарунки офлайн не нараховуються. Під'єднайтеся до мережі." : extractError(error, "Не вдалося завантажити улюбленця")}</p>
      <button type="button" className="pet-primary-button" onClick={onRetry} data-testid="pet-retry"><RotateCcw size={18} /> Спробувати ще раз</button>
    </section>
  );
}

function PetHeader({ pet, life, onRename }) {
  const dominantTrait = Object.entries(pet.traits || {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  const traitLabel = pet.personality?.label || { curiosity: "Допитливий", affection: "Лагідний", intelligence: "Кмітливий" }[dominantTrait] || "Щасливий";
  return (
    <div className="pet-profile-header">
      <div className="pet-profile-copy">
        <span className="pet-eyebrow">Мій улюбленець</span>
        <div className="pet-name-row">
          <h1 className="font-display" data-testid="pet-name">{pet.name}</h1>
          <button type="button" onClick={onRename} aria-label="Змінити ім'я кота" className="pet-icon-button" disabled={!life.alive}><Edit3 size={16} /></button>
        </div>
        <div className={`pet-trait-line pet-trait-line--${life.tone}`}><span className="pet-live-dot" /> {life.condition === "healthy" ? traitLabel : life.label}</div>
      </div>
      <div className="pet-level-card" data-testid="pet-friendship-level"><span>Дружба</span><strong>{pet.friendship_level}</strong><small>рівень</small></div>
    </div>
  );
}

function PetTabs({ activeTab, petStatus, onChange }) {
  const onKeyDown = (event, index) => {
    let nextIndex = null;
    if (["ArrowRight", "ArrowDown"].includes(event.key)) nextIndex = (index + 1) % TAB_ITEMS.length;
    if (["ArrowLeft", "ArrowUp"].includes(event.key)) nextIndex = (index - 1 + TAB_ITEMS.length) % TAB_ITEMS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TAB_ITEMS.length - 1;
    if (nextIndex === null) return;
    if (petStatus !== "alive" && TAB_ITEMS[nextIndex]?.id === "games") nextIndex = event.key === "ArrowLeft" || event.key === "ArrowUp" ? 0 : 2;
    event.preventDefault();
    onChange(TAB_ITEMS[nextIndex].id);
    event.currentTarget.parentElement?.children[nextIndex]?.focus();
  };
  return (
    <div className="pet-tabs" data-testid="pet-tabs">
      <div className="pet-tabs-list" role="tablist" aria-label="Розділи улюбленця">
        {TAB_ITEMS.map(({ id, label, icon: Icon }, index) => { const locked = id === "games" && petStatus !== "alive"; return <button key={id} id={`pet-tab-${id}`} type="button" role="tab" aria-selected={activeTab === id} aria-controls="pet-active-panel" aria-disabled={locked} tabIndex={activeTab === id ? 0 : -1} className="pet-tab" data-testid={`pet-tab-${id}`} onClick={() => !locked && onChange(id)} onKeyDown={(event) => !locked && onKeyDown(event, index)} disabled={locked}><Icon size={17} /><span>{label}</span></button>; })}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon: Icon, testId }) {
  const safeValue = clampPercent(value);
  return (
    <div className="pet-stat-card" data-testid={testId}>
      <div className="pet-stat-top"><span><Icon size={14} />{label}</span><strong>{safeValue}%</strong></div>
      <div className="pet-progress" role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={safeValue}>
        <motion.span initial={false} animate={{ width: `${safeValue}%` }} style={{ "--pet-meter-color": color }} />
      </div>
    </div>
  );
}

function SurvivalCard({ pet, serverTime, onCare, busy }) {
  const serverNow = new Date(serverTime || "").getTime();
  const life = derivePetLifeView(pet, Number.isFinite(serverNow) ? serverNow : Date.now());
  const health = pet.stats?.health ?? 100;
  const cleanliness = pet.stats?.cleanliness ?? 85;
  const illness = pet.survival?.illness;
  const canClean = life.alive && Number(cleanliness) < 80;
  const canHeal = life.alive && (Boolean(illness) || Number(health) < 70);
  return (
    <section className={`pet-survival-card pet-survival-card--${life.tone}`} aria-labelledby="pet-survival-title" data-testid="pet-survival-card">
      <div className="pet-survival-heading">
        <span className="pet-survival-icon"><Heart size={20} /></span>
        <div><small>Життєвий стан</small><strong id="pet-survival-title">{life.label}</strong></div>
        <span className="pet-survival-status">{life.alive ? "Активний" : "Завершено"}</span>
      </div>
      <div className="pet-vitals">
        <StatCard label="Здоров’я" value={health} color="#ff5c72" icon={Heart} testId="pet-stat-health" />
        <StatCard label="Чистота" value={cleanliness} color="#00E7F5" icon={Waves} testId="pet-stat-cleanliness" />
      </div>
      {life.debuffs.length > 0 && <div className="pet-debuffs" aria-label="Активні стани">{life.debuffs.map((debuff) => <span key={debuff}><AlertCircle size={13} />{debuff}</span>)}</div>}
      {life.protectionLabel && <div className="pet-protection-note"><Home size={15} /><span>{life.protectionLabel}</span></div>}
      <p>{life.summary}</p>
      <div className="pet-consequence"><AlertCircle size={16} /><span>{life.riskLabel || life.consequence}</span></div>
      {life.alive && (canClean || canHeal) && <div className="pet-vital-actions">
        {canClean && <button type="button" onClick={() => onCare("clean", "default")} disabled={busy} data-testid="pet-care-clean"><Waves size={16} /> Прибрати</button>}
        {canHeal && <button type="button" onClick={() => onCare("heal", "default")} disabled={busy} data-testid="pet-care-heal"><Heart size={16} /> Лікувати</button>}
      </div>}
    </section>
  );
}

function PetLifeEndedCard({ life, onAdopt, busy }) {
  return (
    <section className="pet-life-ended-card" data-testid={`pet-life-${life.status}`}>
      <span><Cat size={28} /></span>
      <div><small>{life.status === "runaway" ? "Наслідок втрати довіри" : "Наслідок критичного стану"}</small><h2 className="font-display">{life.label}</h2><p>{life.summary} {life.consequence}</p></div>
      <button type="button" className="pet-primary-button" onClick={onAdopt} disabled={busy} data-testid="pet-adopt"><Heart size={18} /> Прихистити нового котика</button>
    </section>
  );
}

function SceneHotspot({ hotspot, active, disabled, onClick }) {
  const Icon = hotspot.icon;
  return (
    <motion.button type="button" className={`pet-hotspot ${hotspot.className} ${active ? "pet-hotspot--active" : ""}`} whileTap={disabled ? undefined : { scale: 0.9 }} onClick={() => onClick(hotspot.id)} aria-label={hotspot.label} disabled={disabled} data-hotspot={hotspot.id}>
      <Icon size={16} /><span>{hotspot.label}</span>
    </motion.button>
  );
}

function ResilientCatSprite({ pose, poses, collar, collarPoses, reducedMotion, onCollarError, collarFailed }) {
  const requestedPose = poses?.[pose]?.asset ? pose : "sit";
  const [displayedPose, setDisplayedPose] = useState(requestedPose);
  const [spriteFailed, setSpriteFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [poseRetryAttempt, setPoseRetryAttempt] = useState(0);
  const [spriteRetryAttempt, setSpriteRetryAttempt] = useState(0);
  const displayedConfig = poses?.[displayedPose] || poses?.sit || poses?.[requestedPose];

  useEffect(() => setPoseRetryAttempt(0), [requestedPose]);

  useEffect(() => {
    const requestedAsset = poses?.[requestedPose]?.asset;
    if (!requestedAsset || requestedPose === displayedPose) return undefined;
    let active = true;
    let retryTimer;
    const retry = () => {
      if (!active || poseRetryAttempt >= 3) return;
      retryTimer = window.setTimeout(() => setPoseRetryAttempt((current) => current + 1), 3_500);
    };
    const preloader = new Image();
    preloader.onload = () => {
      if (!active) return;
      if (!isUsablePetImage(preloader)) { retry(); return; }
      setDisplayedPose(requestedPose);
      setSpriteFailed(false);
      setSpriteRetryAttempt(0);
    };
    preloader.onerror = retry;
    preloader.src = requestedAsset;
    return () => { active = false; if (retryTimer) window.clearTimeout(retryTimer); };
  }, [displayedPose, poseRetryAttempt, poses, requestedPose]);

  useEffect(() => {
    if (!spriteFailed || !displayedConfig?.asset || spriteRetryAttempt >= 4) return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      const preloader = new Image();
      preloader.onload = () => {
        if (!active) return;
        if (!isUsablePetImage(preloader)) { setSpriteRetryAttempt((current) => current + 1); return; }
        setSpriteFailed(false);
        setSpriteRetryAttempt(0);
        setRetryToken((current) => current + 1);
      };
      preloader.onerror = () => active && setSpriteRetryAttempt((current) => current + 1);
      preloader.src = displayedConfig.asset;
    }, 3_500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [displayedConfig?.asset, retryToken, spriteFailed, spriteRetryAttempt]);

  useEffect(() => {
    const retryOnline = () => {
      setSpriteRetryAttempt(0);
      setPoseRetryAttempt(0);
      setRetryToken((current) => current + 1);
    };
    window.addEventListener("online", retryOnline);
    return () => window.removeEventListener("online", retryOnline);
  }, []);

  if (!displayedConfig) return <div className="pet-room-layer pet-room-cat pet-room-cat--fallback" style={roomLayerStyle({ x: 50, y: 74, width: 37, z_index: 40, anchor: "bottom" })}><Cat size={74} /></div>;
  const movement = reducedMotion ? { opacity: 1, y: 0 } : { opacity: 1, y: [0, -3, 0] };
  const transition = reducedMotion ? { duration: 0 } : { duration: 2.7, repeat: Infinity, ease: "easeInOut" };
  const collarPose = collarPoses?.[displayedPose] || collarPoses?.sit;
  return <>
    <div className={`pet-room-layer pet-room-cat ${spriteFailed ? "pet-room-cat--fallback" : ""}`} style={roomLayerStyle(displayedConfig)}>
      {!spriteFailed ? <motion.img key={`${displayedConfig.asset}-${retryToken}`} src={displayedConfig.asset} alt="" decoding="async" initial={false} animate={movement} transition={transition} onLoad={(event) => { if (!isUsablePetImage(event.currentTarget)) setSpriteFailed(true); }} onError={() => setSpriteFailed(true)} /> : <motion.span role="img" aria-label="Кіт" initial={false} animate={movement} transition={transition}><Cat size={74} /></motion.span>}
    </div>
    {collar?.room?.asset && collarPose && !collarFailed && <div className="pet-room-layer pet-room-collar" style={roomLayerStyle({ ...collarPose, z_index: collar.room.z_index, anchor: "center" }, collarPose.rotate)}><motion.img src={collar.room.asset} alt="" decoding="async" initial={false} animate={movement} transition={transition} onError={onCollarError} /></div>}
  </>;
}

function PetScene({
  snapshot, onHotspot, busy, reducedMotion, editing = false, roomLayout,
  selectedItemId, onSelectItem, onPlacementChange, onCancelEditing, narrativeReplay,
}) {
  const { pet, request, gift, daily_event: dailyEvent, story } = snapshot;
  const careActions = pet.daily?.care_actions || [];
  const [backgroundFailed, setBackgroundFailed] = useState(false);
  const [failedAssets, setFailedAssets] = useState(() => new Set());
  const [nowMs, setNowMs] = useState(Date.now());
  const [roomReaction, setRoomReaction] = useState("");
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const sceneRef = useRef(null);
  const dragRef = useRef(null);
  const dragFrameRef = useRef(null);
  const pendingDragRef = useRef(null);
  const room = snapshot.catalog?.room || {};
  const serverOffset = useMemo(() => {
    const serverAt = new Date(snapshot.server_time || "").getTime();
    return Number.isFinite(serverAt) ? serverAt - Date.now() : 0;
  }, [snapshot.server_time]);
  const sceneNowMs = nowMs + serverOffset;
  const life = derivePetLifeView(pet, sceneNowMs);
  const catPoses = room.appearances?.[pet.appearance_id]?.poses || {};
  const roomLayers = getRoomLayers(snapshot, editing ? roomLayout : undefined);
  const layers = roomLayers.filter((item) => !failedAssets.has(item.room.asset));
  const selectedItem = layers.find((item) => item.id === selectedItemId);
  const collar = (snapshot.catalog?.items || []).find((item) => item.slot === "collar" && pet.inventory?.equipped?.collar === item.id);
  const light = getKyivLight(sceneNowMs);
  const visibleSignature = [...roomLayers.map((item) => item.id), ...(collar ? [collar.id] : [])].sort().join("|");
  const previousVisible = useRef(visibleSignature);
  const markAssetFailed = (asset) => setFailedAssets((current) => new Set(current).add(asset));
  const narrativeResult = [pet.daily?.story_result, pet.daily?.event_result]
    .filter(Boolean)
    .sort((first, second) => new Date(second.resolved_at || 0).getTime() - new Date(first.resolved_at || 0).getTime())[0];
  const narrativeAt = new Date(narrativeResult?.resolved_at || "").getTime();
  const replayStartedAt = Number(narrativeReplay?.replay_started_at);
  const replayActive = Number.isFinite(replayStartedAt) && nowMs >= replayStartedAt && nowMs - replayStartedAt <= 12_000;
  const storedNarrativeActive = Number.isFinite(narrativeAt) && sceneNowMs >= narrativeAt && sceneNowMs - narrativeAt <= 12_000;
  const activeNarrative = replayActive ? narrativeReplay : storedNarrativeActive ? narrativeResult : null;
  const narrativeReaction = activeNarrative?.reaction_text || "";
  const narrativePose = ["sit", "sleep", "eat", "play"].includes(activeNarrative?.pose) ? activeNarrative.pose : null;
  const pose = narrativePose || derivePetPose(pet, sceneNowMs);
  const visibleReaction = narrativeReaction || roomReaction;

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (dragFrameRef.current) window.cancelAnimationFrame(dragFrameRef.current);
  }, []);

  useEffect(() => {
    setBackgroundFailed(false);
    setFailedAssets(new Set());
  }, [room.version]);

  useEffect(() => {
    const previous = new Set(previousVisible.current.split("|").filter(Boolean));
    const addedItemId = visibleSignature.split("|").find((itemId) => itemId && !previous.has(itemId));
    previousVisible.current = visibleSignature;
    if (!addedItemId) return undefined;
    setRoomReaction(ROOM_REACTIONS[addedItemId] || `${pet.name} розглядає обновку.`);
    const timer = window.setTimeout(() => setRoomReaction(""), 4_200);
    return () => window.clearTimeout(timer);
  }, [pet.name, visibleSignature]);

  const positionFromPointer = (event, drag) => {
    const width = Math.max(1, drag.sceneRect.width);
    const height = Math.max(1, drag.sceneRect.height);
    return snapRoomPlacement(
      drag.room,
      drag.start.x + ((event.clientX - drag.startClient.x) / width) * 100,
      drag.start.y + ((event.clientY - drag.startClient.y) / height) * 100,
    );
  };

  const queuePlacement = (itemId, position) => {
    pendingDragRef.current = { itemId, position };
    if (dragFrameRef.current) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const pending = pendingDragRef.current;
      pendingDragRef.current = null;
      if (pending) onPlacementChange?.(pending.itemId, pending.position);
    });
  };

  const startPointerDrag = (event, item) => {
    if (!editing || busy || event.button !== 0 || event.isPrimary === false) return;
    const sceneRect = sceneRef.current?.getBoundingClientRect();
    if (!sceneRect?.width || !sceneRect?.height) return;
    event.preventDefault();
    onSelectItem?.(item.id);
    dragRef.current = {
      pointerId: event.pointerId,
      itemId: item.id,
      itemName: item.name,
      room: item.room,
      sceneRect,
      start: { x: Number(item.room.x), y: Number(item.room.y) },
      startClient: { x: event.clientX, y: event.clientY },
    };
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch (_) { /* Pointer capture is best-effort on older WebViews. */ }
  };

  const movePointerDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    queuePlacement(drag.itemId, positionFromPointer(event, drag));
  };

  const finishPointerDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const position = positionFromPointer(event, drag);
    if (dragFrameRef.current) window.cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = null;
    pendingDragRef.current = null;
    onPlacementChange?.(drag.itemId, position);
    setMoveAnnouncement(`${drag.itemName}: X ${position.x}, Y ${position.y}`);
    dragRef.current = null;
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch (_) { /* Capture may already be released. */ }
  };

  const cancelPointerDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (dragFrameRef.current) window.cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = null;
    const pending = pendingDragRef.current;
    pendingDragRef.current = null;
    if (pending) onPlacementChange?.(pending.itemId, pending.position);
    dragRef.current = null;
  };

  const moveWithKeyboard = (event, item) => {
    const directions = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    if (event.key === "Escape") {
      event.preventDefault();
      onCancelEditing?.();
      return;
    }
    const direction = directions[event.key];
    if (!direction || busy) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : ROOM_GRID_PERCENT;
    const position = snapRoomPlacement(item.room, Number(item.room.x) + direction[0] * step, Number(item.room.y) + direction[1] * step);
    onSelectItem?.(item.id);
    onPlacementChange?.(item.id, position);
    setMoveAnnouncement(`${item.name}: X ${position.x}, Y ${position.y}`);
  };

  return (
    <div className="pet-scene-wrap" data-testid="pet-scene">
      <div ref={sceneRef} className={`pet-scene ${editing ? "pet-scene--editing" : ""}`} data-mood={pet.stats?.energy < 35 ? "sleepy" : "happy"} data-condition={life.condition} data-status={life.status} data-pose={pose} data-light={light} role="region" aria-label={editing ? `Редагування кімнати ${pet.name}` : `${pet.name} у своїй кімнаті`}>
        <div className="pet-scene-art" aria-hidden={editing ? undefined : "true"}>
          {!backgroundFailed && room.background_asset && <img src={room.background_asset} alt="" className="pet-scene-background" width="1024" height="1024" decoding="async" fetchPriority="high" onLoad={(event) => { if (event.currentTarget.naturalWidth <= 1) setBackgroundFailed(true); }} onError={() => setBackgroundFailed(true)} data-testid="pet-scene-image" />}
          {layers.map((item) => <div key={item.id} className={`pet-room-layer pet-room-layer--${item.slot} ${editing ? "pet-room-layer--editable" : ""} ${selectedItemId === item.id ? "pet-room-layer--selected" : ""}`} style={roomLayerStyle(item.room)} data-room-item={item.id}><motion.img src={item.room.asset} alt="" draggable="false" decoding="async" initial={editing || reducedMotion ? false : { opacity: 0, scale: .82, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={editing ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 22 }} onError={() => markAssetFailed(item.room.asset)} />{editing && <button type="button" className="pet-room-drag-handle" aria-label={`Перемістити «${item.name}». X ${item.room.x}, Y ${item.room.y}`} aria-describedby="pet-room-edit-help" aria-pressed={selectedItemId === item.id} disabled={busy} onClick={() => onSelectItem?.(item.id)} onFocus={() => onSelectItem?.(item.id)} onKeyDown={(event) => moveWithKeyboard(event, item)} onPointerDown={(event) => startPointerDrag(event, item)} onPointerMove={movePointerDrag} onPointerUp={finishPointerDrag} onPointerCancel={cancelPointerDrag} onLostPointerCapture={cancelPointerDrag} data-testid={`pet-room-drag-${item.id}`}><span>{item.name}</span></button>}</div>)}
          {pose !== "away" && <ResilientCatSprite pose={pose} poses={catPoses} collar={collar} collarPoses={room.collar_poses} reducedMotion={reducedMotion} collarFailed={Boolean(collar?.room?.asset && failedAssets.has(collar.room.asset))} onCollarError={() => collar?.room?.asset && markAssetFailed(collar.room.asset)} />}
        </div>
        {backgroundFailed && <div className="pet-scene-fallback" role="img" aria-label={`${pet.name} у своїй кімнаті`}><Cat size={74} /><span>Фон кімнати завантажиться після відновлення мережі</span></div>}
        <div className="pet-scene-lighting" aria-hidden="true" />
        <div className="pet-scene-vignette" aria-hidden="true" />
        {editing && <div className="pet-room-edit-grid" aria-hidden="true" />}
        {editing && <div id="pet-room-edit-help" className="pet-room-edit-instruction"><Crosshair size={15} /><span>{selectedItem ? `Рухаємо: ${selectedItem.name}` : "Оберіть і перетягніть предмет"}</span></div>}
        {!editing && life.alive && !reducedMotion && <div className="pet-scene-sparkles" aria-hidden="true"><i /><i /><i /></div>}
        {!editing && life.alive && <AnimatePresence>{visibleReaction && pose !== "away" && <motion.div key={visibleReaction} className="pet-scene-reaction" initial={reducedMotion ? false : { opacity: 0, y: 8, scale: .92 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5 }} role="status">{visibleReaction}</motion.div>}</AnimatePresence>}
        {!editing && life.alive && life.debuffs[0] && <div className={`pet-scene-debuff pet-scene-debuff--${life.tone}`} role="status"><AlertCircle size={14} />{life.debuffs[0]}</div>}
        {!editing && !life.alive && <div className="pet-scene-ended" role="status"><span><Cat size={34} /></span><strong>{life.label}</strong><small>Кімната збережена</small></div>}
        {!editing && <div className="pet-scene-topline"><span><span className="pet-live-dot" /> {!life.alive ? "Кімната порожня" : pose === "away" ? "В експедиції" : pose === "sleep" ? "Дрімає" : pose === "eat" ? "Смакує" : pose === "play" ? "Грається" : "У кімнаті"}</span><span>{life.alive ? `${light === "evening" ? "Вечір" : "День"} · довіра ${Math.min(10, pet.trust || 0)}/10` : "Історія завершена"}</span></div>}
        {!editing && life.alive && <div className="pet-hotspot-row" role="group" aria-label="Дії в кімнаті">{HOTSPOTS.map((hotspot) => <SceneHotspot key={hotspot.id} hotspot={hotspot} active={request?.hotspot === hotspot.id || story?.current_scene?.hotspot === hotspot.id || dailyEvent?.hotspot === hotspot.id || (hotspot.id === "gift" && gift?.available)} disabled={busy} onClick={onHotspot} />)}</div>}
        <div className="pet-sr-status" role="status" aria-live="polite">{moveAnnouncement}</div>
      </div>
      {!editing && <div className={`pet-scene-caption ${!life.alive ? "pet-scene-caption--ended" : ""}`}>
        <div className="pet-scene-avatar"><Cat size={20} /></div>
        <div className="pet-scene-caption-copy"><span>{life.alive ? `Що хоче ${pet.name}` : "Стан кімнати"}</span><strong>{life.alive ? request?.title || "Провести час разом" : life.label}</strong></div>
        {life.alive && <ChevronRight size={18} />}
      </div>}
      <div className="pet-scene-hint">{editing ? "Перетягуйте предмети або використовуйте стрілки" : life.alive ? "Торкайтеся підсвічених предметів" : "Колекція предметів лишилася з вами"}<span>{editing ? `Сітка ${ROOM_GRID_PERCENT}%` : life.alive ? `${careActions.length} дій турботи сьогодні` : "Без активних дій"}</span></div>
    </div>
  );
}

function RitualCard({ snapshot, onClaim, busy }) {
  const { gift, pet } = snapshot;
  const progress = gift?.ritual_progress || 0;
  const adoptionDay = Boolean(pet.daily?.adoption_day);
  const claimed = Boolean(gift?.claimed) && !adoptionDay;
  return (
    <div className={`pet-ritual-card ${gift?.available ? "pet-ritual-card--ready" : ""} ${(claimed || adoptionDay) ? "pet-ritual-card--claimed" : ""}`} data-testid="pet-ritual-progress">
      <div className="pet-card-heading"><div className="pet-card-icon"><Gift size={20} /></div><div><span>Денний ритуал</span><strong>{adoptionDay ? "Новий початок" : claimed ? "Подарунок отримано" : gift?.available ? `${pet.name} щось знайшов!` : `${progress}/2 різні дії`}</strong></div></div>
      {adoptionDay ? <div className="pet-ritual-complete" role="status"><span><Clock3 size={18} /></span><div><strong>Нагороди доступні завтра</strong><small>Сьогодні познайомтеся з новим котиком без повторного фарму</small></div></div> : claimed ? <div className="pet-ritual-complete" role="status"><span><Check size={18} /></span><div><strong>Завершено на сьогодні</strong><small>Новий ритуал і сюрприз з’являться завтра</small></div></div> : <>
        <div className="pet-ritual-steps" aria-label={`Ритуал виконано на ${progress} з 2`}>{[0, 1].map((step) => <span key={step} className={progress > step ? "done" : ""}><Check size={13} /></span>)}<div><i style={{ width: `${Math.min(100, progress * 50)}%` }} /></div></div>
        {gift?.available && <button type="button" className="pet-primary-button pet-primary-button--gift" onClick={onClaim} disabled={busy} data-testid="pet-reward-claim"><Gift size={18} /> Відкрити подарунок</button>}
        {!gift?.available && <p>Заповнюйте довіру різними діями. Шанс на Point перевіряється лише один раз на день.</p>}
      </>}
    </div>
  );
}

function ExpeditionStatus({ expedition, petName, serverTime, onClaim, busy }) {
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    if (!expedition || expedition.status !== "active") return undefined;
    const serverAt = new Date(serverTime).getTime();
    const serverOffset = Number.isFinite(serverAt) ? serverAt - Date.now() : 0;
    setNowMs(Date.now() + serverOffset);
    const timer = window.setInterval(() => setNowMs(Date.now() + serverOffset), 30_000);
    return () => window.clearInterval(timer);
  }, [expedition, serverTime]);
  if (!expedition) return null;
  const ready = expedition.status === "ready" || new Date(expedition.ends_at).getTime() <= nowMs;
  if (expedition.status === "claimed") return <div className="pet-expedition-status pet-expedition-status--done"><Check size={18} /><div><span>Експедиція завершена</span><strong>{expedition.location_name}</strong></div></div>;
  return (
    <div className={`pet-expedition-status ${ready ? "pet-expedition-status--ready" : ""}`}>
      <div className="pet-expedition-orbit"><MapPinned size={20} /></div><div className="pet-expedition-copy"><span>{ready ? `${petName} повернувся` : `Експедиція · ${expedition.location_name}`}</span><strong>{ready ? "Знахідки готові" : formatRemaining(expedition.ends_at, nowMs)}</strong></div>
      {ready && <button type="button" onClick={onClaim} disabled={busy}>Забрати</button>}
    </div>
  );
}

function FocusCard({ snapshot, onIntent, onOpenActivity, onClaimExpedition, busy }) {
  const daily = snapshot.pet.daily || {};
  const project = snapshot.pet.weekly_project || {};
  const hasOpenExpedition = ["active", "ready"].includes(snapshot.pet.expedition?.status);
  return (
    <div className="pet-focus-card" data-testid="pet-focus-card">
      <div className="pet-section-title"><div><span>Один важливий вибір</span><h2 className="font-display">ФОКУС ДНЯ</h2></div><span className={`pet-focus-badge ${daily.focus_used ? "used" : ""}`}>{daily.focus_used ? "Використано" : "1 доступний"}</span></div>
      <p className="pet-section-description">Напрям впливає на характер, історії та колекцію — але не збільшує шанс цінного призу.</p>
      <div className="pet-intents" role="group" aria-label="Намір дня">
        {INTENTS.map(({ id, label, icon: Icon, color }) => <button key={id} type="button" aria-pressed={daily.intent === id} className={`pet-intent pet-intent--${color} ${daily.intent === id ? "selected" : ""}`} onClick={() => onIntent(id)} disabled={busy || daily.focus_used} data-testid={`pet-focus-${id}`}><Icon size={20} /><span>{label}</span>{daily.intent === id && <Check size={13} />}</button>)}
      </div>
      <ExpeditionStatus expedition={snapshot.pet.expedition} petName={snapshot.pet.name} serverTime={snapshot.server_time} onClaim={onClaimExpedition} busy={busy} />
      {!daily.focus_used && !hasOpenExpedition && <div className="pet-activity-grid">
        <button type="button" onClick={() => onOpenActivity("expedition")} disabled={busy}><MapPinned size={22} /><span>Експедиція</span><small>2–8 годин</small></button>
        <button type="button" onClick={() => onOpenActivity("training")} disabled={busy}><PawPrint size={22} /><span>Новий трюк</span><small>+майстерність</small></button>
        <button type="button" onClick={() => onOpenActivity("project")} disabled={busy}><Package size={22} /><span>Проєкт</span><small>1 етап</small></button>
      </div>}
      <div className="pet-project-row"><div className="pet-project-icon"><Package size={22} /></div><div className="pet-project-copy"><span>Тижневий проєкт</span><strong>{project.name || "Картонна фортеця"}</strong><div className="pet-project-progress"><i style={{ width: `${Math.min(100, ((project.progress || 0) / (project.goal || 3)) * 100)}%` }} /></div></div><b>{project.progress || 0}/{project.goal || 3}</b></div>
    </div>
  );
}

function ImpactChips({ items = [], compact = false }) {
  if (!items.length) return null;
  return <div className={`pet-impact-chips ${compact ? "pet-impact-chips--compact" : ""}`} role="list" aria-label="Наслідки вибору">{items.map((item, index) => {
    const label = typeof item === "string" ? item : item?.label;
    const tone = typeof item === "string" ? "story" : item?.tone || "story";
    return label ? <span key={`${label}-${index}`} role="listitem" className={`pet-impact-chip pet-impact-chip--${tone}`}>{label}</span> : null;
  })}</div>;
}

function StoryArcCard({ story, onOpen, busy }) {
  if (!story) return null;
  const scene = story.current_scene;
  const result = story.resolved_today;
  const total = Math.max(1, Number(story.total_chapters) || 3);
  const completed = Math.max(0, Number(story.completed_count) || 0);
  const statusLabel = ({ available: "Новий розділ", waiting: "Продовження завтра", locked: "Потрібна умова", completed: "Історію завершено", ended: "Історію завершено" })[story.status]
    || (result ? "Вибір зроблено сьогодні" : scene ? "Новий розділ" : "Наступний розділ");
  return <section className={`pet-story-card pet-story-card--${story.status || "waiting"}`} data-testid="pet-story-card">
    <div className="pet-story-heading"><div className="pet-story-icon"><BookOpen size={21} /></div><div><span>Особистий сюжет · {completed}/{total}</span><strong>{story.title || "Нічна пошта"}</strong></div><span className="pet-story-status">{statusLabel}</span></div>
    <div className="pet-story-progress" role="progressbar" aria-label="Прогрес сюжету" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.max(0, Math.min(100, Number(story.progress) || 0))}><i style={{ width: `${Math.max(0, Math.min(100, Number(story.progress) || 0))}%` }} /></div>
    {scene ? <><div className="pet-story-chapter"><small>Розділ {scene.chapter}</small><h2 className="font-display">{scene.title}</h2><p>{scene.text}</p></div><button type="button" className="pet-story-open" onClick={onOpen} disabled={busy}><Sparkles size={17} /> Зробити важливий вибір <ChevronRight size={17} /></button></> : <div className="pet-story-wait"><span>{result?.title || story.badge || story.personality?.label}</span><p>{result?.next_hint || story.next_hint}</p>{result?.impact?.length ? <ImpactChips items={result.impact} compact /> : null}</div>}
    <div className="pet-personality-row"><PawPrint size={15} /><span>{story.personality?.formed ? "Характер" : "Характер формується"}</span><strong>{story.personality?.label || "Ваш напарник"}</strong></div>
  </section>;
}

function NarrativeResultCard({ result }) {
  if (!result) return null;
  return <section className="pet-narrative-result" data-testid="pet-event-result"><div className="pet-narrative-result-icon"><Check size={18} /></div><div><span>Наслідок вашого вибору</span><strong>{result.title}</strong><p>{result.text}</p><ImpactChips items={result.impact || []} compact /></div></section>;
}

function DailyEventCard({ event, onOpen }) {
  if (!event) return null;
  return <button type="button" className="pet-event-card" onClick={onOpen} data-testid="pet-daily-event"><div className="pet-event-glow"><Sparkles size={21} /></div><div><span>Випадкова подія · {event.choices?.length || 0} варіанти</span><strong>{event.title}</strong><p>{event.text}</p></div><ChevronRight size={19} /></button>;
}

function RoomPanel({ snapshot, perform, busy, setSheet, setReward, reducedMotion, narrativeReplay }) {
  const { pet, request, daily_event: dailyEvent, story } = snapshot;
  const storyScene = story?.current_scene;
  const life = derivePetLifeView(pet, new Date(snapshot.server_time || "").getTime() || Date.now());
  const [roomEdit, setRoomEdit] = useState(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const editingRoom = Boolean(roomEdit);
  const roomEditBusy = busy || savingLayout;
  const defaultRoomDraft = roomDraftFromSnapshot({ ...snapshot, pet: { ...snapshot.pet, room_layout: {} } });
  const currentRoomSignature = roomLayoutSignature(roomEdit?.draft);
  const roomEditDirty = editingRoom && currentRoomSignature !== roomEdit.initialSignature;
  const differsFromDefault = editingRoom && currentRoomSignature !== roomLayoutSignature(defaultRoomDraft);
  const selectedRoomItem = getRoomLayers(snapshot, editingRoom ? roomEdit.draft : undefined).find((item) => item.id === roomEdit?.selectedItemId);

  useEffect(() => {
    if (!life.alive) setRoomEdit(null);
  }, [life.alive]);

  const beginRoomEdit = () => {
    const draft = roomDraftFromSnapshot(snapshot);
    setRoomEdit({
      draft,
      initialSignature: roomLayoutSignature(draft),
      selectedItemId: Object.keys(draft)[0] || null,
    });
  };

  const cancelRoomEdit = () => {
    if (!savingLayout) setRoomEdit(null);
  };

  const updateRoomPlacement = (itemId, position) => {
    setRoomEdit((current) => current ? {
      ...current,
      selectedItemId: itemId,
      draft: { ...current.draft, [itemId]: position },
    } : current);
  };

  const resetRoomDraft = () => {
    setRoomEdit((current) => current ? { ...current, draft: defaultRoomDraft } : current);
  };

  const saveRoomLayout = async () => {
    if (!roomEdit || !roomEditDirty || roomEditBusy) return;
    const placements = getRoomLayers(snapshot, roomEdit.draft).map((item) => ({
      item_id: item.id,
      x: Number(item.room.x),
      y: Number(item.room.y),
    }));
    setSavingLayout(true);
    try {
      const result = await perform({ method: "patch", url: "/pet/room/layout", body: { placements } });
      if (!result) return;
      setRoomEdit(null);
      toast.success("Розташування предметів збережено");
    } finally {
      setSavingLayout(false);
    }
  };

  const care = async (action, option) => {
    const result = await perform({ url: "/pet/care", body: { action, option }, idempotent: true });
    if (!result) return;
    const rejected = result.accepted === false || result.rejected || result.outcome === "rejected" || Number(result.trust_gained) < 0;
    const message = result.message || (result.combo ? `Комбо: ${result.combo}` : result.idempotent ? "Цю дію вже зараховано" : `+${result.trust_gained || 1} довіри`);
    if (rejected) toast.warning(message); else toast.success(message);
    setSheet(null);
  };
  const adopt = async () => {
    const result = await perform({ url: "/pet/adopt", body: {}, idempotent: true });
    if (result) toast.success(result.message || "Новий котик уже знайомиться з кімнатою");
  };
  const claimGift = async () => {
    const result = await perform({ url: "/pet/gift/claim", body: {}, idempotent: true });
    if (!result) return;
    setReward(result.reward || result.gift?.reward); setSheet("reward");
  };
  const claimExpedition = async () => {
    if (!pet.expedition?.id) return;
    const result = await perform({ url: `/pet/expeditions/${pet.expedition.id}/claim`, body: {} });
    if (result) toast.success(result.message || "Знахідки вже в колекції");
  };
  const handleHotspot = (id) => {
    if (storyScene?.hotspot === id) return setSheet("story");
    if (dailyEvent?.hotspot === id) return setSheet("event");
    if (id === "cat" && request?.id === "photo") return perform({ url: "/pet/photo", body: {} }).then((result) => result && toast.success(result.message));
    if (id === "cat" && request?.id === "heal") return care("heal", "default");
    if (id === "cat") return care("pet", "default");
    if (id === "bowl" && request?.id === "clean") return care("clean", "default");
    if (id === "bowl") return setSheet("feed");
    if (id === "toy") return setSheet("play");
    if (id === "bed") return care("rest", "default");
    if (id === "window") return toast.info("За вікном сьогодні тихо");
    if (id === "shelf") return setSheet("collection-shortcut");
    if (id === "gift") return snapshot.gift?.available ? claimGift() : toast.info(`Довіра ${Math.min(10, pet.trust || 0)}/10 · виконайте 2 різні дії`);
    return undefined;
  };
  const handleRequest = () => {
    if (request?.id === "feed") setSheet("feed");
    else if (request?.id === "play") setSheet("play");
    else if (request?.id === "rest") care("rest", "default");
    else if (request?.id === "pet") care("pet", "default");
    else if (request?.id === "clean") care("clean", "default");
    else if (request?.id === "heal") care("heal", "default");
    else perform({ url: "/pet/photo", body: {} }).then((result) => result && toast.success(result.message));
  };
  return <div className="pet-panel" data-testid="pet-panel-room">
    <PetScene snapshot={snapshot} onHotspot={handleHotspot} busy={roomEditBusy} reducedMotion={reducedMotion} editing={editingRoom} roomLayout={roomEdit?.draft} selectedItemId={roomEdit?.selectedItemId} onSelectItem={(itemId) => setRoomEdit((current) => current ? { ...current, selectedItemId: itemId } : current)} onPlacementChange={updateRoomPlacement} onCancelEditing={cancelRoomEdit} narrativeReplay={narrativeReplay} />
    {life.alive && (!editingRoom ? <button type="button" className="pet-room-edit-start" onClick={beginRoomEdit} disabled={busy} data-testid="pet-room-edit-start"><Edit3 size={17} /> Редагувати кімнату</button> : <section className="pet-room-edit-toolbar" aria-label="Редагування розташування предметів" data-testid="pet-room-edit-toolbar"><div className="pet-room-edit-copy"><span>Режим редагування</span><strong>{selectedRoomItem ? selectedRoomItem.name : "Оберіть предмет"}</strong><small>Стрілки — 2%, Shift + стрілка — 10%</small></div><div className="pet-room-edit-actions"><button type="button" onClick={resetRoomDraft} disabled={roomEditBusy || !differsFromDefault} data-testid="pet-room-edit-default"><RotateCcw size={16} /> За замовчуванням</button><button type="button" onClick={cancelRoomEdit} disabled={savingLayout} data-testid="pet-room-edit-cancel"><X size={16} /> Скасувати</button><button type="button" className="primary" onClick={saveRoomLayout} disabled={roomEditBusy || !roomEditDirty} data-testid="pet-room-edit-save">{savingLayout ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Зберегти</button></div></section>)}
    <div className="pet-stats" aria-label={`Стан ${pet.name}`}><StatCard label="Ситість" value={pet.stats?.satiety} color="#FFB800" icon={Utensils} testId="pet-stat-hunger" /><StatCard label="Настрій" value={pet.stats?.mood} color="#39FF14" icon={Heart} testId="pet-stat-mood" /><StatCard label="Енергія" value={pet.stats?.energy} color="#00F0FF" icon={Sparkles} testId="pet-stat-energy" /></div>
    <SurvivalCard pet={pet} serverTime={snapshot.server_time} onCare={care} busy={busy} />
    {!life.alive ? <PetLifeEndedCard life={life} onAdopt={adopt} busy={busy} /> : <>
      <button type="button" className="pet-request-card" onClick={handleRequest} disabled={busy}><span className="pet-request-icon"><PawPrint size={22} /></span><span><small>Актуальне бажання</small><strong>{request?.title || "Провести час разом"}</strong></span><b>{request?.action || "Дія"}<ChevronRight size={16} /></b></button>
      <StoryArcCard story={story} onOpen={() => setSheet("story")} busy={busy} />
      <DailyEventCard event={dailyEvent} onOpen={() => setSheet("event")} />
      <NarrativeResultCard result={pet.daily?.event_result} />
      <RitualCard snapshot={snapshot} onClaim={claimGift} busy={busy} />
      <FocusCard snapshot={snapshot} onIntent={(intent) => perform({ url: "/pet/intent", body: { intent } }).then((result) => result && toast.success(result.message))} onOpenActivity={setSheet} onClaimExpedition={claimExpedition} busy={busy} />
    </>}
  </div>;
}

function LegacySequenceMiniGame({ session, onFinish, onClose, busy, reducedMotion }) {
  const [phase, setPhase] = useState("preview");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [moves, setMoves] = useState([]);
  const sequence = session.sequence || [];
  useEffect(() => {
    if (phase !== "preview") return undefined;
    if (reducedMotion) return undefined;
    const timer = window.setInterval(() => setPreviewIndex((current) => { if (current >= sequence.length - 1) { window.clearInterval(timer); window.setTimeout(() => setPhase("input"), 550); return current; } return current + 1; }), 720);
    return () => window.clearInterval(timer);
  }, [phase, reducedMotion, sequence.length]);
  const submit = async (nextMoves) => {
    setPhase("submitting");
    const succeeded = await onFinish(nextMoves);
    if (!succeeded) setPhase("error");
  };
  const choose = (value) => {
    if (phase !== "input" || busy) return;
    const next = [...moves, value];
    setMoves(next);
    if (next.length === sequence.length) void submit(next);
  };
  const instruction = phase === "preview" ? "Запам'ятовуйте" : phase === "error" ? "Результат не надіслано" : phase === "submitting" ? "Перевіряємо" : "Повторіть маршрут";
  return <div className="pet-minigame" data-testid="pet-game-active"><div className="pet-minigame-top"><div><span>{session.game_id === "memory" ? "Лапки-пам'ятки" : "Спіймай промінчик"}</span><strong>{instruction}</strong></div><button type="button" onClick={onClose} disabled={phase === "submitting"} aria-label="Закрити гру"><X size={18} /></button></div><div className="pet-game-orb"><Cat size={52} /></div><p>{phase === "preview" ? "Стежте за підсвіченими лапками" : `${moves.length}/${sequence.length} кроків`}</p>{reducedMotion && phase === "preview" && <div className="pet-static-sequence" aria-label={`Послідовність: ${sequence.map((value) => value + 1).join(", ")}`}>{sequence.map((value, index) => <span key={`${index}-${value}`} style={{ "--pad-color": GAME_COLORS[value] }}>{value + 1}</span>)}<button type="button" onClick={() => setPhase("input")}>Я запам'ятав</button></div>}<div className="pet-game-pads">{[0,1,2,3].map((value) => { const highlighted = phase === "preview" && sequence[previewIndex] === value; return <motion.button key={value} type="button" style={{ "--pad-color": GAME_COLORS[value] }} className={highlighted ? "active" : ""} animate={highlighted && !reducedMotion ? { scale: [1,1.08,1] } : undefined} onClick={() => choose(value)} disabled={phase !== "input" || busy} aria-label={`Лапка ${value + 1}`}><PawPrint size={30} /></motion.button>; })}</div>{(busy || phase === "submitting") && <div className="pet-game-saving"><LoaderCircle className="spin" size={18} /> Перевіряємо результат…</div>}{phase === "error" && <button type="button" className="pet-game-retry" onClick={() => void submit(moves)} disabled={busy} data-testid="pet-game-finish-retry"><RotateCcw size={17} /> Надіслати результат ще раз</button>}</div>;
}

function useVerifiedGameSubmit(onFinish, minDurationMs, maxDurationMs) {
  const startedAtRef = useRef(Date.now());
  const onFinishRef = useRef(onFinish);
  const payloadRef = useRef(null);
  const timerRef = useRef(null);
  const lockedRef = useRef(false);
  const mountedRef = useRef(true);
  const [status, setStatus] = useState("idle");
  onFinishRef.current = onFinish;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const execute = async () => {
    if (!payloadRef.current) return;
    setStatus("submitting");
    const elapsedMs = Date.now() - startedAtRef.current;
    const succeeded = await onFinishRef.current(withClientDuration(payloadRef.current, elapsedMs, minDurationMs, maxDurationMs));
    if (!mountedRef.current) return;
    if (!succeeded) {
      lockedRef.current = false;
      setStatus("error");
    }
  };

  const submit = (payload) => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    payloadRef.current = payload;
    const waitMs = Math.max(0, Number(minDurationMs || 0) - (Date.now() - startedAtRef.current) + 300);
    if (waitMs > 0) {
      setStatus("waiting");
      timerRef.current = window.setTimeout(() => void execute(), waitMs);
    } else {
      void execute();
    }
  };

  const retry = () => {
    if (lockedRef.current || !payloadRef.current) return;
    lockedRef.current = true;
    void execute();
  };

  return { status, submit, retry };
}

function MiniGameFrame({ title, instruction, onClose, locked, children }) {
  return <div className="pet-minigame" data-testid="pet-game-active"><div className="pet-minigame-top"><div><span>{title}</span><strong>{instruction}</strong></div><button type="button" onClick={onClose} disabled={locked} aria-label="Закрити гру"><X size={18} /></button></div>{children}</div>;
}

function GameSubmissionStatus({ status, onRetry, busy }) {
  if (status === "idle") return null;
  if (status === "error") return <button type="button" className="pet-game-retry" onClick={onRetry} disabled={busy} data-testid="pet-game-finish-retry"><RotateCcw size={17} /> Надіслати результат ще раз</button>;
  return <div className="pet-game-saving" role="status"><LoaderCircle className="spin" size={18} /> {status === "waiting" ? "Завершуємо чесний час гри…" : "Сервер перевіряє результат…"}</div>;
}

function MemoryMiniGame({ challenge, onFinish, onClose, busy, reducedMotion }) {
  const [phase, setPhase] = useState("preview");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [moves, setMoves] = useState([]);
  const submission = useVerifiedGameSubmit(onFinish, challenge.minDurationMs, challenge.durationMs);

  useEffect(() => {
    if (phase !== "preview" || reducedMotion || !challenge.cues.length) return undefined;
    let active = true;
    let timer;
    let index = 0;
    const pulse = () => {
      if (!active) return;
      setPreviewIndex(index);
      setPreviewVisible(true);
      timer = window.setTimeout(() => {
        if (!active) return;
        setPreviewVisible(false);
        index += 1;
        if (index >= challenge.cues.length) timer = window.setTimeout(() => setPhase("input"), Math.max(180, challenge.cueMs * .45));
        else timer = window.setTimeout(pulse, Math.max(120, challenge.cueMs * .3));
      }, Math.max(180, challenge.cueMs * .7));
    };
    pulse();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [challenge, phase, reducedMotion]);

  const choose = (value) => {
    if (phase !== "input" || busy || submission.status !== "idle") return;
    const next = [...moves, value];
    setMoves(next);
    if (next.length >= challenge.cues.length) {
      setPhase("complete");
      submission.submit(memoryFinishPayload(next));
    }
  };
  const locked = busy || ["waiting", "submitting"].includes(submission.status);
  const instruction = phase === "preview" ? "Запам’ятовуйте" : phase === "input" ? "Повторіть послідовність" : "Послідовність прийнято";
  return <MiniGameFrame title="Лапки-пам’ятки" instruction={instruction} onClose={onClose} locked={locked}>
    <div className="pet-game-orb"><Brain size={50} /></div>
    <p>{phase === "preview" ? "Стежте за кольоровими лапками" : `${Math.min(moves.length, challenge.cues.length)}/${challenge.cues.length} кроків`}</p>
    {reducedMotion && phase === "preview" && <div className="pet-static-sequence" aria-label={`Послідовність: ${challenge.cues.map((value) => value + 1).join(", ")}`}>{challenge.cues.map((value, index) => <span key={`${index}-${value}`} style={{ "--pad-color": GAME_COLORS[value] }}>{value + 1}</span>)}<button type="button" onClick={() => setPhase("input")}>Я запам’ятав</button></div>}
    <div className="pet-game-pads">{Array.from({ length: Math.min(4, challenge.paletteSize) }, (_, value) => { const highlighted = phase === "preview" && previewVisible && challenge.cues[previewIndex] === value; return <motion.button key={value} type="button" style={{ "--pad-color": GAME_COLORS[value] }} className={highlighted ? "active" : ""} animate={highlighted && !reducedMotion ? { scale: [1,1.08,1] } : undefined} onClick={() => choose(value)} disabled={phase !== "input" || locked} aria-label={`Лапка ${value + 1}`}><PawPrint size={30} /></motion.button>; })}</div>
    <GameSubmissionStatus status={submission.status} onRetry={submission.retry} busy={busy} />
  </MiniGameFrame>;
}

function LaserMiniGame({ challenge, onFinish, onClose, busy, reducedMotion }) {
  const submission = useVerifiedGameSubmit(onFinish, challenge.minDurationMs, challenge.durationMs);
  const gameStartedAtRef = useRef(Date.now());
  const eventsRef = useRef([]);
  const caughtRef = useRef(new Set());
  const finishedRef = useRef(false);
  const submitRef = useRef(submission.submit);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [caughtIds, setCaughtIds] = useState(() => new Set());
  submitRef.current = submission.submit;

  useEffect(() => {
    const tick = () => {
      const elapsed = Date.now() - gameStartedAtRef.current;
      setElapsedMs(Math.min(challenge.durationMs, elapsed));
      if (elapsed >= challenge.durationMs && !finishedRef.current) {
        finishedRef.current = true;
        submitRef.current(eventFinishPayload(eventsRef.current));
      }
    };
    tick();
    const timer = window.setInterval(tick, 50);
    return () => window.clearInterval(timer);
  }, [challenge.durationMs]);

  const catchTarget = (target) => {
    if (finishedRef.current || busy || caughtRef.current.has(target.id)) return;
    const atMs = Math.max(0, Date.now() - gameStartedAtRef.current);
    caughtRef.current.add(target.id);
    eventsRef.current = [...eventsRef.current, { target_id: target.id, at_ms: atMs, lane: target.lane }];
    setCaughtIds((current) => new Set(current).add(target.id));
  };
  const activeTargets = activeLaserTargets(challenge.targets, elapsedMs, caughtIds);
  const remainingSeconds = Math.max(0, Math.ceil((challenge.durationMs - elapsedMs) / 1_000));
  const locked = busy || ["waiting", "submitting"].includes(submission.status);
  return <MiniGameFrame title="Спіймай промінчик" instruction={finishedRef.current ? "Раунд завершено" : `${remainingSeconds} сек · ${caughtIds.size}/${challenge.targets.length}`} onClose={onClose} locked={locked}>
    <div className="pet-laser-progress" aria-hidden="true"><i style={{ width: `${Math.min(100, elapsedMs / challenge.durationMs * 100)}%` }} /></div>
    <div className="pet-laser-board" data-testid="pet-laser-board" aria-label="Поле лазерних цілей">
      {Array.from({ length: challenge.lanes }, (_, lane) => <span key={lane} className="pet-laser-lane" style={{ left: `${lane / challenge.lanes * 100}%`, width: `${100 / challenge.lanes}%` }} />)}
      {activeTargets.map((target) => <button key={target.id} type="button" className="pet-laser-target" style={laserTargetPosition(target, challenge.lanes)} onClick={() => catchTarget(target)} disabled={locked} aria-label={`Спіймати промінчик у смузі ${target.lane + 1}`} data-testid={`pet-laser-target-${target.id}`}><motion.span initial={reducedMotion ? false : { scale:.55 }} animate={{ scale:1 }}><Crosshair size={29} /></motion.span></button>)}
      {!activeTargets.length && !finishedRef.current && <div className="pet-laser-wait"><Cat size={30} /><span>Шукай світлову цятку</span></div>}
    </div>
    <div className="pet-sr-status" role="status" aria-live="polite">{activeTargets.length ? `З’явилася ціль у смузі ${activeTargets[0].lane + 1}` : ""}</div>
    <GameSubmissionStatus status={submission.status} onRetry={submission.retry} busy={busy} />
  </MiniGameFrame>;
}

function SortingMiniGame({ challenge, onFinish, onClose, busy, reducedMotion }) {
  const submission = useVerifiedGameSubmit(onFinish, challenge.minDurationMs, challenge.durationMs);
  const gameStartedAtRef = useRef(Date.now());
  const eventsRef = useRef([]);
  const cardIndexRef = useRef(0);
  const finishedRef = useRef(false);
  const submitRef = useRef(submission.submit);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [cardIndex, setCardIndex] = useState(0);
  submitRef.current = submission.submit;

  useEffect(() => {
    const tick = () => {
      const elapsed = Date.now() - gameStartedAtRef.current;
      setElapsedMs(Math.min(challenge.durationMs, elapsed));
      if (elapsed >= challenge.durationMs && !finishedRef.current) {
        finishedRef.current = true;
        submitRef.current(eventFinishPayload(eventsRef.current));
      }
    };
    const timer = window.setInterval(tick, 200);
    return () => window.clearInterval(timer);
  }, [challenge.durationMs]);

  const chooseLane = (lane) => {
    const currentIndex = cardIndexRef.current;
    const card = challenge.cards[currentIndex];
    if (!card || finishedRef.current || busy || submission.status !== "idle") return;
    const event = { target_id: card.id, lane: lane.id, at_ms: Math.max(0, Date.now() - gameStartedAtRef.current) };
    eventsRef.current = [...eventsRef.current, event];
    const nextIndex = currentIndex + 1;
    cardIndexRef.current = nextIndex;
    setCardIndex(nextIndex);
    if (nextIndex >= challenge.cards.length) {
      finishedRef.current = true;
      submission.submit(eventFinishPayload(eventsRef.current));
    }
  };
  const card = challenge.cards[cardIndex];
  const CardIcon = SORTING_ICONS[card?.icon] || Package;
  const remainingSeconds = Math.max(0, Math.ceil((challenge.durationMs - elapsedMs) / 1_000));
  const locked = busy || ["waiting", "submitting"].includes(submission.status);
  return <MiniGameFrame title="Котяче сортування" instruction={finishedRef.current ? "Кіт перевіряє порядок" : `${remainingSeconds} сек · ${cardIndex}/${challenge.cards.length}`} onClose={onClose} locked={locked}>
    <div className="pet-sorting-progress" aria-hidden="true"><i style={{ width: `${Math.min(100, cardIndex / Math.max(1, challenge.cards.length) * 100)}%` }} /></div>
    <div className="pet-sorting-stage" data-testid="pet-sorting-stage">{card ? <motion.div key={card.id} className="pet-sorting-card" initial={reducedMotion ? false : { opacity:0, y:-12, rotate:-2 }} animate={{ opacity:1, y:0, rotate:0 }}><span><CardIcon size={38} /></span><small>Куди покласти?</small><strong>{card.label}</strong></motion.div> : <div className="pet-sorting-done"><Check size={34} /><strong>Усі предмети розкладено</strong></div>}</div>
    <div className="pet-sorting-lanes" role="group" aria-label={card ? `Оберіть місце для ${card.label}` : "Сортування завершено"}>{challenge.lanes.map((lane) => <button key={lane.id} type="button" onClick={() => chooseLane(lane)} disabled={!card || locked || finishedRef.current} data-testid={`pet-sorting-lane-${lane.id}`}><Package size={20} /><span>{lane.label}</span></button>)}</div>
    <GameSubmissionStatus status={submission.status} onRetry={submission.retry} busy={busy} />
  </MiniGameFrame>;
}

function MiniGame({ session, onFinish, onClose, busy, reducedMotion }) {
  const gameId = normalizeGameId(session.game_id);
  const challenge = useMemo(() => publicGameChallenge(session), [session]);
  if (gameId === "memory" && challenge.kind === "sequence" && challenge.cues.length) return <MemoryMiniGame challenge={challenge} onFinish={onFinish} onClose={onClose} busy={busy} reducedMotion={reducedMotion} />;
  if (gameId === "laser" && challenge.kind === "timed-targets" && challenge.targets.length) return <LaserMiniGame challenge={challenge} onFinish={onFinish} onClose={onClose} busy={busy} reducedMotion={reducedMotion} />;
  if (gameId === "sorting" && challenge.kind === "sorting" && challenge.cards.length && challenge.lanes.length) return <SortingMiniGame challenge={challenge} onFinish={onFinish} onClose={onClose} busy={busy} reducedMotion={reducedMotion} />;
  if (Array.isArray(session.sequence) && session.sequence.length) return <LegacySequenceMiniGame session={session} onFinish={(moves) => onFinish(memoryFinishPayload(moves))} onClose={onClose} busy={busy} reducedMotion={reducedMotion} />;
  return <MiniGameFrame title="Мінігра" instruction="Сесію не вдалося прочитати" onClose={onClose} locked={busy}><div className="pet-empty-card"><AlertCircle size={30} /><strong>Оновіть гру</strong><p>Сервер повернув застарілий або неповний сценарій.</p></div></MiniGameFrame>;
}

function GamesPanel({ snapshot, perform, busy, onGoRoom }) {
  const reducedMotion = useReducedMotion();
  const [session, setSession] = useState(null);
  const [result, setResult] = useState(null);
  const life = derivePetLifeView(snapshot.pet, new Date(snapshot.server_time || "").getTime() || Date.now());
  const start = async (gameId) => { setResult(null); const payload = await perform({ url: `/pet/minigames/${gameId}/start`, body: {}, updateSnapshot: false }); if (payload?.session) setSession(payload.session); };
  const finish = async (finishBody) => { if (!session) return false; const payload = await perform({ url: `/pet/minigames/sessions/${session.id}/finish`, body: finishBody }); if (!payload) return false; setSession(null); setResult({ score: payload.score ?? payload.session?.score ?? 0, rewarded: payload.rewarded ?? payload.session?.rewarded }); return true; };
  if (!life.alive) return <div className="pet-panel" data-testid="pet-panel-games"><section className="pet-life-locked"><span><Lock size={28} /></span><h2 className="font-display">ІГРИ НЕДОСТУПНІ</h2><p>{life.label}. Спочатку поверніться до кімнати та прихистіть нового котика.</p><button type="button" className="pet-primary-button" onClick={onGoRoom}><Home size={18} /> До кімнати</button></section></div>;
  if (session) return <MiniGame session={session} onFinish={finish} onClose={() => setSession(null)} busy={busy} reducedMotion={reducedMotion} />;
  return <div className="pet-panel" data-testid="pet-panel-games"><div className="pet-panel-hero pet-panel-hero--games"><div><span>Три різні механіки</span><h2 className="font-display">ІГРИ З {snapshot.pet.name}</h2><p>Пам’ять, реакція та сортування. Результат перевіряє сервер за власним сценарієм, а не за балами клієнта.</p></div><Gamepad2 size={42} /></div>{result && <motion.div className="pet-game-result" initial={reducedMotion ? false : { scale:.92, opacity:0 }} animate={{ scale:1, opacity:1 }} data-testid="pet-game-result"><Star size={24} fill="currentColor" /><div><span>Результат {result.score}%</span><strong>{result.rewarded ? "+3 довіри · +1 пір'їнка" : result.score >= 50 ? "Денну нагороду вже отримано" : "Наберіть 50% для денної нагороди"}</strong></div></motion.div>}<div className="pet-game-list" data-testid="pet-games-list">{(snapshot.catalog?.games || []).map((game,index) => { const Icon = game.id === "memory" ? Brain : game.id === "sorting" ? Package : Crosshair; return <article key={game.id} className={`pet-game-card pet-game-card--${index % 2 ? "cyan" : "amber"}`} data-testid={`pet-game-card-${game.id}`}><div className="pet-game-art"><Icon size={42} /><span><PawPrint size={18} /></span></div><div className="pet-game-info"><div className="pet-game-meta"><span><Clock3 size={13} /> {game.duration_seconds} сек</span><span>{game.reward}</span></div><h3 className="font-display">{game.name}</h3><p>{game.description}</p><button type="button" onClick={() => start(game.id)} disabled={busy} data-testid={`pet-game-start-${game.id}`}>{busy ? <LoaderCircle className="spin" size={17} /> : <Gamepad2 size={17} />} Грати</button></div></article>; })}</div><div className="pet-fair-play-note"><Heart size={17} /><p><strong>Без фарму Point.</strong> Майстерність у грі впливає лише на дружбу та косметичні матеріали.</p></div></div>;
}

function JournalPanel({ snapshot }) {
  const [filter, setFilter] = useState("all");
  const journalQuery = useInfiniteQuery({
    queryKey:["pet-journal", snapshot.pet.user_id],
    queryFn:async({ pageParam })=> (await api.get("/pet/journal", { params:{ limit:20, ...(pageParam ? { cursor:pageParam } : {}) } })).data,
    initialPageParam:null,
    getNextPageParam:(lastPage)=> lastPage?.has_more ? lastPage.next_cursor : undefined,
    staleTime:15_000,
    refetchOnWindowFocus:true,
  });
  const fetchedItems = journalQuery.data?.pages?.flatMap((page) => page.items || []) || [];
  const items = fetchedItems.length ? fetchedItems : snapshot.recent_journal || [];
  const visible = filter === "all" ? items : items.filter((item) => filter === "memories" ? ["memory","story","milestone"].includes(item.kind) : filter === "rewards" ? item.kind === "reward" : ["discovery","collection","training","expedition","project","game"].includes(item.kind));
  return <div className="pet-panel" data-testid="pet-panel-journal"><div className="pet-panel-hero pet-panel-hero--journal"><div><span>Особиста історія</span><h2 className="font-display">ЩОДЕННИК {snapshot.pet.name}</h2><p>Тут залишаються тільки важливі моменти — без запису кожного натискання.</p></div><BookOpen size={42} /></div><div className="pet-journal-stats"><div><strong>{snapshot.pet.active_days || 0}</strong><span>днів разом</span></div><div><strong>{snapshot.pet.friendship_level}</strong><span>рівень дружби</span></div><div><strong>{snapshot.pet.inventory?.materials?.photo || 0}</strong><span>фотоспогадів</span></div></div><div className="pet-filter-row" role="group" aria-label="Фільтри щоденника">{[["all","Усі"],["memories","Спогади"],["rewards","Нагороди"],["discoveries","Відкриття"]].map(([id,label]) => <button key={id} type="button" aria-pressed={filter === id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{label}</button>)}</div>{journalQuery.isLoading && !items.length ? <div className="pet-inline-loading"><LoaderCircle className="spin" /> Завантажуємо записи…</div> : journalQuery.isError && !items.length ? <div className="pet-empty-card" data-testid="pet-journal-error"><AlertCircle size={30} /><strong>Щоденник не завантажився</strong><p>{extractError(journalQuery.error, "Перевірте мережу й повторіть спробу")}</p><button type="button" onClick={() => journalQuery.refetch()} data-testid="pet-journal-retry"><RotateCcw size={15} /> Повторити</button></div> : visible.length ? <div className="pet-journal-list" data-testid="pet-journal-list">{visible.map((item,index) => { const Icon = item.kind === "reward" ? Gift : item.kind === "expedition" ? MapPinned : item.kind === "game" ? Gamepad2 : item.kind === "training" ? PawPrint : item.important ? Star : Heart; return <article key={item.id} className={`pet-journal-entry ${item.important ? "important" : ""}`} data-testid={`pet-journal-entry-${item.id}`}><div className="pet-timeline-dot"><Icon size={17} /></div><div className="pet-journal-copy"><time>{formatEventTime(item.occurred_at)}</time><h3>{item.title}</h3><p>{item.text}</p></div>{index < visible.length - 1 && <span className="pet-timeline-line" />}</article>; })}</div> : <div className="pet-empty-card" data-testid="pet-journal-empty"><BookOpen size={30} /><strong>У завантажених записах цього ще немає</strong><p>Перегляньте давніші записи або оберіть інший фільтр.</p></div>}{journalQuery.hasNextPage && <button type="button" className="pet-load-more" onClick={() => journalQuery.fetchNextPage()} disabled={journalQuery.isFetchingNextPage}>{journalQuery.isFetchingNextPage ? <LoaderCircle className="spin" size={17} /> : <BookOpen size={17} />} Показати давніші записи</button>}</div>;
}

function CollectionPanel({ snapshot, perform, busy }) {
  const [filter, setFilter] = useState("all");
  const life = derivePetLifeView(snapshot.pet, new Date(snapshot.server_time || "").getTime() || Date.now());
  const owned = new Set(snapshot.pet.inventory?.items || []);
  const equipped = snapshot.pet.inventory?.equipped || {};
  const visible = (snapshot.catalog?.items || []).filter((item) => filter === "all" || (filter === "owned" ? owned.has(item.id) : !owned.has(item.id)));
  const setEquipped = async (itemId, shouldRemove) => { const result = await perform({ url:shouldRemove ? "/pet/collection/unequip" : "/pet/collection/equip", body:{ item_id:itemId } }); if (result) toast.success(result.message || "Вибір збережено"); };
  return <div className="pet-panel" data-testid="pet-panel-collection"><div className="pet-panel-hero pet-panel-hero--collection"><div><span>Ваша персональна кімната</span><h2 className="font-display">КОЛЕКЦІЯ</h2><p>Знахідки відкривають вигляд і реакції кота, але не підсилюють економічні нагороди.</p></div><Package size={42} /></div>{!life.alive && <div className="pet-collection-terminal-note" role="status"><Lock size={16} /><span>Колекція збережена. Облаштовувати кімнату знову можна буде після нового прихистку.</span></div>}<div className="pet-materials">{Object.entries(snapshot.pet.inventory?.materials || {}).map(([key,amount]) => { const Icon = MATERIAL_ICONS[key] || Circle; return <div key={key}><Icon size={17} /><strong>{amount}</strong><span>{snapshot.catalog?.materials?.[key] || key}</span></div>; })}</div><div className="pet-filter-row" role="group" aria-label="Фільтри колекції" data-testid="pet-collection-filters">{[["all","Усі"],["owned","Відкриті"],["locked","Закриті"]].map(([id,label]) => <button key={id} type="button" aria-pressed={filter === id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{label}</button>)}</div><div className="pet-collection-grid" data-testid="pet-collection-grid">{visible.map((item) => { const Icon = ITEM_ICONS[item.icon] || Package; const unlocked = owned.has(item.id); const roomSlot = item.room?.slot || item.slot; const isEquipped = equipped[roomSlot] === item.id; const canPlaceInRoom = Boolean(item.room?.asset); return <article key={item.id} className={`pet-item-card rarity-${item.rarity} ${!unlocked ? "locked" : ""}`} data-testid={`pet-collection-item-${item.id}`}><div className="pet-item-visual">{unlocked && item.room?.asset ? <img src={item.room.asset} alt="" loading="lazy" decoding="async" /> : unlocked ? <Icon size={34} /> : <Lock size={28} />}{isEquipped && <span><Check size={12} /></span>}</div><small>{item.rarity}</small><h3>{item.name}</h3><p>{item.description}</p>{unlocked && canPlaceInRoom ? <button type="button" aria-pressed={isEquipped} className={isEquipped ? "pet-item-remove" : ""} onClick={() => setEquipped(item.id, isEquipped)} disabled={busy || !life.alive}>{isEquipped ? "Забрати з кімнати" : "Поставити в кімнату"}</button> : !unlocked ? <div className="pet-unlock-label"><Lock size={12} /> {item.unlock_level >= 99 ? "Особливе завдання" : `Рівень ${item.unlock_level}`}</div> : <div className="pet-unlock-label"><Backpack size={12} /> Спорядження</div>}</article>; })}</div></div>;
}

function NarrativeOutcome({ outcome, resultRef }) {
  return <div ref={resultRef} className="pet-choice-outcome" data-testid="pet-choice-outcome" tabIndex={-1} role="status" aria-live="polite"><div className="pet-choice-outcome-cat"><Cat size={34} /><span><Heart size={14} /></span></div>{outcome.reaction_text && <blockquote>«{outcome.reaction_text}»</blockquote>}<ImpactChips items={outcome.impact || []} /><div className="pet-choice-next"><BookOpen size={16} /><span>{outcome.next_hint || "Цей момент збережено в особистому щоденнику."}</span></div></div>;
}

function SheetOption({ selected, icon: Icon, title, detail, impact = [], lockedReason, onClick, disabled }) {
  const unavailable = disabled || Boolean(lockedReason);
  const impactText = impact.map((item) => typeof item === "string" ? item : item?.label).filter(Boolean).join(", ");
  return <button type="button" aria-pressed={selected} aria-label={`${title}. ${lockedReason || detail || ""}${impactText ? `. Наслідки: ${impactText}` : ""}`} className={`pet-sheet-option ${selected ? "selected" : ""} ${lockedReason ? "locked" : ""}`} onClick={onClick} disabled={unavailable}><span className="pet-sheet-option-icon"><Icon size={21} /></span><div className="pet-sheet-option-copy"><strong>{title}</strong>{(lockedReason || detail) && <small>{lockedReason || detail}</small>}<ImpactChips items={impact} compact /></div>{lockedReason ? <b className="pet-sheet-option-state"><Lock size={16} /></b> : selected ? <Check size={17} /> : null}</button>;
}

function PetActionSheet({ type, snapshot, onClose, perform, busy, reward, navigate }) {
  const [selected, setSelected] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [narrative] = useState(() => type === "story" ? snapshot.story?.current_scene : type === "event" ? snapshot.daily_event : null);
  const outcomeRef = useRef(null);
  const reducedMotion = useReducedMotion();
  const pet = snapshot.pet;
  const event = type === "event" ? narrative : snapshot.daily_event;
  const storyScene = type === "story" ? narrative : snapshot.story?.current_scene;
  useEffect(() => { setSelected(null); setOutcome(null); }, [type]);
  useEffect(() => {
    if (!outcome) return undefined;
    const frame = window.requestAnimationFrame(() => outcomeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [outcome]);
  const closeDrawer = () => onClose(outcome);
  const closeAfter = async (promise, successMessage) => { const result = await promise; if (result) { toast.success(successMessage || result.message || "Готово"); onClose(); } };
  const submitNarrative = async (kind, subject) => {
    const result = await perform({
      url: kind === "story" ? "/pet/story/choose" : "/pet/events/choose",
      body: kind === "story"
        ? { scene_id: subject.id, choice_id: selected, date_key: snapshot.date_key, generation: pet.survival?.generation }
        : { event_id: subject.id, choice_id: selected, date_key: snapshot.date_key, generation: pet.survival?.generation },
    });
    if (!result) { onClose(); return; }
    if (result.outcome) {
      setOutcome(result.outcome);
      toast.success(result.outcome.title || "Вибір збережено");
    } else onClose();
  };
  let title = "Взаємодія", description = `Проведіть трохи часу з ${pet.name}.`, content = null, primary = null, secondaryLabel = "Не зараз";
  if (outcome) {
    title = outcome.title || "Вибір збережено";
    description = outcome.text || `${pet.name} запам’ятає цей момент.`;
    content = <NarrativeOutcome outcome={outcome} resultRef={outcomeRef} />;
    const outcomeCta = outcome.source === "event" ? "Повернутися до кімнати" : snapshot.story?.status === "completed" ? "Завершити історію" : "До наступного розділу";
    primary = <button type="button" className="pet-primary-button" onClick={closeDrawer}><Check size={18} /> {outcomeCta}</button>;
    secondaryLabel = "Закрити";
  } else if (type === "feed") {
    title = "Чим пригостити?"; description = "Кіт запам’ятовує меню. Та сама їжа кілька разів поспіль може викликати вередливість, а перегодовування — погану реакцію.";
    content = FOOD_OPTIONS.map((item) => <SheetOption key={item.id} {...item} title={item.name} selected={selected === item.id} onClick={() => setSelected(item.id)} disabled={busy} />);
    primary = <button type="button" className="pet-primary-button" disabled={!selected || busy} onClick={() => closeAfter(perform({ url:"/pet/care", body:{ action:"feed", option:selected }, idempotent:true }), "Смачного!")}><Utensils size={18} /> Пригостити</button>;
  } else if (type === "play") {
    title = "Обери іграшку"; description = "Змінюйте іграшки й стежте за енергією: виснажений кіт може відмовитися або втратити здоров’я від надмірної гри.";
    content = TOY_OPTIONS.map((item) => <SheetOption key={item.id} {...item} title={item.name} selected={selected === item.id} onClick={() => setSelected(item.id)} disabled={busy} />);
    primary = <button type="button" className="pet-primary-button" disabled={!selected || busy} onClick={() => closeAfter(perform({ url:"/pet/care", body:{ action:"play", option:selected }, idempotent:true }), "Чудова гра!")}><Gamepad2 size={18} /> Гратися</button>;
  } else if (type === "expedition") {
    const [locationId, loadoutId] = (selected || "park:backpack").split(":"); title = "Нова експедиція"; description = "Оберіть локацію та спорядження. Результат зарахується, навіть якщо PWA закрита.";
    content = <><span className="pet-sheet-label">Локація</span>{(snapshot.catalog?.expeditions || []).map((item) => <SheetOption key={item.id} icon={MapPinned} title={item.name} detail={`${Math.round(item.duration_minutes/60)} год · −${item.energy_cost} енергії`} selected={locationId === item.id} onClick={() => setSelected(`${item.id}:${loadoutId}`)} disabled={busy} />)}<span className="pet-sheet-label">Спорядження</span><div className="pet-loadout-grid">{(snapshot.catalog?.loadout || []).map((item) => { const Icon = LOADOUT_ICONS[item.id] || Backpack; const locked = item.required_item && !pet.inventory?.items?.includes(item.required_item); return <button key={item.id} type="button" aria-pressed={loadoutId === item.id} aria-label={`${item.name}. ${locked ? "Потрібен 5 рівень дружби" : item.description}`} className={loadoutId === item.id ? "selected" : ""} onClick={() => setSelected(`${locationId}:${item.id}`)} disabled={busy || locked}>{locked ? <Lock size={20} /> : <Icon size={20} />}<span>{item.name}</span></button>; })}</div></>;
    primary = <button type="button" className="pet-primary-button" disabled={busy} onClick={() => closeAfter(perform({ url:"/pet/expeditions", body:{ location_id:locationId, loadout_id:loadoutId } }))}><MapPinned size={18} /> Відправити {pet.name}</button>;
  } else if (type === "training") {
    const trickId = selected || "paw"; title = "Тренування трюку"; description = "Кожна сесія гарантовано додає майстерність. Помилки не відкидають прогрес.";
    content = (snapshot.catalog?.tricks || []).map((item) => <SheetOption key={item.id} icon={PawPrint} title={item.name} detail={`${pet.tricks?.[item.id]?.mastery || 0}% майстерності · −${item.energy_cost} енергії`} selected={trickId === item.id} onClick={() => setSelected(item.id)} disabled={busy} />);
    primary = <button type="button" className="pet-primary-button" disabled={busy} onClick={() => closeAfter(perform({ url:`/pet/tricks/${trickId}/practice`, body:{} }))}><PawPrint size={18} /> Тренуватися</button>;
  } else if (type === "project") {
    const contribution = selected || "cardboard"; title = "Картонна фортеця"; description = "Один внесок витрачає денний Фокус. Три різні дні відкривають постійний декор.";
    content = [{id:"cardboard",name:"Додати картон",detail:"Використати 1 картон",icon:Package},{id:"craft",name:"Зв'язати конструкцію",detail:"Використати 1 мотузку",icon:Circle},{id:"ideas",name:"Продумати план",detail:"Без матеріалів",icon:Brain}].map((item) => <SheetOption key={item.id} {...item} title={item.name} selected={contribution === item.id} onClick={() => setSelected(item.id)} disabled={busy} />);
    primary = <button type="button" className="pet-primary-button" disabled={busy} onClick={() => closeAfter(perform({ url:"/pet/project/contribute", body:{ contribution } }))}><Package size={18} /> Додати етап</button>;
  } else if (type === "story" && storyScene) {
    title = storyScene.title; description = storyScene.text;
    content = <>{storyScene.foreshadow && <div className="pet-story-foreshadow"><Sparkles size={16} /><span>{storyScene.foreshadow}</span></div>}<span className="pet-sheet-label">Як вчинити?</span><div className="pet-choice-list" role="group" aria-label="Варіанти сюжетного вибору">{storyScene.choices.map((choice) => <SheetOption key={choice.id} icon={BookOpen} title={choice.label} detail={choice.hint} impact={choice.impact || []} lockedReason={choice.locked_reason} selected={selected === choice.id} onClick={() => setSelected(choice.id)} disabled={busy} />)}</div><p className="pet-choice-warning"><AlertCircle size={15} /> Рішення остаточне для цього розділу й вплине на характер та майбутні сцени.</p></>;
    primary = <button type="button" className="pet-primary-button" disabled={!selected || busy} onClick={() => submitNarrative("story", storyScene)}>{busy ? <LoaderCircle className="spin" size={18} /> : <BookOpen size={18} />} {busy ? "Зберігаємо…" : "Підтвердити вибір"}</button>;
  } else if (type === "event" && event) {
    title = event.title; description = event.text;
    content = <><div className="pet-choice-list" role="group" aria-label="Варіанти випадкової події">{event.choices.map((choice) => <SheetOption key={choice.id} icon={Sparkles} title={choice.label} detail={choice.hint} impact={choice.impact || []} lockedReason={choice.locked_reason} selected={selected === choice.id} onClick={() => setSelected(choice.id)} disabled={busy} />)}</div><p className="pet-choice-warning"><AlertCircle size={15} /> Тут немає автоматично правильного варіанта: користь може мати свою ціну.</p></>;
    primary = <button type="button" className="pet-primary-button" disabled={!selected || busy} onClick={() => submitNarrative("event", event)}>{busy ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />} {busy ? "Зберігаємо…" : "Підтвердити вибір"}</button>;
  } else if (type === "rename") {
    title = "Ім'я улюбленця"; description = "Це ваш особистий кіт — ім'я бачите тільки ви у власній грі."; content = <label className="pet-name-input"><span>Нове ім'я</span><input value={selected ?? pet.name} onChange={(e) => setSelected(e.target.value)} maxLength={20} autoFocus /></label>;
    primary = <button type="button" className="pet-primary-button" disabled={busy || String(selected ?? pet.name).trim().length < 2} onClick={() => closeAfter(perform({ method:"patch", url:"/pet", body:{ name:String(selected ?? pet.name).trim() } }))}><Check size={18} /> Зберегти ім'я</button>;
  } else if (type === "collection-shortcut") {
    title = "Полиця знахідок"; description = "У колекції можна переглянути матеріали, відкрити декор і змінити кімнату."; content = <div className="pet-sheet-preview"><Package size={36} /><strong>{pet.inventory?.items?.length || 0} предметів відкрито</strong><span>Матеріали з експедицій залишаються у вашому інвентарі.</span></div>;
    primary = <button type="button" className="pet-primary-button" onClick={() => { onClose(); navigate("/pet/collection"); }}><Package size={18} /> Відкрити колекцію</button>;
  } else if (type === "reward") {
    title = "Подарунок від кота"; description = `${pet.name} інколи приносить Point, матеріали або рідкісний декор.`; content = <motion.div className="pet-reward-reveal" initial={reducedMotion ? false : { scale:.72, rotate:-4 }} animate={{ scale:1, rotate:0 }}><div><Gift size={48} /></div><span>Сьогодні всередині</span><strong>{reward?.title || snapshot.gift?.reward?.title || "Сюрприз"}</strong></motion.div>;
    primary = <button type="button" className="pet-primary-button" onClick={onClose}><Check size={18} /> Чудово!</button>;
  }
  return <Drawer open={Boolean(type)} dismissible={!busy} onOpenChange={(open) => !open && !busy && closeDrawer()} shouldScaleBackground={false}><DrawerContent className="pet-drawer" data-testid={type === "reward" ? "pet-reward-dialog" : "pet-action-drawer"}><DrawerHeader className="pet-drawer-header"><div className="pet-drawer-icon">{type === "story" ? <BookOpen size={20} /> : <PawPrint size={20} />}</div><DrawerTitle className="font-display">{title}</DrawerTitle><DrawerDescription>{description}</DrawerDescription></DrawerHeader><div className="pet-drawer-body">{content}</div><DrawerFooter className="pet-drawer-footer">{primary}<DrawerClose asChild><button type="button" className="pet-secondary-button" disabled={busy}>{secondaryLabel}</button></DrawerClose></DrawerFooter></DrawerContent></Drawer>;
}

export default function Pet() {
  const { user, refreshMe } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();
  const [sheet, setSheet] = useState(null);
  const [reward, setReward] = useState(null);
  const [narrativeReplay, setNarrativeReplay] = useState(null);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const activeActionRef = useRef(null);
  const routeTab = location.pathname.split("/")[2] || "room";
  const activeTab = TAB_ITEMS.some((item) => item.id === routeTab) ? routeTab : "room";
  useEffect(() => { if (location.pathname === "/pet" || !TAB_ITEMS.some((item) => item.id === routeTab)) navigate("/pet/room", { replace:true }); }, [location.pathname, navigate, routeTab]);
  useEffect(() => {
    const syncOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    return () => { window.removeEventListener("online", syncOnline); window.removeEventListener("offline", syncOnline); };
  }, []);
  const petQuery = useQuery({ queryKey:["pet",user?.id], queryFn:async()=> (await api.get("/pet")).data, enabled:Boolean(user?.id), staleTime:15_000, refetchOnWindowFocus:true, refetchOnReconnect:true, retry:1, refetchInterval:(query)=> petRefetchInterval(query.state.data) });
  const actionMutation = useMutation({ mutationFn:async({method="post",url,body,idempotencyKey}) => { const config = idempotencyKey ? { headers:{"Idempotency-Key":idempotencyKey} } : {}; return (await api.request({method,url,data:body,...config})).data; } });
  const perform = async ({ method="post", url, body={}, idempotent=false, updateSnapshot=true }) => {
    if (!online) { toast.error("Дії недоступні офлайн — прогрес і нагороди не змінено"); return null; }
    if (activeActionRef.current) return null;
    const key = idempotent ? createIdempotencyKey() : null; activeActionRef.current = key || url;
    try {
      const payload = await actionMutation.mutateAsync({ method,url,body,idempotencyKey:key });
      const nextSnapshot = payload?.pet_state?.pet ? payload.pet_state : payload?.pet ? payload : null;
      if (updateSnapshot && nextSnapshot) queryClient.setQueryData(["pet",user?.id], nextSnapshot);
      if (payload?.reward?.type === "points" || payload?.gift?.reward?.type === "points") refreshMe().catch(()=>{});
      queryClient.invalidateQueries({ queryKey:["pet-journal",user?.id] });
      return payload;
    } catch (error) {
      if (error?.response?.status === 409) {
        void queryClient.invalidateQueries({ queryKey:["pet",user?.id] });
      }
      toast.error(extractError(error,"Не вдалося виконати дію"));
      return null;
    }
    finally { activeActionRef.current = null; }
  };
  const petStatus = petQuery.data?.pet?.survival?.status || "alive";
  useEffect(() => { if (petStatus !== "alive") setSheet(null); }, [petStatus]);
  if (petQuery.isLoading) return <PetLoading />;
  if (petQuery.isError || !petQuery.data?.pet) return <PetError error={petQuery.error} onRetry={() => petQuery.refetch()} />;
  const snapshot = petQuery.data;
  const life = derivePetLifeView(snapshot.pet, new Date(snapshot.server_time || "").getTime() || Date.now());
  const busy = actionMutation.isPending || !online;
  const closeSheet = (resolvedOutcome) => {
    if (resolvedOutcome?.reaction_text) setNarrativeReplay({ ...resolvedOutcome, replay_started_at: Date.now() });
    setSheet(null);
  };
  return <MotionConfig reducedMotion="user"><section className="pet-page" data-testid="pet-page"><PetHeader pet={snapshot.pet} life={life} onRename={() => setSheet("rename")} />{!online && <div className="pet-offline-banner" role="status" data-testid="pet-offline"><WifiOff size={16} /> Офлайн: кімнату можна переглядати, дії призупинено</div>}<PetTabs activeTab={activeTab} petStatus={life.status} onChange={(tab) => navigate(`/pet/${tab}`)} /><AnimatePresence mode="wait" initial={false}><motion.div id="pet-active-panel" role="tabpanel" aria-labelledby={`pet-tab-${activeTab}`} tabIndex={0} key={activeTab} initial={reducedMotion ? false : {opacity:0,x:14}} animate={{opacity:1,x:0}} exit={reducedMotion ? undefined : {opacity:0,x:-10}} transition={{duration:.18}}>{activeTab === "room" && <RoomPanel snapshot={snapshot} perform={perform} busy={busy} setSheet={setSheet} setReward={setReward} reducedMotion={reducedMotion} narrativeReplay={narrativeReplay} />}{activeTab === "games" && <GamesPanel snapshot={snapshot} perform={perform} busy={busy} onGoRoom={() => navigate("/pet/room")} />}{activeTab === "journal" && <JournalPanel snapshot={snapshot} />}{activeTab === "collection" && <CollectionPanel snapshot={snapshot} perform={perform} busy={busy} />}</motion.div></AnimatePresence>{sheet && <PetActionSheet key={sheet} type={sheet} snapshot={snapshot} onClose={closeSheet} perform={perform} busy={busy} reward={reward} navigate={navigate} />}<div className="pet-sr-status" role="status" aria-live="polite">{actionMutation.isPending ? "Дію виконуємо" : ""}</div></section></MotionConfig>;
}
