import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Coins,
  Dice5,
  Gamepad2,
  Gift,
  Heart,
  RotateCcw,
  Sparkles,
  Star,
  Trophy,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import AvatarFrame from "@/components/AvatarFrame";

const ROWS = 7;
const COLS = 7;
const SYMBOLS = ["coin", "star", "gift", "cube", "zap", "trophy"];

const PIECES = {
  coin: { Icon: Coins, label: "Монета", color: "#FFB800", background: "linear-gradient(145deg,#5B3A00,#231700)" },
  star: { Icon: Star, label: "Зірка", color: "#35B8FF", background: "linear-gradient(145deg,#073F69,#07182A)" },
  gift: { Icon: Gift, label: "Подарунок", color: "#F64CFF", background: "linear-gradient(145deg,#5A145F,#210923)" },
  cube: { Icon: Dice5, label: "Куб", color: "#39FF14", background: "linear-gradient(145deg,#176408,#092506)" },
  zap: { Icon: Zap, label: "Блискавка", color: "#FF5C00", background: "linear-gradient(145deg,#6B2400,#260D00)" },
  trophy: { Icon: Trophy, label: "Трофей", color: "#B78CFF", background: "linear-gradient(145deg,#442878,#170C2B)" },
};

const mockConfig = (level) => {
  const safeLevel = Math.max(1, Math.min(50, Number(level || 1)));
  const targetScore = 900 + safeLevel * 260;
  return {
    level: safeLevel,
    moves: Math.max(17, 23 - Math.floor((safeLevel - 1) / 6)),
    target_score: targetScore,
    target_coins: 6 + Math.floor((safeLevel + 1) / 2),
    star_thresholds: [targetScore, Math.floor(targetScore * 1.35), Math.floor(targetScore * 1.72)],
  };
};

const findMatches = (board) => {
  const matched = new Set();
  for (let row = 0; row < board.length; row += 1) {
    let start = 0;
    while (start < board[row].length) {
      let end = start + 1;
      while (end < board[row].length && board[row][end] === board[row][start]) end += 1;
      if (board[row][start] && end - start >= 3) {
        for (let col = start; col < end; col += 1) matched.add(`${row}:${col}`);
      }
      start = end;
    }
  }
  for (let col = 0; col < COLS; col += 1) {
    let start = 0;
    while (start < board.length) {
      let end = start + 1;
      while (end < board.length && board[end][col] === board[start][col]) end += 1;
      if (board[start][col] && end - start >= 3) {
        for (let row = start; row < end; row += 1) matched.add(`${row}:${col}`);
      }
      start = end;
    }
  }
  return matched;
};

const hasPossibleMove = (board) => {
  const copy = board.map((row) => [...row]);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const nextRow = row + dr;
        const nextCol = col + dc;
        if (nextRow >= ROWS || nextCol >= COLS) continue;
        [copy[row][col], copy[nextRow][nextCol]] = [copy[nextRow][nextCol], copy[row][col]];
        const valid = findMatches(copy).size > 0;
        [copy[row][col], copy[nextRow][nextCol]] = [copy[nextRow][nextCol], copy[row][col]];
        if (valid) return true;
      }
    }
  }
  return false;
};

const makeMockBoard = () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const board = [];
    for (let row = 0; row < ROWS; row += 1) {
      board.push([]);
      for (let col = 0; col < COLS; col += 1) {
        const blocked = new Set();
        if (col >= 2 && board[row][col - 1] === board[row][col - 2]) blocked.add(board[row][col - 1]);
        if (row >= 2 && board[row - 1][col] === board[row - 2][col]) blocked.add(board[row - 1][col]);
        const options = SYMBOLS.filter((symbol) => !blocked.has(symbol));
        board[row].push(options[Math.floor(Math.random() * options.length)]);
      }
    }
    if (hasPossibleMove(board)) return board;
  }
  return Array.from({ length: ROWS }, (_, row) => Array.from({ length: COLS }, (_, col) => SYMBOLS[(row * 2 + col * 3) % SYMBOLS.length]));
};

const collapseMockBoard = (board) => {
  const result = board.map((row) => [...row]);
  for (let col = 0; col < COLS; col += 1) {
    const values = [];
    for (let row = 0; row < ROWS; row += 1) {
      if (result[row][col]) values.push(result[row][col]);
    }
    const missing = ROWS - values.length;
    const fresh = Array.from({ length: missing }, () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
    [...fresh, ...values].forEach((value, row) => { result[row][col] = value; });
  }
  return result;
};

const runMockMove = (game, from, to) => {
  let board = game.board.map((row) => [...row]);
  [board[from.row][from.col], board[to.row][to.col]] = [board[to.row][to.col], board[from.row][from.col]];
  let matches = findMatches(board);
  if (!matches.size) return { valid: false, message: "Цей хід не створює комбінацію", session: game };

  let scoreGain = 0;
  let coinsGain = 0;
  let cascades = 0;
  while (matches.size && cascades < 12) {
    cascades += 1;
    const cells = [...matches].map((key) => key.split(":").map(Number));
    coinsGain += cells.filter(([row, col]) => board[row][col] === "coin").length;
    scoreGain += matches.size * 100 + Math.max(0, matches.size - 3) * 70 + (cascades - 1) * 90;
    cells.forEach(([row, col]) => { board[row][col] = null; });
    board = collapseMockBoard(board);
    matches = findMatches(board);
  }
  if (!hasPossibleMove(board)) board = makeMockBoard();

  const score = game.score + scoreGain;
  const coins = game.coins_collected + coinsGain;
  const moves = Math.max(0, game.moves_left - 1);
  const won = score >= game.config.target_score && coins >= game.config.target_coins;
  const status = won ? "won" : moves === 0 ? "lost" : "active";
  const stars = won ? (score >= game.config.star_thresholds[2] ? 3 : score >= game.config.star_thresholds[1] ? 2 : 1) : 0;
  return {
    valid: true,
    message: `+${scoreGain} очок`,
    score_gain: scoreGain,
    coins_gain: coinsGain,
    cascade_count: cascades,
    session: { ...game, board, score, coins_collected: coins, moves_left: moves, status },
    result: status === "active" ? null : {
      stars,
      points_awarded: won ? [0, 2, 4, 7][stars] + 5 : 0,
      xp_awarded: won ? [0, 5, 10, 15][stars] : 0,
      first_win_bonus: won ? 5 : 0,
      lives: won ? 5 : 4,
      current_level: won ? game.level + 1 : game.level,
      total_stars: won ? stars : 0,
      first_completion: won,
    },
  };
};

const formatNumber = (value) => Number(value || 0).toLocaleString("uk-UA");

function Piece({ type, selected, disabled, onClick, row, col }) {
  const config = PIECES[type] || PIECES.star;
  const Icon = config.Icon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${config.label}, рядок ${row + 1}, колонка ${col + 1}`}
      className={`relative flex aspect-square min-w-0 touch-manipulation items-center justify-center overflow-hidden rounded-[11px] border transition-all duration-150 active:scale-90 ${selected ? "z-10 scale-110 border-white shadow-[0_0_20px_rgba(183,140,255,.8)]" : "border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,.08)]"}`}
      style={{ background: config.background }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />
      <Icon
        className="relative drop-shadow-[0_3px_3px_rgba(0,0,0,.7)]"
        size={24}
        strokeWidth={type === "coin" ? 2.6 : 2.9}
        color={config.color}
        fill={type === "star" ? config.color : "none"}
      />
    </button>
  );
}

function Stars({ count = 0, size = 19 }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3].map((star) => (
        <Star key={star} size={size} strokeWidth={2.6} color={star <= count ? "#FFB800" : "#3F3F46"} fill={star <= count ? "#FFB800" : "transparent"} />
      ))}
    </div>
  );
}

export default function BonusMatch() {
  const navigate = useNavigate();
  const { user, mode, refreshMe } = useApp();
  const [status, setStatus] = useState(null);
  const [game, setGame] = useState(null);
  const [selected, setSelected] = useState(null);
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [flash, setFlash] = useState("");

  const loadStatus = async () => {
    if (mode === "mock") {
      const mockStatus = {
        profile: { current_level: 12, total_stars: 26, lives: 5, max_lives: 5, next_life_at: null, daily_points: 17, daily_point_cap: 40 },
        completions: Array.from({ length: 11 }, (_, index) => ({ level: index + 1, stars: index % 3 === 0 ? 3 : 2, best_score: 1600 + index * 300 })),
        active_session: null,
        top_today: [
          { rank: 1, name: "Максим Д.", score: 25680, level: 14, avatar_initials: "МД", avatar_color: "#00F0FF", avatar_rarity: "legendary" },
          { rank: 2, name: "Анна К.", score: 18540, level: 12, avatar_initials: "АК", avatar_color: "#FFB800", avatar_rarity: "rare" },
          { rank: 3, name: "Олена Т.", score: 14230, level: 11, avatar_initials: "ОТ", avatar_color: "#39FF14", avatar_rarity: "improved" },
        ],
      };
      setStatus(mockStatus);
      setSelectedLevel(mockStatus.profile.current_level);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const { data } = await api.get("/games/bonus-match/status");
      setStatus(data);
      setSelectedLevel(Number(data.profile.current_level || 1));
      if (data.active_session) setGame(data.active_session);
    } catch (error) {
      toast.error(extractError(error, "Не вдалося завантажити Bonus Match"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode]);

  const completionsByLevel = useMemo(() => new Map((status?.completions || []).map((item) => [Number(item.level), item])), [status?.completions]);
  const chosenCompletion = completionsByLevel.get(selectedLevel);
  const config = game?.config || mockConfig(selectedLevel);
  const scoreProgress = Math.min(100, Math.round(((game?.score || 0) / Math.max(1, config.target_score)) * 100));
  const coinProgress = Math.min(100, Math.round(((game?.coins_collected || 0) / Math.max(1, config.target_coins)) * 100));

  const startGame = async (level = selectedLevel) => {
    setSelected(null);
    setResult(null);
    setFlash("");
    if (mode === "mock") {
      const levelConfig = mockConfig(level);
      setGame({
        id: `mock-${Date.now()}`,
        level,
        board: makeMockBoard(),
        moves_left: levelConfig.moves,
        score: 0,
        coins_collected: 0,
        status: "active",
        config: levelConfig,
        cascades: 0,
      });
      setStatus((current) => ({ ...current, profile: { ...current.profile, lives: Math.max(0, current.profile.lives - 1) } }));
      return;
    }
    try {
      setLoading(true);
      const { data } = await api.post("/games/bonus-match/start", { level });
      setGame(data.session);
      setStatus((current) => current ? { ...current, profile: { ...current.profile, ...data.profile } } : current);
      if (data.resumed) toast.info("Продовжуємо незавершений рівень");
    } catch (error) {
      toast.error(extractError(error, "Не вдалося почати рівень"));
    } finally {
      setLoading(false);
    }
  };

  const makeMove = async (from, to) => {
    if (!game || moving || game.status !== "active") return;
    setMoving(true);
    try {
      const data = mode === "mock"
        ? runMockMove(game, from, to)
        : (await api.post("/games/bonus-match/move", {
          session_id: game.id,
          from_row: from.row,
          from_col: from.col,
          to_row: to.row,
          to_col: to.col,
        })).data;
      setGame(data.session);
      setFlash(data.valid ? data.message : "");
      if (!data.valid) toast.info(data.message || "Спробуй інший хід");
      if (data.result) {
        setResult(data.result);
        if (mode !== "mock" && data.session.status === "won") await refreshMe().catch(() => {});
        if (mode !== "mock") await loadStatus();
      }
    } catch (error) {
      toast.error(extractError(error, "Не вдалося виконати хід"));
    } finally {
      setSelected(null);
      setMoving(false);
      window.setTimeout(() => setFlash(""), 900);
    }
  };

  const handlePiece = (row, col) => {
    if (!selected) {
      setSelected({ row, col });
      return;
    }
    if (selected.row === row && selected.col === col) {
      setSelected(null);
      return;
    }
    const adjacent = Math.abs(selected.row - row) + Math.abs(selected.col - col) === 1;
    if (!adjacent) {
      setSelected({ row, col });
      return;
    }
    makeMove(selected, { row, col });
  };

  const chooseLevel = (delta) => {
    const maxLevel = Number(status?.profile?.current_level || 1);
    setSelectedLevel((current) => Math.max(1, Math.min(maxLevel, current + delta)));
  };

  const leaveBoard = () => {
    if (game?.status === "active") {
      toast.info("Рівень збережено. Ти зможеш продовжити пізніше");
    }
    setGame(null);
    setResult(null);
    loadStatus();
  };

  if (loading && !status && !game) {
    return <div className="px-5 py-12 text-center text-sm font-bold text-zinc-500">Завантаження Bonus Match...</div>;
  }

  return (
    <div className="space-y-4 px-4 pb-8 pt-2" data-testid="bonus-match-page">
      <section className="flex items-center gap-3">
        <button type="button" onClick={() => game?.status === "active" ? navigate("/") : game ? leaveBoard() : navigate("/")} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-zinc-300 active:scale-95" aria-label="Назад">
          <ArrowLeft size={21} strokeWidth={2.8} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[23px] leading-none text-white">BONUS MATCH</h1>
            <Zap size={20} color="#FFB800" fill="#FFB800" />
          </div>
          <div className="mt-1 text-xs font-bold text-zinc-500">Збирай 3+ фішки та отримуй нагороди</div>
        </div>
        <div className="flex items-center gap-1 rounded-2xl border border-[#FFB800]/25 bg-[#FFB800]/10 px-2.5 py-2 text-[#FFB800]">
          <Coins size={15} />
          <span className="text-sm font-black tabular-nums">{formatNumber(user?.balance)}</span>
        </div>
      </section>

      {!game ? (
        <>
          <section className="overflow-hidden rounded-3xl border border-[#7C3AED]/45 bg-gradient-to-br from-[#24103F] via-[#17131F] to-[#111114] p-5 shadow-[0_18px_50px_rgba(124,58,237,.18)]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[.18em] text-[#B78CFF]">Обери рівень</div>
                <div className="mt-1 text-xs font-bold text-zinc-500">Відкрито до {status?.profile?.current_level || 1} рівня</div>
              </div>
              <div className="flex items-center gap-1 text-[#FF4D55]">
                {Array.from({ length: status?.profile?.max_lives || 5 }, (_, index) => (
                  <Heart key={index} size={16} strokeWidth={2.5} fill={index < (status?.profile?.lives || 0) ? "#FF4D55" : "transparent"} color={index < (status?.profile?.lives || 0) ? "#FF4D55" : "#3F3F46"} />
                ))}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-center gap-4">
              <button type="button" onClick={() => chooseLevel(-1)} disabled={selectedLevel <= 1} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-zinc-300 disabled:opacity-30 active:scale-95"><ChevronLeft /></button>
              <div className="min-w-[140px] text-center">
                <div className="font-display text-[52px] leading-none text-white">{selectedLevel}</div>
                <div className="mt-2 flex justify-center"><Stars count={chosenCompletion?.stars || 0} size={21} /></div>
              </div>
              <button type="button" onClick={() => chooseLevel(1)} disabled={selectedLevel >= (status?.profile?.current_level || 1)} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-zinc-300 disabled:opacity-30 active:scale-95"><ChevronRight /></button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-white/10 bg-black/25 px-2 py-3 text-center"><div className="text-[9px] font-black uppercase text-zinc-600">Ходи</div><div className="mt-1 text-lg font-black text-white">{mockConfig(selectedLevel).moves}</div></div>
              <div className="rounded-2xl border border-[#FFB800]/20 bg-[#FFB800]/[.06] px-2 py-3 text-center"><div className="text-[9px] font-black uppercase text-zinc-600">Монети</div><div className="mt-1 text-lg font-black text-[#FFB800]">{mockConfig(selectedLevel).target_coins}</div></div>
              <div className="rounded-2xl border border-[#B78CFF]/20 bg-[#B78CFF]/[.06] px-2 py-3 text-center"><div className="text-[9px] font-black uppercase text-zinc-600">Ціль</div><div className="mt-1 text-lg font-black text-[#B78CFF]">{formatNumber(mockConfig(selectedLevel).target_score)}</div></div>
            </div>

            <button type="button" onClick={() => startGame()} disabled={loading || (status?.profile?.lives || 0) <= 0} className="mt-5 flex h-14 w-full items-center justify-center gap-3 rounded-2xl border-b-4 border-[#6A3A00] bg-gradient-to-r from-[#FFB800] to-[#FF7A00] font-display text-xl text-[#14100A] shadow-[0_12px_30px_rgba(255,184,0,.2)] active:translate-y-0.5 active:border-b-2 disabled:cursor-not-allowed disabled:grayscale disabled:opacity-50">
              <Gamepad2 size={23} strokeWidth={2.8} />
              ГРАТИ
              <span className="flex items-center gap-1 border-l border-black/20 pl-3 text-sm font-black"><Heart size={15} fill="#14100A" />1</span>
            </button>
            {(status?.profile?.lives || 0) <= 0 && <div className="mt-2 text-center text-[11px] font-bold text-zinc-500">Наступне життя відновиться автоматично через 30 хвилин</div>}
          </section>

          <section className="grid grid-cols-2 gap-3">
            <div className="rounded-3xl border border-[#FFB800]/25 bg-[#1A1A1E] p-4">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-[#FFB800]"><Star size={15} fill="#FFB800" />Щоденна нагорода</div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-black/40"><div className="h-full rounded-full bg-gradient-to-r from-[#FFB800] to-[#FF5C00]" style={{ width: `${Math.min(100, ((status?.profile?.daily_points || 0) / Math.max(1, status?.profile?.daily_point_cap || 40)) * 100)}%` }} /></div>
              <div className="mt-2 flex justify-between text-xs font-black"><span className="text-white">{status?.profile?.daily_points || 0}</span><span className="text-zinc-600">/ {status?.profile?.daily_point_cap || 40} Point</span></div>
            </div>
            <div className="rounded-3xl border border-[#B78CFF]/25 bg-[#1A1A1E] p-4">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-[#B78CFF]"><Sparkles size={15} />Мій прогрес</div>
              <div className="mt-3 font-display text-3xl text-white">{status?.profile?.total_stars || 0}</div>
              <div className="text-xs font-bold text-zinc-500">зібрано зірок</div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-4">
            <div className="mb-3 flex items-center gap-2 font-display text-lg text-white"><Trophy size={19} color="#FFB800" />ТОП ДНЯ</div>
            {(status?.top_today || []).length ? (
              <div className="space-y-2">
                {status.top_today.map((player) => (
                  <div key={player.user_id || player.rank} className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-black/20 p-2.5">
                    <div className="w-5 text-center text-xs font-black text-[#FFB800]">{player.rank}</div>
                    <AvatarFrame src={player.avatar_url} initials={player.avatar_initials} color={player.avatar_color} rarity={player.avatar_rarity} size="xs" />
                    <div className="min-w-0 flex-1"><div className="truncate text-xs font-black text-white">{player.name}</div><div className="text-[9px] font-bold text-zinc-600">Рівень {player.level}</div></div>
                    <div className="text-sm font-black tabular-nums text-[#B78CFF]">{formatNumber(player.score)}</div>
                  </div>
                ))}
              </div>
            ) : <div className="rounded-2xl bg-black/20 p-4 text-center text-xs font-bold text-zinc-600">Стань першим у рейтингу сьогодні</div>}
          </section>
        </>
      ) : (
        <>
          <section className="rounded-3xl border border-[#7C3AED]/40 bg-gradient-to-br from-[#201139] to-[#111114] p-3 shadow-[0_18px_45px_rgba(124,58,237,.18)]">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-white/10 bg-black/25 px-2 py-2.5 text-center"><div className="text-[8px] font-black uppercase tracking-wider text-zinc-600">Рівень</div><div className="mt-0.5 text-lg font-black text-white">{game.level}</div></div>
              <div className="rounded-2xl border border-[#FFB800]/20 bg-[#FFB800]/[.06] px-2 py-2.5 text-center"><div className="text-[8px] font-black uppercase tracking-wider text-zinc-600">Ходи</div><div className="mt-0.5 text-lg font-black text-[#FFB800]">{game.moves_left}</div></div>
              <div className="rounded-2xl border border-[#B78CFF]/20 bg-[#B78CFF]/[.06] px-2 py-2.5 text-center"><div className="text-[8px] font-black uppercase tracking-wider text-zinc-600">Рахунок</div><div className="mt-0.5 text-lg font-black text-[#B78CFF]">{formatNumber(game.score)}</div></div>
            </div>

            <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-white/[.08] bg-black/25 p-3">
              <div>
                <div className="flex items-center justify-between text-[10px] font-black"><span className="text-zinc-500">Ціль: {formatNumber(config.target_score)}</span><span className="text-[#B78CFF]">{scoreProgress}%</span></div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#0A0A0A]"><div className="h-full rounded-full bg-gradient-to-r from-[#7C3AED] to-[#B78CFF]" style={{ width: `${scoreProgress}%` }} /></div>
              </div>
              <div className="flex min-w-[72px] items-center justify-center gap-1.5 rounded-xl border border-[#FFB800]/25 bg-[#FFB800]/10 px-2 py-2 text-[#FFB800]"><Coins size={15} /><span className="text-sm font-black">{game.coins_collected}/{config.target_coins}</span></div>
            </div>

            <div className="relative mt-3 rounded-[22px] border border-[#7C3AED]/55 bg-[#090711] p-1.5 shadow-[inset_0_0_30px_rgba(124,58,237,.12)]">
              <div className="grid grid-cols-7 gap-1">
                {game.board.map((rowValues, row) => rowValues.map((type, col) => (
                  <Piece
                    key={`${row}-${col}`}
                    type={type}
                    row={row}
                    col={col}
                    selected={selected?.row === row && selected?.col === col}
                    disabled={moving || game.status !== "active"}
                    onClick={() => handlePiece(row, col)}
                  />
                )))}
              </div>
              {moving && <div className="absolute inset-0 flex items-center justify-center rounded-[22px] bg-black/20 backdrop-blur-[1px]"><div className="h-10 w-10 animate-spin rounded-full border-4 border-[#B78CFF]/25 border-t-[#B78CFF]" /></div>}
              {flash && <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#39FF14]/30 bg-black/80 px-4 py-2 text-sm font-black text-[#39FF14] shadow-[0_0_24px_rgba(57,255,20,.3)]">{flash}</div>}
            </div>

            <div className="mt-3 flex items-center justify-between px-1 text-[10px] font-bold text-zinc-600"><span>Натисни фішку, потім сусідню</span><span>{coinProgress}% монет</span></div>
          </section>

          {game.status !== "active" && (
            <section className={`rounded-3xl border p-5 text-center ${game.status === "won" ? "border-[#39FF14]/35 bg-[#39FF14]/[.07]" : "border-[#FF4D55]/35 bg-[#FF4D55]/[.07]"}`}>
              <div className={`font-display text-[27px] ${game.status === "won" ? "text-[#39FF14]" : "text-[#FF4D55]"}`}>{game.status === "won" ? "РІВЕНЬ ПРОЙДЕНО!" : "ХОДИ ЗАКІНЧИЛИСЯ"}</div>
              <div className="mt-3 flex justify-center"><Stars count={result?.stars || 0} size={28} /></div>
              <div className="mt-3 text-sm font-bold text-zinc-400">Рахунок: <span className="font-black text-white">{formatNumber(game.score)}</span></div>
              {game.status === "won" && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-[#FFB800]/25 bg-[#FFB800]/10 p-3"><div className="text-[9px] font-black uppercase text-zinc-600">Нагорода</div><div className="mt-1 text-xl font-black text-[#FFB800]">+{result?.points_awarded || 0} Point</div></div>
                  <div className="rounded-2xl border border-[#00F0FF]/25 bg-[#00F0FF]/10 p-3"><div className="text-[9px] font-black uppercase text-zinc-600">Досвід</div><div className="mt-1 text-xl font-black text-[#00F0FF]">+{result?.xp_awarded || 0} XP</div></div>
                </div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => { setGame(null); setResult(null); loadStatus(); }} className="flex h-12 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-sm font-black text-zinc-300 active:scale-95"><RotateCcw size={17} className="mr-2" />Рівні</button>
                <button type="button" onClick={() => startGame(game.status === "won" ? Math.min(50, result?.current_level || game.level + 1) : game.level)} className="flex h-12 items-center justify-center rounded-2xl bg-[#7C3AED] text-sm font-black text-white active:scale-95">{game.status === "won" ? "Далі" : "Ще раз"}<ChevronRight size={17} className="ml-1" /></button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
