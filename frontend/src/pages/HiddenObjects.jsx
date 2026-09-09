import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PixelGameLink, usePixelOrigin } from "@/components/PixelGameBridge";
import {
  ArrowLeft, ChevronRight, Clock3, Flag, Lightbulb, Lock, Pause,
  Play, RotateCcw, Search, Sparkles, Star, Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/context/AppContext";
import api, { extractError } from "@/lib/api";
import SceneViewport from "@/components/hidden-objects/SceneViewport";
import TargetTray from "@/components/hidden-objects/TargetTray";
import ResultModal from "@/components/hidden-objects/ResultModal";
import FailureModal from "@/components/hidden-objects/FailureModal";
import {
  getMistakeLimit, getMistakesRemaining, getMistakesUsed, isHiddenObjectSessionFailed,
} from "@/components/hidden-objects/sessionState";
import "@/styles/hidden-objects.css";

const difficultyLabels = { easy: "Легко", medium: "Середньо", hard: "Складно" };
const sceneLoads = new Map();

const formatTime = (seconds = 0) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;
const normalizeCompletions = (items) => Object.fromEntries((Array.isArray(items) ? items : []).map((item) => [Number(item.level), item]));

const preloadScene = (src, expectedWidth = 0, expectedHeight = 0) => {
  if (!src || typeof Image === "undefined") return Promise.resolve();
  const cacheKey = `${src}|${expectedWidth}x${expectedHeight}`;
  if (!sceneLoads.has(cacheKey)) {
    const request = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const width = Number(image.naturalWidth || 0);
        const height = Number(image.naturalHeight || 0);
        const invalidFallback = width <= 1 || height <= 1;
        const wrongSize = (expectedWidth && width !== Number(expectedWidth))
          || (expectedHeight && height !== Number(expectedHeight));
        if (invalidFallback || wrongSize) {
          reject(new Error("Некоректне зображення сцени"));
          return;
        }
        resolve();
      };
      image.onerror = () => reject(new Error("Не вдалося завантажити сцену"));
      image.src = src;
    });
    sceneLoads.set(cacheKey, request.catch((error) => {
      sceneLoads.delete(cacheKey);
      throw error;
    }));
  }
  return sceneLoads.get(cacheKey);
};

export const preloadHiddenObjectArtwork = (levels = []) => {
  const first = Array.isArray(levels) ? levels[0]?.image : null;
  return first
    ? preloadScene(first, levels[0]?.image_width, levels[0]?.image_height).catch(() => null)
    : Promise.resolve();
};

export default function HiddenObjects() {
  const fromPixel = usePixelOrigin();
  const nav = useNavigate();
  const { refreshMe } = useApp();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ unlocked_level: 1, max_level: 0, total_stars: 0, completions: [], levels: [], active_session: null });
  const [screen, setScreen] = useState("catalog");
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [result, setResult] = useState(null);
  const [hintMarker, setHintMarker] = useState(null);
  const [missMarker, setMissMarker] = useState(null);
  const sequenceRef = useRef(0);
  const markerTimerRef = useRef(null);
  const missTimerRef = useRef(null);
  const sessionId = session?.id;
  const sessionPaused = session?.paused;
  const mistakeLimit = getMistakeLimit(session);
  const mistakesUsed = getMistakesUsed(session);
  const mistakesRemaining = getMistakesRemaining(session);
  const sessionFailed = isHiddenObjectSessionFailed(session)
    || (mistakeLimit !== null && mistakesRemaining === 0);

  const completions = useMemo(() => normalizeCompletions(status.completions), [status.completions]);
  const completedCount = Object.keys(completions).length;
  const totalStars = Object.values(completions).reduce((sum, item) => sum + Number(item.stars || 0), 0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const { data } = await api.get("/games/hidden-objects/status");
      setStatus(data);
      preloadHiddenObjectArtwork(data.levels);
    } catch (error) {
      const message = extractError(error, "Не вдалося завантажити VPDK Детектив");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!sessionId || sessionPaused || sessionFailed || result || screen !== "game") return undefined;
    const timer = window.setInterval(() => {
      setSession((current) => current ? { ...current, elapsed: Number(current.elapsed || 0) + 1 } : current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [result, screen, sessionFailed, sessionId, sessionPaused]);

  useEffect(() => () => {
    if (markerTimerRef.current) window.clearTimeout(markerTimerRef.current);
    if (missTimerRef.current) window.clearTimeout(missTimerRef.current);
  }, []);

  const openSession = useCallback((next) => {
    sequenceRef.current = Number(next?.last_sequence || 0);
    setSession(next);
    setResult(null);
    setHintMarker(null);
    setMissMarker(null);
    setScreen("game");
  }, []);

  const startLevel = useCallback(async (level, restart = false) => {
    if (!level || Number(level.id) > Number(status.unlocked_level || 1) || busy) return;
    setBusy(true);
    try {
      await preloadScene(level.image, level.image_width, level.image_height);
      const { data } = await api.post("/games/hidden-objects/start", { level: Number(level.id), restart });
      openSession(data.session);
      setStatus((current) => ({ ...current, active_session: data.session }));
    } catch (error) {
      toast.error(extractError(error, "Не вдалося розпочати справу"));
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, [busy, openSession, status.unlocked_level]);

  const continueGame = useCallback(async () => {
    const active = status.active_session;
    if (!active || isHiddenObjectSessionFailed(active)) return;
    setBusy(true);
    try {
      await preloadScene(active.image, active.image_width, active.image_height);
      openSession(active);
    } catch (_) {
      toast.error("Не вдалося завантажити сцену");
    } finally {
      setBusy(false);
    }
  }, [openSession, status.active_session]);

  const completeLevel = useCallback(async (completedSession) => {
    try {
      const { data } = await api.post("/games/hidden-objects/complete", { session_id: completedSession.id });
      const reward = data.reward || {};
      setStatus(data.status || status);
      await refreshMe().catch(() => {});
      setResult({
        session_id: completedSession.id,
        level: Number(completedSession.level_id),
        title: completedSession.title,
        elapsed: Number(completedSession.elapsed || 0),
        mistakes: Number(completedSession.mistakes || 0),
        hints_used: Number(completedSession.hints_used || 0),
        ...reward,
      });
      navigator.vibrate?.([35, 40, 70]);
    } catch (error) {
      toast.error(extractError(error, "Усі предмети знайдено, але результат не збережено"));
    }
  }, [refreshMe, status]);

  const runAction = useCallback(async (kind, payload = {}) => {
    if (!session || busy || result || sessionFailed) return;
    const sequence = Math.max(sequenceRef.current, Number(session.last_sequence || 0)) + 1;
    sequenceRef.current = sequence;
    setBusy(true);
    try {
      const { data } = await api.post("/games/hidden-objects/action", {
        session_id: session.id,
        sequence,
        kind,
        ...payload,
      });
      const event = data.event;
      const responseSession = data.session;
      const next = isHiddenObjectSessionFailed(responseSession, event) && responseSession?.status !== "failed"
        ? { ...responseSession, status: "failed" }
        : responseSession;
      setSession(next);
      setStatus((current) => ({
        ...current,
        active_session: isHiddenObjectSessionFailed(next, event) ? null : next,
      }));

      if (kind === "find" && event?.hit && !event?.duplicate) {
        navigator.vibrate?.(22);
        setHintMarker(null);
        toast.success(`Знайдено: ${event.object?.label || "предмет"}`);
      } else if (kind === "find" && event && !event.hit) {
        setMissMarker(payload);
        navigator.vibrate?.(event.failed ? [35, 35, 90] : 12);
        if (missTimerRef.current) window.clearTimeout(missTimerRef.current);
        missTimerRef.current = window.setTimeout(() => setMissMarker(null), 650);
      } else if (kind === "hint" && event?.marker) {
        setHintMarker(event.marker);
        if (markerTimerRef.current) window.clearTimeout(markerTimerRef.current);
        markerTimerRef.current = window.setTimeout(() => setHintMarker(null), 3500);
      }

      if (!isHiddenObjectSessionFailed(next, event) && next?.targets?.length && next.found_ids?.length >= next.targets.length) {
        await completeLevel(next);
      }
    } catch (error) {
      toast.error(extractError(error, "Дію не вдалося зберегти"));
    } finally {
      setBusy(false);
    }
  }, [busy, completeLevel, result, session, sessionFailed]);

  const exitGame = async () => {
    if (busy) return;
    let activeSession = result || sessionFailed ? null : session;
    if (activeSession && !activeSession.paused) {
      const sequence = Math.max(sequenceRef.current, Number(activeSession.last_sequence || 0)) + 1;
      sequenceRef.current = sequence;
      setBusy(true);
      try {
        const { data } = await api.post("/games/hidden-objects/action", {
          session_id: activeSession.id,
          sequence,
          kind: "pause",
        });
        activeSession = data.session;
      } catch (_) {
        toast.warning("Справу закрито, але таймер може продовжити відлік");
      } finally {
        setBusy(false);
      }
    }
    setStatus((current) => ({ ...current, active_session: activeSession }));
    setScreen("catalog");
    setSession(null);
    setResult(null);
    setHintMarker(null);
    setMissMarker(null);
  };

  const nextAfterResult = () => {
    const nextLevel = status.levels?.find((level) => Number(level.id) === Number(result?.level) + 1);
    setResult(null);
    if (nextLevel && Number(nextLevel.id) <= Number(status.unlocked_level || result?.level + 1)) startLevel(nextLevel);
    else exitGame();
  };

  const replay = () => {
    const level = status.levels?.find((item) => Number(item.id) === Number(result?.level || session?.level_id));
    setResult(null);
    if (level) startLevel(level, true);
  };

  if (loading && !status.levels?.length) {
    return <div className="hidden-page hidden-loading"><Search size={42} /><strong>Готуємо нові справи…</strong><span>Розкладаємо предмети по сценах</span></div>;
  }

  if (loadError && !status.levels?.length) {
    return (
      <div className="hidden-page hidden-loading hidden-load-error" role="alert">
        <Search size={42} />
        <strong>Справи не завантажилися</strong>
        <span>{loadError}</span>
        <button type="button" className="hidden-primary-button" onClick={load}>
          <RotateCcw size={18} /> Спробувати ще
        </button>
      </div>
    );
  }

  if (screen === "game" && session) {
    const hintsLeft = Math.max(0, Number(session.hints_total || 0) - Number(session.hints_used || 0));
    return (
      <div className={`hidden-page hidden-game-page ${sessionFailed ? "is-failed" : ""}`} data-testid="hidden-objects-game">
        <header className="hidden-game-head">
          <button type="button" className="hidden-icon-button" onClick={exitGame} disabled={busy} aria-label="До списку справ"><ArrowLeft size={22} /></button>
          <div className="hidden-game-title"><span>РІВЕНЬ {session.level_id} · {difficultyLabels[session.difficulty] || "Середньо"}</span><strong>{session.title}</strong></div>
          <div className="hidden-time-pill"><Clock3 size={16} /><b>{formatTime(session.elapsed)}</b></div>
          <button type="button" className="hidden-icon-button" disabled={busy || sessionFailed} onClick={() => runAction(session.paused ? "resume" : "pause")} aria-label={session.paused ? "Продовжити" : "Пауза"}>{session.paused ? <Play size={20} /> : <Pause size={20} />}</button>
        </header>

        <div className="hidden-game-meta">
          <span
            className={`${mistakeLimit !== null && mistakesRemaining <= Math.max(1, Math.ceil(mistakeLimit * .4)) ? "is-warning" : ""} ${mistakesRemaining === 0 ? "is-critical" : ""}`}
            role="status"
            aria-live="polite"
            aria-label={mistakeLimit === null ? `Промахи: ${mistakesUsed}` : `Промахи: ${mistakesUsed} з ${mistakeLimit}. Залишилося ${mistakesRemaining}`}
            data-testid="hidden-object-mistakes"
          ><Flag size={14} /> {mistakeLimit === null ? `${mistakesUsed} промахів` : `Промахи ${mistakesUsed}/${mistakeLimit}`}</span>
          <span><Lightbulb size={14} /> {hintsLeft} підказок</span>
          <span><Search size={14} /> {session.found_ids?.length || 0}/{session.targets?.length || 0}</span>
        </div>

        <SceneViewport session={session} hintMarker={hintMarker} missMarker={missMarker} disabled={busy || session.paused || sessionFailed || Boolean(result)} onFind={(point) => runAction("find", point)} />
        <TargetTray session={session} busy={busy || session.paused || sessionFailed} onHint={() => runAction("hint")} />

        {busy && !sessionFailed && <div className="hidden-action-indicator" role="status"><Search size={17} /> Перевіряємо знахідку…</div>}
        {session.paused && !sessionFailed && !result && (
          <div className="hidden-pause-overlay" role="dialog" aria-modal="true" aria-label="Гру призупинено">
            <div><Pause size={38} /><span className="hidden-eyebrow">ПАУЗА</span><h2>Справу призупинено</h2><p>Сцена прихована, а активний час зупинено.</p><button type="button" className="hidden-primary-button" onClick={() => runAction("resume")} disabled={busy}><Play size={19} /> Продовжити</button></div>
          </div>
        )}
        <ResultModal result={result} maxLevel={status.max_level || status.levels?.length || 0} onNext={nextAfterResult} onReplay={replay} onClose={exitGame} fromPixel={fromPixel} onReturnToPixel={() => nav("/pet/room")} />
        <FailureModal session={session} open={sessionFailed && !result} busy={busy} onReplay={replay} onClose={exitGame} />
      </div>
    );
  }

  const chapters = [...new Set((status.levels || []).map((level) => level.chapter))];
  return (
    <div className="hidden-page hidden-catalog" data-testid="hidden-objects-page">
      <PixelGameLink enabled={fromPixel} onReturn={() => nav("/pet/room")} disabled={busy} />
      <section className="hidden-hero">
        <button type="button" className="hidden-back-button" onClick={() => nav(fromPixel ? "/pet/room" : "/")} aria-label={fromPixel ? "До кімнати Пікселя" : "На головну"}><ArrowLeft size={20} /></button>
        <div className="hidden-hero-copy">
          <span className="hidden-eyebrow">ГРА НА УВАЖНІСТЬ · {status.max_level || status.levels?.length || 0} СПРАВ</span>
          <h1>VPDK <b>ДЕТЕКТИВ</b></h1>
          <p>Шукай загублені предмети, відкривай нові сцени та отримуй зірки за уважність.</p>
        </div>
        <div className="hidden-hero-icon"><Search size={32} /></div>
      </section>

      <section className="hidden-progress-card">
        <div className="hidden-progress-ring" style={{ "--progress": `${status.max_level ? Math.round(completedCount / status.max_level * 360) : 0}deg` }}><strong>{completedCount}/{status.max_level || status.levels?.length || 0}</strong><span>справ</span></div>
        <div className="hidden-progress-stats">
          <div><Trophy size={18} /><span>Розкрито</span><strong>{completedCount}</strong></div>
          <div><Star size={18} /><span>Зірки</span><strong>{totalStars}</strong></div>
          <div><Sparkles size={18} /><span>Відкрито</span><strong>{status.unlocked_level || 1}</strong></div>
        </div>
      </section>

      {status.active_session && !isHiddenObjectSessionFailed(status.active_session) && (
        <button type="button" className="hidden-continue-button" onClick={continueGame} disabled={busy} data-testid="hidden-object-continue">
          <span><Play size={20} fill="currentColor" /></span><div><small>НЕЗАВЕРШЕНА СПРАВА</small><strong>{status.active_session.title}</strong></div><ChevronRight size={20} />
        </button>
      )}

      <section className="hidden-levels-section">
        <div className="hidden-section-heading"><div><span className="hidden-eyebrow">КАМПАНІЯ</span><h2>Обери наступну справу</h2></div><Search size={23} /></div>
        {chapters.map((chapter, chapterIndex) => (
          <div className="hidden-chapter" key={chapter}>
            <div className="hidden-chapter-title"><span>0{chapterIndex + 1}</span><div><strong>{chapter}</strong><small>{status.levels.filter((level) => level.chapter === chapter).length} справи</small></div></div>
            <div className="hidden-level-grid">
              {status.levels.filter((level) => level.chapter === chapter).map((level) => {
                const completion = completions[level.id];
                const locked = Number(level.id) > Number(status.unlocked_level || 1);
                const levelMistakeLimit = getMistakeLimit(level);
                return (
                  <button type="button" key={level.id} className={`hidden-level-card ${locked ? "is-locked" : ""} ${completion ? "is-complete" : ""}`} disabled={locked || busy} onClick={() => startLevel(level)} data-testid={`hidden-object-level-${level.id}`}>
                    <img src={level.cover || level.image} alt="" loading={Number(level.id) > 2 ? "lazy" : "eager"} />
                    <span className="hidden-level-shade" />
                    <div className="hidden-level-number">{locked ? <Lock size={15} /> : String(level.id).padStart(2, "0")}</div>
                    {completion && <div className="hidden-level-stars">{[1, 2, 3].map((value) => <Star key={value} size={13} fill={value <= completion.stars ? "currentColor" : "none"} />)}</div>}
                    <div className="hidden-level-copy"><strong>{level.title}</strong><small>{level.target_count} предметів · {difficultyLabels[level.difficulty]}{levelMistakeLimit === null ? "" : ` · ${levelMistakeLimit} промахів`}</small></div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
