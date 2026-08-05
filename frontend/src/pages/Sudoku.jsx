import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Brain, Check, ChevronRight, Clock3, Crown, Delete, Eraser,
  Eye, EyeOff, Flag, Grid3X3, Lightbulb, Lock, Medal, Pause, Pencil,
  Play, Redo2, RefreshCcw, RotateCcw, Sparkles, Star, Trophy, Undo2, X,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/context/AppContext";
import api, { extractError } from "@/lib/api";
import levels from "@/data/sudokuLevels.json";
import "@/styles/sudoku.css";

const STORAGE_VERSION = "v108";
const SAVE_DELAY = 900;
const typeLabels = { classic: "Класичне", irregular: "Нерегулярне", vertical: "Вертикальне" };
const difficultyLabels = { easy: "Легко", medium: "Середньо", hard: "Важко", expert: "Експерт" };
const modeLabels = { standard: "Стандарт", zen: "Дзен", timeAttack: "На час", noMistakes: "Без помилок" };
const sectionNames = ["Вступ", "Фокус", "Тактика", "Майстерність", "Гросмейстер"];

const blankNotes = () => Array.from({ length: 81 }, () => []);
const cloneNotes = (notes) => (Array.isArray(notes) ? notes.map((row) => Array.isArray(row) ? [...row] : []) : blankNotes());
const localKey = (userId) => `tm6-sudoku-${STORAGE_VERSION}:${userId || "guest"}`;
const formatTime = (seconds = 0) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;
const modeLimit = (difficulty) => ({ easy: 15 * 60, medium: 12 * 60, hard: 10 * 60, expert: 8 * 60 }[difficulty] || 10 * 60);

const getPeers = (index, regions) => {
  const row = Math.floor(index / 9);
  const col = index % 9;
  const region = regions[index];
  const peers = [];
  for (let i = 0; i < 81; i += 1) {
    if (i === index) continue;
    if (Math.floor(i / 9) === row || i % 9 === col || regions[i] === region) peers.push(i);
  }
  return peers;
};

const createSession = (level, mode, serverSession = null) => ({
  id: serverSession?.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  level_id: level.id,
  mode: serverSession?.mode || mode,
  cells: Array.isArray(serverSession?.cells) && serverSession.cells.length === 81 ? [...serverSession.cells] : [...level.puzzle],
  notes: Array.isArray(serverSession?.notes) && serverSession.notes.length === 81 ? cloneNotes(serverSession.notes) : blankNotes(),
  selected: Number.isInteger(serverSession?.selected) ? serverSession.selected : null,
  pencil: Boolean(serverSession?.pencil),
  elapsed: Math.max(0, Number(serverSession?.elapsed || 0)),
  errors: Math.max(0, Number(serverSession?.errors || 0)),
  hints_used: Math.max(0, Number(serverSession?.hints_used || 0)),
  notes_used: Boolean(serverSession?.notes_used),
  history: [],
  future: [],
  paused: false,
  started_at: serverSession?.started_at || new Date().toISOString(),
});

const snapshot = (session) => ({
  cells: [...session.cells], notes: cloneNotes(session.notes), errors: session.errors,
  hints_used: session.hints_used, notes_used: session.notes_used,
});

const normalizeCompletions = (items) => Object.fromEntries((Array.isArray(items) ? items : []).map((item) => [Number(item.level), item]));

function SudokuBoard({ level, session, wrong, celebrate, onSelect }) {
  const selected = session.selected;
  const selectedValue = selected === null ? 0 : session.cells[selected];
  const selectedRow = selected === null ? -1 : Math.floor(selected / 9);
  const selectedCol = selected === null ? -1 : selected % 9;
  const selectedRegion = selected === null ? -1 : level.regions[selected];

  return (
    <div className={`sudoku-board sudoku-board-${level.type}`} role="grid" aria-label="Судоку 9 на 9">
      {session.cells.map((value, index) => {
        const row = Math.floor(index / 9);
        const col = index % 9;
        const region = level.regions[index];
        const given = Boolean(level.puzzle[index]);
        const active = selected === index;
        const related = selected !== null && (row === selectedRow || col === selectedCol || region === selectedRegion);
        const same = Boolean(selectedValue) && value === selectedValue;
        const top = row === 0 || level.regions[index - 9] !== region;
        const left = col === 0 || level.regions[index - 1] !== region;
        const right = col === 8 || level.regions[index + 1] !== region;
        const bottom = row === 8 || level.regions[index + 9] !== region;
        return (
          <button
            key={index}
            type="button"
            role="gridcell"
            aria-selected={active}
            aria-label={`${String.fromCharCode(65 + row)}${col + 1}${value ? `, число ${value}` : ", порожня"}`}
            className={[
              "sudoku-cell", given ? "is-given" : "is-editable", active ? "is-active" : "",
              related ? "is-related" : "", same ? "is-same" : "", wrong.has(index) ? "is-wrong" : "",
              celebrate.has(index) ? "is-celebrate" : "",
            ].filter(Boolean).join(" ")}
            style={{
              borderTopWidth: top ? 2 : 1,
              borderLeftWidth: left ? 2 : 1,
              borderRightWidth: right ? 2 : 0,
              borderBottomWidth: bottom ? 2 : 0,
            }}
            onClick={() => onSelect(index)}
          >
            {value ? <span>{value}</span> : (
              <span className="sudoku-notes">
                {Array.from({ length: 9 }, (_, i) => <i key={i}>{session.notes[index]?.includes(i + 1) ? i + 1 : ""}</i>)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ResultModal({ result, onNext, onReplay, onClose }) {
  if (!result) return null;
  return (
    <div className="sudoku-modal-backdrop" role="presentation">
      <div className="sudoku-result-card" role="dialog" aria-modal="true" aria-label="Рівень завершено">
        <button type="button" className="sudoku-close" onClick={onClose} aria-label="Закрити"><X size={18} /></button>
        <div className="sudoku-result-icon"><Trophy size={34} /></div>
        <div className="sudoku-eyebrow">РІВЕНЬ {result.level}</div>
        <h2>Логіку приборкано</h2>
        <div className="sudoku-stars" aria-label={`${result.stars} зірки`}>
          {[1, 2, 3].map((n) => <Star key={n} size={28} fill={n <= result.stars ? "currentColor" : "none"} className={n <= result.stars ? "on" : ""} />)}
        </div>
        <div className="sudoku-result-metrics">
          <div><span>Час</span><strong>{formatTime(result.elapsed)}</strong></div>
          <div><span>Помилки</span><strong>{result.errors}</strong></div>
          <div><span>Підказки</span><strong>{result.hints_used}</strong></div>
        </div>
        <div className="sudoku-reward-line">
          <Sparkles size={17} />
          <span>{result.first_completion ? `+${result.points_awarded} Point · +${result.xp_awarded} XP` : `Повторне проходження · +${result.xp_awarded} XP`}</span>
        </div>
        <div className="sudoku-result-actions">
          <button type="button" className="sudoku-secondary" onClick={onReplay}><RotateCcw size={17} /> Ще раз</button>
          <button type="button" className="sudoku-primary" onClick={onNext}>{result.level >= 50 ? "До рівнів" : "Наступний рівень"}<ChevronRight size={18} /></button>
        </div>
      </div>
    </div>
  );
}

export default function Sudoku() {
  const nav = useNavigate();
  const { user, refreshMe } = useApp();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ unlocked_level: 1, completions: [], active_session: null });
  const [screen, setScreen] = useState("catalog");
  const [mode, setMode] = useState("standard");
  const [session, setSession] = useState(null);
  const [result, setResult] = useState(null);
  const [showErrors, setShowErrors] = useState(true);
  const [multiNumber, setMultiNumber] = useState(null);
  const [celebrate, setCelebrate] = useState(new Set());
  const [failed, setFailed] = useState("");
  const saveTimer = useRef(null);
  const sessionRef = useRef(null);
  const holdTimer = useRef(null);
  const heldNumber = useRef(null);
  const completedRef = useRef(false);

  const currentLevel = useMemo(() => levels.find((item) => item.id === Number(session?.level_id)) || null, [session?.level_id]);
  const completions = useMemo(() => normalizeCompletions(status.completions), [status.completions]);
  const completedCount = Object.keys(completions).length;
  const totalStars = Object.values(completions).reduce((sum, item) => sum + Number(item.stars || 0), 0);
  const wrong = useMemo(() => {
    const set = new Set();
    if (!currentLevel || !session || !showErrors) return set;
    session.cells.forEach((value, index) => {
      if (!currentLevel.puzzle[index] && value && value !== currentLevel.solution[index]) set.add(index);
    });
    return set;
  }, [currentLevel, session, showErrors]);

  const persistLocal = useCallback((payload) => {
    if (!user?.id) return;
    try { localStorage.setItem(localKey(user.id), JSON.stringify(payload)); } catch (_) {}
  }, [user?.id]);

  const load = useCallback(async () => {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(localKey(user?.id)) || "null"); } catch (_) {}
    if (local?.status) setStatus(local.status);
    try {
      const { data } = await api.get("/games/sudoku/status");
      setStatus(data);
      persistLocal({ status: data, session: local?.session || null });
    } catch (error) {
      if (!local?.status) toast.error(extractError(error, "Не вдалося завантажити Судоку"));
    } finally {
      setLoading(false);
    }
  }, [persistLocal, user?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { sessionRef.current = session; }, [session]);

  // V112: gameplay owns the viewport. Lock the document so iOS/Android
  // rubber-band scrolling cannot move the board under the player's finger.
  useEffect(() => {
    if (screen !== "game") return undefined;
    const scrollY = window.scrollY;
    const previous = {
      htmlOverflow: document.documentElement.style.overflow,
      htmlOverscroll: document.documentElement.style.overscrollBehavior,
      bodyOverflow: document.body.style.overflow,
      bodyOverscroll: document.body.style.overscrollBehavior,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyWidth: document.body.style.width,
      bodyTouchAction: document.body.style.touchAction,
    };
    const preventViewportScroll = (event) => {
      if (event.cancelable) event.preventDefault();
    };
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.style.touchAction = "none";
    document.addEventListener("touchmove", preventViewportScroll, { passive: false });
    document.addEventListener("wheel", preventViewportScroll, { passive: false });
    return () => {
      document.removeEventListener("touchmove", preventViewportScroll);
      document.removeEventListener("wheel", preventViewportScroll);
      document.documentElement.style.overflow = previous.htmlOverflow;
      document.documentElement.style.overscrollBehavior = previous.htmlOverscroll;
      document.body.style.overflow = previous.bodyOverflow;
      document.body.style.overscrollBehavior = previous.bodyOverscroll;
      document.body.style.position = previous.bodyPosition;
      document.body.style.top = previous.bodyTop;
      document.body.style.width = previous.bodyWidth;
      document.body.style.touchAction = previous.bodyTouchAction;
      window.scrollTo(0, scrollY);
    };
  }, [screen]);

  useEffect(() => {
    if (!session || screen !== "game" || session.paused || result || failed) return undefined;
    const timer = window.setInterval(() => {
      setSession((previous) => previous ? { ...previous, elapsed: previous.elapsed + 1 } : previous);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [screen, session?.id, session?.paused, result, failed]);

  useEffect(() => {
    if (!session || !currentLevel || result || failed) return;
    if (session.mode === "timeAttack" && modeLimit(currentLevel.difficulty) - session.elapsed - session.errors * 20 - session.hints_used * 30 <= 0) {
      setFailed("Час вийшов. Сітка перемогла цього разу.");
      setSession((previous) => previous ? { ...previous, paused: true } : previous);
    }
  }, [session, currentLevel, result, failed]);

  useEffect(() => {
    if (!session || !currentLevel || completedRef.current) return;
    const solved = session.cells.every((value, index) => value === currentLevel.solution[index]);
    if (!solved) return;
    completedRef.current = true;
    const threshold = { easy: 300, medium: 600, hard: 900, expert: 1200 }[currentLevel.difficulty] || 900;
    const stars = session.errors === 0 && session.hints_used === 0 && (session.mode === "zen" || session.elapsed <= threshold)
      ? 3 : session.errors <= 2 && session.hints_used <= 1 ? 2 : 1;
    const run = async () => {
      let reward = { first_completion: !completions[currentLevel.id], points_awarded: !completions[currentLevel.id] ? 2 : 0, xp_awarded: !completions[currentLevel.id] ? 10 : 5 };
      try {
        const { data } = await api.post("/games/sudoku/complete", {
          session_id: session.id, level: currentLevel.id, cells: session.cells, elapsed: session.elapsed,
          errors: session.errors, hints_used: session.hints_used, notes_used: session.notes_used, stars,
        });
        reward = data.reward || reward;
        setStatus(data.status || status);
        await refreshMe().catch(() => {});
      } catch (error) {
        toast.error(extractError(error, "Рівень пройдено, але сервер не зберіг результат"));
        setStatus((previous) => ({
          ...previous,
          unlocked_level: Math.max(Number(previous.unlocked_level || 1), Math.min(50, currentLevel.id + 1)),
          active_session: null,
          completions: [
            ...(previous.completions || []).filter((item) => Number(item.level) !== currentLevel.id),
            { level: currentLevel.id, stars, best_time: session.elapsed, best_errors: session.errors },
          ].sort((a, b) => Number(a.level) - Number(b.level)),
        }));
      }
      setCelebrate(new Set(Array.from({ length: 81 }, (_, i) => i)));
      setResult({ level: currentLevel.id, stars, elapsed: session.elapsed, errors: session.errors, hints_used: session.hints_used, ...reward });
      persistLocal({ status, session: null });
    };
    run();
  }, [session?.cells, currentLevel, completions, persistLocal, refreshMe, session, status]);

  const saveRemote = useCallback((value) => {
    if (!value || completedRef.current || result) return;
    api.patch("/games/sudoku/session", {
      session_id: value.id, level: value.level_id, mode: value.mode, cells: value.cells,
      notes: value.notes, selected: value.selected, pencil: value.pencil, elapsed: value.elapsed,
      errors: value.errors, hints_used: value.hints_used, notes_used: value.notes_used,
    }).catch(() => {});
  }, [result]);

  useEffect(() => {
    if (!user?.id) return;
    if (completedRef.current || result) persistLocal({ status, session: null });
    else if (session) persistLocal({ status, session });
  }, [session, status, result, user?.id, persistLocal]);

  useEffect(() => {
    if (!session || !user?.id || result || completedRef.current) return undefined;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveRemote(sessionRef.current), SAVE_DELAY);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [
    session?.id, session?.cells, session?.notes, session?.selected, session?.pencil,
    session?.errors, session?.hints_used, session?.notes_used, user?.id, result, saveRemote,
  ]);

  useEffect(() => {
    if (!session?.id || result) return undefined;
    const interval = window.setInterval(() => saveRemote(sessionRef.current), 15_000);
    const onVisibility = () => { if (document.visibilityState === "hidden") saveRemote(sessionRef.current); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); };
  }, [session?.id, result, saveRemote]);

  const startLevel = useCallback(async (level, chosenMode = mode) => {
    if (level.id > Number(status.unlocked_level || 1)) return;
    setLoading(true);
    completedRef.current = false;
    setResult(null); setFailed(""); setCelebrate(new Set()); setMultiNumber(null);
    try {
      const { data } = await api.post("/games/sudoku/start", { level: level.id, mode: chosenMode });
      const next = createSession(level, chosenMode, data.session);
      setSession(next); setScreen("game");
      setStatus((previous) => ({ ...previous, active_session: data.session }));
    } catch (error) {
      const next = createSession(level, chosenMode);
      setSession(next); setScreen("game");
      toast.error(extractError(error, "Сесію збережено лише на цьому пристрої"));
    } finally { setLoading(false); }
  }, [mode, status.unlocked_level]);

  const continueGame = useCallback(() => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(localKey(user?.id)) || "null")?.session; } catch (_) {}
    if (!saved) saved = status.active_session;
    const level = levels.find((item) => item.id === Number(saved?.level_id || saved?.level));
    if (!saved || !level) return;
    completedRef.current = false;
    setSession(createSession(level, saved.mode || "standard", saved));
    setMode(saved.mode || "standard");
    setScreen("game"); setResult(null); setFailed("");
  }, [status.active_session, user?.id]);

  const pushAction = useCallback((updater) => {
    setSession((previous) => {
      if (!previous) return previous;
      const next = updater(previous);
      return { ...previous, ...next, history: [...previous.history, snapshot(previous)].slice(-100), future: [] };
    });
  }, []);

  const inputNumber = useCallback((value, forcedIndex = null, fromHint = false) => {
    if (!currentLevel || !session || session.paused || result || failed) return;
    const index = forcedIndex ?? session.selected;
    if (!Number.isInteger(index) || currentLevel.puzzle[index]) return;
    const wrongInput = value !== 0 && value !== currentLevel.solution[index];
    if (wrongInput && session.mode === "noMistakes") {
      setFailed("У режимі «Без помилок» перша хиба завершує спробу.");
      setSession((previous) => previous ? { ...previous, errors: previous.errors + 1, paused: true } : previous);
      return;
    }
    pushAction((previous) => {
      const cells = [...previous.cells];
      const notes = cloneNotes(previous.notes);
      let notesUsed = previous.notes_used;
      if (previous.pencil && value && !fromHint) {
        const current = new Set(notes[index]);
        if (current.has(value)) current.delete(value); else current.add(value);
        notes[index] = [...current].sort((a, b) => a - b);
        notesUsed = true;
        return { cells, notes, notes_used: notesUsed };
      }
      cells[index] = value;
      notes[index] = [];
      if (value && !wrongInput) getPeers(index, currentLevel.regions).forEach((peer) => { notes[peer] = notes[peer].filter((n) => n !== value); });
      return {
        cells, notes, notes_used: notesUsed,
        errors: previous.errors + (wrongInput ? 1 : 0),
        hints_used: previous.hints_used + (fromHint ? 1 : 0),
      };
    });
  }, [currentLevel, session, result, failed, pushAction]);

  const selectCell = useCallback((index) => {
    setSession((previous) => previous ? { ...previous, selected: index } : previous);
    if (multiNumber !== null && currentLevel && !currentLevel.puzzle[index]) inputNumber(multiNumber, index);
  }, [multiNumber, currentLevel, inputNumber]);

  const undo = () => setSession((previous) => {
    const prior = previous?.history?.at(-1); if (!prior) return previous;
    return { ...previous, ...prior, notes: cloneNotes(prior.notes), history: previous.history.slice(0, -1), future: [snapshot(previous), ...previous.future].slice(0, 100) };
  });
  const redo = () => setSession((previous) => {
    const next = previous?.future?.[0]; if (!next) return previous;
    return { ...previous, ...next, notes: cloneNotes(next.notes), history: [...previous.history, snapshot(previous)].slice(-100), future: previous.future.slice(1) };
  });

  const useHint = () => {
    if (!currentLevel || !session) return;
    if (session.hints_used >= Number(currentLevel.hints || 0)) return toast.error("Підказки цього рівня закінчилися");
    const selected = session.selected;
    const index = Number.isInteger(selected) && !currentLevel.puzzle[selected] && session.cells[selected] !== currentLevel.solution[selected]
      ? selected : session.cells.findIndex((value, i) => !currentLevel.puzzle[i] && value !== currentLevel.solution[i]);
    if (index < 0) return;
    inputNumber(currentLevel.solution[index], index, true);
    setSession((previous) => previous ? { ...previous, selected: index } : previous);
  };

  const checkBoard = () => {
    if (!currentLevel || !session) return;
    const bad = session.cells.filter((value, index) => !currentLevel.puzzle[index] && value && value !== currentLevel.solution[index]).length;
    const empty = session.cells.filter((value) => !value).length;
    if (bad) toast.error(`Є помилки: ${bad}`);
    else if (empty) toast.success(`Усе правильно. Залишилося клітинок: ${empty}`);
    else toast.success("Поле заповнене правильно");
  };

  const restart = async (force = false) => {
    if (!currentLevel || (!force && !window.confirm("Почати рівень заново?"))) return;
    completedRef.current = false;
    setFailed(""); setResult(null); setMultiNumber(null); setCelebrate(new Set());
    try {
      const { data } = await api.post("/games/sudoku/start", { level: currentLevel.id, mode: session?.mode || mode, restart: true });
      setSession(createSession(currentLevel, session?.mode || mode, data.session));
      setStatus((previous) => ({ ...previous, active_session: data.session }));
    } catch (error) {
      setSession(createSession(currentLevel, session?.mode || mode));
      toast.error(extractError(error, "Нову спробу збережено лише на цьому пристрої"));
    }
  };

  const exitGame = () => { setScreen("catalog"); setSession(null); setResult(null); setFailed(""); setMultiNumber(null); };
  const nextAfterResult = () => {
    const next = levels.find((item) => item.id === result?.level + 1);
    setResult(null); setCelebrate(new Set());
    if (next && next.id <= Number(status.unlocked_level || result.level + 1)) startLevel(next, mode);
    else exitGame();
  };

  const onNumberDown = (number) => {
    heldNumber.current = null;
    holdTimer.current = window.setTimeout(() => {
      heldNumber.current = number;
      setMultiNumber((current) => current === number ? null : number);
      navigator.vibrate?.(18);
    }, 430);
  };
  const onNumberUp = (number) => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    if (heldNumber.current === number) { heldNumber.current = null; return; }
    setMultiNumber(null); inputNumber(number);
  };

  if (loading && !status.completions?.length && !session) {
    return <div className="sudoku-page sudoku-loading"><div className="sudoku-spinner" /><strong>Готуємо 50 рівнів…</strong></div>;
  }

  if (screen === "game" && currentLevel && session) {
    const limit = modeLimit(currentLevel.difficulty);
    const timeLeft = Math.max(0, limit - session.elapsed - session.errors * 20 - session.hints_used * 30);
    return (
      <div className="sudoku-page sudoku-game-page">
        <div className="sudoku-game-head">
          <button type="button" className="sudoku-icon-btn" onClick={exitGame} aria-label="До рівнів"><ArrowLeft size={20} /></button>
          <div className="sudoku-game-title"><span>РІВЕНЬ {currentLevel.id} · {difficultyLabels[currentLevel.difficulty]}</span><strong>{currentLevel.title}</strong></div>
          <button type="button" className="sudoku-icon-btn" onClick={() => setSession((p) => ({ ...p, paused: !p.paused }))} aria-label="Пауза"><Pause size={19} /></button>
        </div>

        <div className="sudoku-game-stats">
          <div><Clock3 size={15} /><span>{session.mode === "timeAttack" ? formatTime(timeLeft) : session.mode === "zen" ? "Дзен" : formatTime(session.elapsed)}</span></div>
          <div><Flag size={15} /><span>{session.errors} пом.</span></div>
          <div><Lightbulb size={15} /><span>{Math.max(0, Number(currentLevel.hints || 0) - session.hints_used)}</span></div>
        </div>

        <div className="sudoku-board-area">
          <section className="sudoku-board-shell">
            <SudokuBoard level={currentLevel} session={session} wrong={wrong} celebrate={celebrate} onSelect={selectCell} />
          </section>
          {multiNumber !== null && (
            <div className="sudoku-multifill" role="status" aria-live="polite">
              <Grid3X3 size={15} />
              <span>Мультизаповнення: {multiNumber}</span>
              <button type="button" onClick={() => setMultiNumber(null)} aria-label="Вимкнути мультизаповнення"><X size={14} /></button>
            </div>
          )}
        </div>

        <div className="sudoku-tools">
          <button type="button" onClick={undo} disabled={!session.history.length}><Undo2 size={19} /><span>Назад</span></button>
          <button type="button" onClick={redo} disabled={!session.future.length}><Redo2 size={19} /><span>Вперед</span></button>
          <button type="button" className={session.pencil ? "active" : ""} onClick={() => setSession((p) => ({ ...p, pencil: !p.pencil }))}><Pencil size={19} /><span>Нотатки</span></button>
          <button type="button" onClick={useHint} disabled={Number(currentLevel.hints || 0) <= session.hints_used}><Lightbulb size={19} /><span>Підказка</span></button>
          <button type="button" onClick={checkBoard}><Check size={19} /><span>Перевірити</span></button>
        </div>

        <div className={`sudoku-keypad ${session.pencil ? "pencil" : ""}`}>
          {Array.from({ length: 9 }, (_, i) => i + 1).map((number) => (
            <button
              type="button" key={number} className={multiNumber === number ? "multi-active" : ""}
              onPointerDown={() => onNumberDown(number)} onPointerUp={() => onNumberUp(number)}
              onPointerCancel={() => { if (holdTimer.current) window.clearTimeout(holdTimer.current); }}
              onContextMenu={(event) => event.preventDefault()}
            >{number}</button>
          ))}
          <button type="button" className="erase" onClick={() => inputNumber(0)} aria-label="Стерти"><Eraser size={21} /></button>
        </div>
        <button type="button" className="sudoku-restart" onClick={() => restart(false)}><RefreshCcw size={15} /> Почати рівень заново</button>

        {session.paused && !failed && (
          <div className="sudoku-pause-overlay"><div><Pause size={38} /><h2>Пауза</h2><p>Поле приховано, таймер зупинено.</p><button type="button" className="sudoku-primary" onClick={() => setSession((p) => ({ ...p, paused: false }))}><Play size={18} /> Продовжити</button></div></div>
        )}
        {failed && (
          <div className="sudoku-pause-overlay"><div><Brain size={38} /><h2>Спробу завершено</h2><p>{failed}</p><button type="button" className="sudoku-primary" onClick={() => restart(true)}><RotateCcw size={18} /> Почати знову</button><button type="button" className="sudoku-text-btn" onClick={exitGame}>До рівнів</button></div></div>
        )}
        <ResultModal result={result} onNext={nextAfterResult} onReplay={() => restart(true)} onClose={exitGame} />
      </div>
    );
  }

  return (
    <div className="sudoku-page">
      <section className="sudoku-hero">
        <button type="button" className="sudoku-back" onClick={() => nav("/")}><ArrowLeft size={19} /></button>
        <div className="sudoku-hero-copy">
          <span className="sudoku-eyebrow">ЛОГІЧНА ГРА · 50 РІВНІВ</span>
          <h1>VPDK <b>SUDOKU</b></h1>
          <p>Спокійна сітка, гостра логіка. Прогрес синхронізується з акаунтом, а незавершений рівень можна продовжити.</p>
        </div>
        <div className="sudoku-crown"><Crown size={29} /></div>
      </section>

      <section className="sudoku-progress-card">
        <div className="sudoku-progress-ring" style={{ "--value": `${Math.round(completedCount / 50 * 360)}deg` }}><strong>{Math.round(completedCount / 50 * 100)}%</strong><span>пройдено</span></div>
        <div className="sudoku-progress-copy">
          <div><span>Рівні</span><strong>{completedCount}/50</strong></div>
          <div><span>Зірки</span><strong>{totalStars}/150</strong></div>
          <div><span>Відкрито</span><strong>{status.unlocked_level || 1}</strong></div>
        </div>
      </section>

      {(status.active_session || (() => { try { return JSON.parse(localStorage.getItem(localKey(user?.id)) || "null")?.session; } catch (_) { return null; } })()) && (
        <button type="button" className="sudoku-continue" onClick={continueGame}>
          <div><Play size={20} fill="currentColor" /></div><span><small>НЕЗАВЕРШЕНА ГРА</small><strong>Продовжити рівень</strong></span><ChevronRight size={19} />
        </button>
      )}

      <section className="sudoku-mode-card">
        <div className="sudoku-section-title"><div><span>РЕЖИМ ГРИ</span><h2>Обери ритм</h2></div><Brain size={22} /></div>
        <div className="sudoku-modes">
          {Object.entries(modeLabels).map(([id, label]) => <button type="button" key={id} className={mode === id ? "active" : ""} onClick={() => setMode(id)}>{label}</button>)}
        </div>
        <p>{{ standard: "Таймер, перевірка помилок і підказки рівня.", zen: "Без тиску часу та штрафів.", timeAttack: "Зворотний відлік, помилки й підказки забирають час.", noMistakes: "Перша неправильна цифра завершує спробу." }[mode]}</p>
      </section>

      <section className="sudoku-levels">
        <div className="sudoku-section-title"><div><span>КАМПАНІЯ</span><h2>50 логічних рівнів</h2></div><Medal size={23} /></div>
        {Array.from({ length: 5 }, (_, sectionIndex) => {
          const sectionLevels = levels.slice(sectionIndex * 10, sectionIndex * 10 + 10);
          return (
            <div className="sudoku-chapter" key={sectionIndex}>
              <div className="sudoku-chapter-head"><span>0{sectionIndex + 1}</span><div><strong>{sectionNames[sectionIndex]}</strong><small>Рівні {sectionIndex * 10 + 1}–{sectionIndex * 10 + 10}</small></div></div>
              <div className="sudoku-level-grid">
                {sectionLevels.map((level) => {
                  const locked = level.id > Number(status.unlocked_level || 1);
                  const completion = completions[level.id];
                  return (
                    <button type="button" key={level.id} className={`sudoku-level-card ${locked ? "locked" : ""} ${completion ? "completed" : ""}`} disabled={locked} onClick={() => startLevel(level)}>
                      <div className="sudoku-level-top"><span>{String(level.id).padStart(2, "0")}</span>{locked ? <Lock size={16} /> : completion ? <div className="sudoku-mini-stars">{[1,2,3].map((n)=><Star key={n} size={10} fill={n<=completion.stars?"currentColor":"none"}/>)}</div> : <Play size={15} />}</div>
                      <strong>{level.title}</strong>
                      <small>{typeLabels[level.type]} · {difficultyLabels[level.difficulty]}</small>
                      <div className="sudoku-clue-line"><i style={{ width: `${Math.max(15, level.clues / 45 * 100)}%`, background: level.accent }} /></div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      <section className="sudoku-tip"><Grid3X3 size={22} /><div><strong>Мультизаповнення</strong><p>Затисни цифру на клавіатурі, а потім торкайся кількох клітинок поспіль.</p></div></section>
    </div>
  );
}
