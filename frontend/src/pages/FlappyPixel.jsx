import { PixelGameLink, PixelGameReward, usePixelOrigin } from "@/components/PixelGameBridge";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, ChevronRight, Flag, Home, LockKeyhole, Pause, RotateCcw, Volume2, VolumeX, WifiOff } from "lucide-react";
import api, { extractError } from "@/lib/api";
import { createFlight, stepFlight } from "@/games/flappy/engine";
import { drawFlight } from "@/games/flappy/renderer";
import "@/games/flappy/flappy.css";

const newRequestId = () => globalThis.crypto?.randomUUID?.() || `flight-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const ART = "/pet/room/v6/rig/sit-poster.webp";

export default function FlappyPixel() {
  const navigate = useNavigate();
  const fromPixel = usePixelOrigin();
  const returnToPixel = () => navigate("/pet/room");
  const [progress, setProgress] = useState(null), [selected, setSelected] = useState(1);
  const [phase, setPhase] = useState("loading"), phaseRef = useRef("loading");
  const [error, setError] = useState(""), [online, setOnline] = useState(navigator.onLine);
  const [art, setArt] = useState(null), [artError, setArtError] = useState(false), [artRetry, setArtRetry] = useState(0);
  const [hud, setHud] = useState(0), [countdown, setCountdown] = useState(3), [outcome, setOutcome] = useState(null);
  const [sound, setSound] = useState(false), [reduced, setReduced] = useState(false);
  const canvasRef = useRef(null), inputRef = useRef(null), runtime = useRef(null), session = useRef(null);
  const pending = useRef(false), attempt = useRef(null), startRequest = useRef(null), mounted = useRef(false), audio = useRef(null);
  const level = progress?.levels.find(item => item.id === selected);
  const transition = useCallback(next => { phaseRef.current = next; setPhase(next); }, []);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; audio.current?.close().catch(() => {}); }; }, []);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    update(); preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let current = true; const image = new Image();
    setArtError(false);
    const timer = setTimeout(() => { if (current) setArtError(true); }, 10000);
    image.onload = () => { clearTimeout(timer); if (current) { setArt(image); setArtError(false); } };
    image.onerror = () => { clearTimeout(timer); if (current) setArtError(true); };
    image.src = ART;
    return () => { current = false; clearTimeout(timer); image.onload = null; image.onerror = null; };
  }, [artRetry]);

  const load = useCallback(async () => {
    if (pending.current) return;
    pending.current = true; setError(""); transition("loading");
    try {
      const { data } = await api.get("/games/flappy/status");
      if (!mounted.current) return;
      if (data.version !== 1 || !Array.isArray(data.levels) || !data.levels.length) throw new Error("Оновіть застосунок: версія гри змінилася");
      setProgress(data); setSelected(data.unlocked_level); transition("map");
    } catch (err) { if (mounted.current) { setError(extractError(err)); transition("load-error"); } }
    finally { pending.current = false; }
  }, [transition]);
  useEffect(() => { void load(); }, [load]);

  const pause = useCallback(() => {
    if (["playing", "countdown"].includes(phaseRef.current)) { if (runtime.current) runtime.current.pending = false; transition("paused"); }
    audio.current?.suspend().catch(() => {});
  }, [transition]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) pause(); };
    const disconnected = () => { setOnline(false); pause(); };
    const connected = () => setOnline(true);
    document.addEventListener("visibilitychange", hidden); window.addEventListener("blur", pause);
    window.addEventListener("offline", disconnected); window.addEventListener("online", connected);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("blur", pause); window.removeEventListener("offline", disconnected); window.removeEventListener("online", connected); };
  }, [pause]);

  const chirp = useCallback(() => {
    if (!sound) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audio.current ||= new AudioContext();
      const context = audio.current; void context.resume().catch(() => {});
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = "sine"; oscillator.frequency.setValueAtTime(440, context.currentTime); oscillator.frequency.exponentialRampToValueAtTime(720, context.currentTime + .08);
      gain.gain.setValueAtTime(.035, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .12);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .12);
    } catch (_) { /* Sound is optional; a rejected audio context must not stop flight. */ }
  }, [sound]);

  const submit = useCallback(async () => {
    if (pending.current || !attempt.current || !session.current) return;
    pending.current = true; setError(""); transition("saving");
    try {
      const { data } = await api.post(`/games/flappy/sessions/${session.current.session_id}/finish`, attempt.current);
      if (!mounted.current) return;
      setOutcome(data.outcome); setProgress(data.progress); transition("result");
    } catch (err) { if (mounted.current) { setError(extractError(err)); transition("save-error"); } }
    finally { pending.current = false; }
  }, [transition]);

  const begin = async () => {
    if (pending.current || !online || !art || !level) return;
    pending.current = true; setError(""); transition("starting");
    if (!startRequest.current || startRequest.current.level !== selected) startRequest.current = { level: selected, request_id: newRequestId() };
    try {
      const { data } = await api.post("/games/flappy/start", startRequest.current);
      if (!mounted.current) return;
      if (data.level?.version !== 1 || data.level.id !== selected) throw new Error("Оновіть сторінку: сценарій гри змінився");
      session.current = data;
      runtime.current = { state: createFlight(data.level), flaps: [], pending: false };
      attempt.current = null; startRequest.current = null;
      setHud(0); setOutcome(null); setCountdown(3);
      transition(navigator.onLine && !document.hidden ? "countdown" : "paused");
    } catch (err) {
      if (err?.response?.status === 409) startRequest.current = null;
      if (mounted.current) { setError(extractError(err)); transition("ready"); }
    } finally { pending.current = false; }
  };
  const resume = () => {
    if (!online) return;
    if (Date.parse(session.current?.expires_at || "") <= Date.now()) { setError("Час сесії минув. Почніть цей рівень знову"); transition("ready"); return; }
    setCountdown(3); transition("countdown");
  };
  useEffect(() => {
    if (phase !== "countdown") return undefined;
    let remaining = 3;
    const timer = setInterval(() => {
      remaining -= 1;
      if (!remaining) { clearInterval(timer); transition("playing"); }
      else setCountdown(remaining);
    }, 700);
    return () => clearInterval(timer);
  }, [phase, transition]);

  const redraw = useCallback(() => {
    const preview = ["map", "ready", "starting"].includes(phase);
    drawFlight(canvasRef.current, session.current?.level?.id === selected && !preview ? session.current.level : level,
      runtime.current?.state, art, { preview, reduced });
  }, [phase, level, selected, art, reduced]);
  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const canvas = canvasRef.current;
    const resize = () => { const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr)); redraw(); };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    return () => observer.disconnect();
  }, [redraw]);

  useEffect(() => {
    if (phase !== "playing" || !runtime.current || !session.current) return undefined;
    inputRef.current?.focus({ preventScroll: true });
    let frame, previous = 0, accumulator = 0;
    const tick = timestamp => {
      if (phaseRef.current !== "playing") return;
      if (previous && timestamp - previous > 500) { pause(); return; }
      if (!previous) previous = timestamp;
      accumulator += Math.min(timestamp - previous, 100); previous = timestamp;
      const run = runtime.current, config = session.current.level;
      while (accumulator >= 1000 / 60 && run.state.status === "playing") {
        const flap = run.pending && run.state.tick - run.state.last_flap >= config.physics.min_flap_ticks;
        run.pending = false;
        if (flap) run.flaps.push(run.state.tick);
        stepFlight(config, run.state, flap); accumulator -= 1000 / 60;
      }
      drawFlight(canvasRef.current, config, run.state, art, { reduced });
      setHud(previousHud => previousHud === run.state.passed ? previousHud : run.state.passed);
      if (run.state.status !== "playing") {
        attempt.current = { ticks: run.state.tick, flaps: [...run.flaps] };
        setOutcome({ ...run.state }); void submit(); return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, art, reduced, pause, submit]);

  const flap = () => { if (phaseRef.current !== "playing" || !runtime.current) return; const run = runtime.current; if (run.state.tick - run.state.last_flap < session.current.level.physics.min_flap_ticks || run.pending) return; run.pending = true; chirp(); };
  const flapPointer = event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); flap(); };
  const key = event => {
    if (event.code === "Escape") { if (phaseRef.current === "playing") pause(); return; }
    if (phaseRef.current === "playing" && ["Space", "ArrowUp"].includes(event.code) && event.target.hasAttribute("data-flap")) { event.preventDefault(); if (!event.repeat) flap(); }
  };
  const toMap = () => { if (pending.current) return; runtime.current = null; session.current = null; attempt.current = null; startRequest.current = null; setError(""); transition("map"); };
  const choose = id => { setSelected(id); runtime.current = null; session.current = null; startRequest.current = null; setError(""); transition("ready"); };
  const back = () => { if (pending.current) return; if (["playing", "countdown"].includes(phaseRef.current)) pause(); else if (phase === "map" || phase === "load-error") navigate(fromPixel ? "/pet/room" : "/"); else toMap(); };
  const active = ["playing", "paused", "countdown", "saving", "save-error", "result"].includes(phase);
  const busy = ["starting", "saving", "loading"].includes(phase);
  const finishedCampaign = progress?.completed.length === progress?.levels.length;

  return <section className="flappy-page" onKeyDown={key} data-testid="flappy-page">
    <div className="flappy-shell">
      <PixelGameLink enabled={fromPixel && ["map", "ready"].includes(phase)} onReturn={returnToPixel} disabled={pending.current} />
      <header className="flappy-header"><button type="button" className="flappy-icon" onClick={back} disabled={busy} aria-label={phase === "map" ? "На головну" : "Назад"}><ArrowLeft size={20} /></button><div><small>НЕБЕСНА ПРИГОДА</small><h1>Flappy Піксель</h1></div><button type="button" className="flappy-icon" onClick={() => { if (sound) audio.current?.suspend().catch(() => {}); setSound(!sound); }} aria-label={sound ? "Вимкнути звук" : "Увімкнути звук"} aria-pressed={sound}>{sound ? <Volume2 size={19} /> : <VolumeX size={19} />}</button></header>
      {!online && <p className="flappy-warning" role="status"><WifiOff size={16} /> Немає інтернету. Політ призупинено; прогрес потребує з’єднання.</p>}
      {phase === "loading" && <div className="flappy-empty" role="status">Завантажуємо небесну карту…</div>}
      {phase === "load-error" && <div className="flappy-empty"><p role="alert">{error}</p><button className="flappy-primary" onClick={load}>Спробувати ще раз</button></div>}
      {phase === "map" && progress && <div className="flappy-map" data-testid="flappy-map">
        <div className="flappy-map-hero"><div><small>ТВІЙ ШЛЯХ У НЕБІ</small><h2>{finishedCampaign ? "Усі світи відкрито!" : "Від хмаринки до зірок"}</h2><p>{progress.completed.length} із {progress.levels.length} рівнів пройдено</p></div><img src={ART} alt="Піксель" onError={e => { e.currentTarget.hidden = true; }} /></div>
        <button className="flappy-primary flappy-continue" onClick={() => choose(progress.unlocked_level)}>{finishedCampaign ? "Переграти фінал" : `Продовжити · рівень ${progress.unlocked_level}`}<ChevronRight size={18} /></button>
        {[1, 2, 3].map(world => { const levels = progress.levels.filter(item => item.world === world); return <section key={world} className={`flappy-world flappy-world-${world}`}><div className="flappy-world-title"><span>0{world}</span><h3>{levels[0].world_name}</h3></div><div className="flappy-levels">{levels.map(item => { const completed = progress.completed.includes(item.id), locked = item.id > progress.unlocked_level; return <button type="button" key={item.id} disabled={locked} className={`flappy-level ${completed ? "completed" : ""} ${item.id === progress.unlocked_level ? "current" : ""}`} aria-label={`Рівень ${item.id}: ${item.name}${locked ? ", заблоковано" : completed ? ", пройдено" : ""}`} onClick={() => choose(item.id)} data-testid={`flappy-level-${item.id}`}><span className="flappy-level-number">{locked ? <LockKeyhole size={18} /> : completed ? <Check size={22} /> : item.id}</span><strong>{item.id}. {item.name}</strong><small>{completed ? "Пройдено" : `${item.gate_count} воріт`}</small></button>; })}</div></section>; })}
        <p className="flappy-map-note">Долітай до фінішу, щоб відкрити наступний рівень. Пройдені маршрути можна перегравати.</p>
      </div>}
      {level && !["loading", "load-error", "map"].includes(phase) && <div className="flappy-game">
        <div className="flappy-level-heading"><span>РІВЕНЬ {level.id} / {progress.levels.length}</span><strong>{level.name}</strong></div>
        <div className="flappy-stage">
          <canvas ref={canvasRef} width="720" height="960" role="img" aria-label={`${level.world_name}: Піксель летить на хмаринці між вежами-дряпками`} />
          {phase === "playing" && <button ref={inputRef} type="button" className="flappy-field" data-flap="field" onPointerDown={flapPointer} onClick={event => { if (event.detail === 0) flap(); }} aria-label="Торкнись або натисни пробіл, щоб підлетіти" />}
          {active && <div className="flappy-hud"><div><small>ВОРОТА</small><strong>{hud}<span> / {level.gate_count}</span></strong></div><div className="flappy-distance"><Flag size={14} /><progress max={level.gate_count} value={hud} aria-label="Пройдено воріт" /></div>{phase === "playing" && <button className="flappy-icon" aria-label="Пауза" onClick={pause}><Pause size={18} /></button>}</div>}
          {["ready", "starting"].includes(phase) && <div className="flappy-start"><small>{level.world_name}</small><h2>Flappy<span>Піксель</span></h2><p>Маленькі лапки. Велике небо.</p><div className="flappy-start-bottom"><span>{level.gate_count} воріт до фінішу · без таймера</span><button type="button" className="flappy-primary" onClick={begin} disabled={busy || !online || !art}>{phase === "starting" ? "Готуємо політ…" : !art && !artError ? "Завантажуємо Пікселя…" : "Полетіли!"}</button><small>Торкнись поля або натисни пробіл</small></div></div>}
          {phase === "countdown" && <div className="flappy-countdown" role="status"><strong>{countdown}</strong><span>Приготуйся змахнути</span></div>}
          {phase === "paused" && <div className="flappy-overlay"><div className="flappy-dialog" role="dialog" aria-modal="true" aria-label="Пауза"><small>МОЖНА ПЕРЕВЕСТИ ПОДИХ</small><h2>Хмаринка зачекає</h2><p>Продовжимо з того самого місця.</p><button className="flappy-primary" onClick={resume} disabled={!online}>Продовжити</button><button className="flappy-secondary" onClick={toMap}>До рівнів</button></div></div>}
          {["result", "saving", "save-error"].includes(phase) && outcome && <div className="flappy-overlay"><div className="flappy-dialog" role="dialog" aria-modal="true" aria-label="Результат польоту">
            <small>{outcome.status === "completed" ? "М’ЯКЕ ПРИЗЕМЛЕННЯ" : "ЩЕ ОДИН ЗМАХ — І ВИЙДЕ"}</small><h2>{outcome.status === "completed" ? "Рівень пройдено!" : "Спробуй ще!"}</h2>
            <div className="flappy-result-number">{outcome.passed}<span>із {level.gate_count} воріт</span></div>
            <p className="flappy-result-note" role="status">{phase === "saving" ? "Перевіряємо й зберігаємо політ…" : phase === "save-error" ? "Прогрес ще не збережено" : outcome.status === "completed" ? level.id === progress.levels.length ? "Ти підкорив усі 12 маршрутів!" : `Рівень ${level.id + 1} відкрито` : `Найкращий результат: ${progress.best[String(level.id)] || 0} воріт`}</p>
            {phase === "save-error" && <><p className="flappy-dialog-error" role="alert">{error}</p><button className="flappy-primary" onClick={submit} disabled={!online}>Надіслати ще раз</button><button className="flappy-secondary" onClick={toMap}>До рівнів без збереження</button></>}
            <PixelGameReward enabled={fromPixel && phase === "result" && outcome?.status === "completed"} game="flappy" sessionId={session.current?.session_id} onReturn={returnToPixel} />
            {phase === "result" && <>{outcome.status === "completed" && level.id < progress.levels.length ? <button className="flappy-primary" onClick={() => choose(level.id + 1)}>Наступний рівень <ChevronRight size={18} /></button> : <button className="flappy-primary" onClick={begin} disabled={!online}><RotateCcw size={17} />{outcome.status === "completed" ? "Переграти рівень" : "Ще раз"}</button>}<button className="flappy-secondary" onClick={toMap}>До рівнів</button></>}
          </div></div>}
        </div>
        {phase === "playing" && <div className="flappy-input-row"><span>Торкнись поля або натисни пробіл</span><button type="button" data-flap="button" className="flappy-primary" onPointerDown={flapPointer} onClick={event => { if (event.detail === 0) flap(); }}>Змах ↑</button></div>}
        {error && phase === "ready" && <p className="flappy-warning" role="alert">{error}</p>}
        {artError && <div className="flappy-warning" role="alert">Не вдалося завантажити Пікселя.<button onClick={() => setArtRetry(value => value + 1)}>Повторити</button></div>}
        <p className="flappy-game-note">{phase === "ready" ? "Один дотик — один змах. Пролети між усіма дряпками." : phase === "result" ? "Прогрес збережено. Можна повернутися до пригоди пізніше." : "Твій прогрес збережеться після перевірки польоту."}</p>
      </div>}
      {phase === "map" && <button type="button" className="flappy-home-link" onClick={() => navigate(fromPixel ? "/pet/room" : "/")}><Home size={16} /> {fromPixel ? "До кімнати Пікселя" : "На головну"}</button>}
    </div>
  </section>;
}
