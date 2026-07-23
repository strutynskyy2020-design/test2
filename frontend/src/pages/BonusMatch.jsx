import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bomb,
  Box,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Coins,
  Dice5,
  Gamepad2,
  Gem,
  Gift,
  Heart,
  Lock,
  Rocket,
  RotateCcw,
  Shield,
  Snowflake,
  Sparkles,
  Star,
  Trophy,
  Zap,
} from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";
import { fireConfetti } from "@/lib/confetti";
import { useApp } from "@/context/AppContext";
import AvatarFrame from "@/components/AvatarFrame";

const ROWS = 7;
const COLS = 7;
const MAX_LEVEL = 50;
const SYMBOLS = ["coin", "star", "gift", "cube", "zap", "trophy"];
const BOSS_LEVELS = { 25: 2, 40: 2, 50: 3 };
const OBSTACLE_ORDER = ["ice", "chain", "crate", "stone", "crystal", "web", "shield", "slime", "metal", "core"];
const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
const coordKey = (row, col) => `${row}:${col}`;
const cloneBoard = (board) => (board || []).map((row) => row.map((cell) => (cell ? { ...cell } : null)));

const PIECES = {
  coin: { Icon: Coins, label: "Монета", color: "#FFB800", background: "linear-gradient(145deg,#5B3A00,#231700)" },
  star: { Icon: Star, label: "Зірка", color: "#35B8FF", background: "linear-gradient(145deg,#073F69,#07182A)" },
  gift: { Icon: Gift, label: "Подарунок", color: "#F64CFF", background: "linear-gradient(145deg,#5A145F,#210923)" },
  cube: { Icon: Dice5, label: "Куб", color: "#39FF14", background: "linear-gradient(145deg,#176408,#092506)" },
  zap: { Icon: Zap, label: "Блискавка", color: "#FF5C00", background: "linear-gradient(145deg,#6B2400,#260D00)" },
  trophy: { Icon: Trophy, label: "Трофей", color: "#B78CFF", background: "linear-gradient(145deg,#442878,#170C2B)" },
};

const SPECIALS = {
  rocket_row: { Icon: Rocket, label: "Ракета по рядку", color: "#FFB800", rotate: 45 },
  rocket_col: { Icon: Rocket, label: "Ракета по колонці", color: "#00F0FF", rotate: -45 },
  bomb: { Icon: Bomb, label: "Бомба", color: "#FF5C00", rotate: 0 },
  color_bomb: { Icon: CircleDot, label: "Блискавка-джокер", color: "#F64CFF", rotate: 0 },
};

const OBSTACLES = {
  ice: { Icon: Snowflake, label: "Крига", color: "#7DD3FC", background: "linear-gradient(145deg,#164E63,#082F49)" },
  chain: { Icon: Lock, label: "Ланцюг", color: "#A1A1AA", background: "linear-gradient(145deg,#3F3F46,#18181B)" },
  crate: { Icon: Box, label: "Ящик", color: "#FDBA74", background: "linear-gradient(145deg,#78350F,#2A1205)" },
  stone: { Icon: Shield, label: "Камінь", color: "#D4D4D8", background: "linear-gradient(145deg,#52525B,#18181B)" },
  crystal: { Icon: Gem, label: "Кристал", color: "#C084FC", background: "linear-gradient(145deg,#581C87,#1E0B2E)" },
  web: { Icon: Sparkles, label: "Павутина", color: "#E4E4E7", background: "linear-gradient(145deg,#3F3F46,#09090B)" },
  shield: { Icon: Shield, label: "Щит", color: "#60A5FA", background: "linear-gradient(145deg,#1E3A8A,#0A163D)" },
  slime: { Icon: CircleDot, label: "Слиз", color: "#4ADE80", background: "linear-gradient(145deg,#166534,#052E16)" },
  metal: { Icon: Shield, label: "Метал", color: "#CBD5E1", background: "linear-gradient(145deg,#475569,#111827)" },
  core: { Icon: Zap, label: "Ядро", color: "#FF4D55", background: "linear-gradient(145deg,#7F1D1D,#2A0808)" },
};

const SPECIAL_TOASTS = {
  rocket_row: "Ракета створена!",
  rocket_col: "Ракета створена!",
  bomb: "Бомба готова!",
  color_bomb: "Джокер зібрано!",
};

const OBSTACLE_NAMES = {
  ice: "Крига",
  chain: "Ланцюг",
  crate: "Ящик",
  stone: "Камінь",
  crystal: "Кристал",
  web: "Павутина",
  shield: "Щит",
  slime: "Слиз",
  metal: "Метал",
  core: "Ядро",
};

const makeCell = (symbol = null, extras = {}) => ({
  id: extras.id || `mock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  symbol,
  special: extras.special || null,
  obstacle: extras.obstacle || null,
  obstacle_hits: extras.obstacle_hits || 0,
});

const normalizeCell = (cell) => {
  if (!cell) return null;
  if (typeof cell === "string") return makeCell(cell);
  return {
    id: cell.id || `cell-${Math.random().toString(36).slice(2, 10)}`,
    symbol: cell.symbol || null,
    special: cell.special || null,
    obstacle: cell.obstacle || null,
    obstacle_hits: Number(cell.obstacle_hits || 0),
  };
};

const normalizeBoard = (board) => (board || []).map((row) => row.map(normalizeCell));

const levelConfig = (level) => {
  const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Number(level || 1)));
  const milestone = safeLevel % 5 === 0;
  const stage = Math.floor(safeLevel / 5);
  const ordinaryStage = Math.floor((safeLevel - 1) / 5);
  const baseTarget = 900 + safeLevel * 260;
  let targetScore = Math.floor(baseTarget * (1 + ordinaryStage * 0.1));
  if (milestone) {
    const previousBase = 900 + (safeLevel - 1) * 260;
    const previousTarget = previousBase * (1 + Math.max(0, stage - 1) * 0.1);
    const challengeMultiplier = Math.min(2.5, 1.8 + Math.max(0, stage - 1) * 0.08);
    targetScore = Math.max(targetScore, Math.floor(previousTarget * challengeMultiplier));
  }
  const rewardMultiplier = BOSS_LEVELS[safeLevel] || 1;
  if (rewardMultiplier > 1) targetScore = Math.floor(targetScore * 1.12);
  let moves = Math.max(15, 24 - Math.floor((safeLevel - 1) / 7));
  if (milestone) moves = Math.max(12, moves - 2);
  if (rewardMultiplier > 1) moves = Math.max(11, moves - 1);
  let targetCoins = 6 + Math.floor((safeLevel + 1) / 2) + ordinaryStage;
  if (milestone) targetCoins = Math.floor(targetCoins * 1.3) + 2;
  const obstacles = OBSTACLE_ORDER.slice(0, stage);
  return {
    level: safeLevel,
    moves,
    target_score: targetScore,
    target_coins: targetCoins,
    star_thresholds: [targetScore, Math.floor(targetScore * 1.35), Math.floor(targetScore * 1.72)],
    is_milestone: milestone,
    is_boss: rewardMultiplier > 1,
    reward_multiplier: rewardMultiplier,
    new_obstacle: milestone ? obstacles.at(-1) : null,
    obstacles,
  };
};

const matchSymbol = (cell) => {
  if (!cell || cell.obstacle || cell.special === "color_bomb") return null;
  return cell.symbol;
};

const findMatches = (board) => {
  const matched = new Set();
  for (let row = 0; row < ROWS; row += 1) {
    let start = 0;
    while (start < COLS) {
      const symbol = matchSymbol(board[row]?.[start]);
      let end = start + 1;
      while (end < COLS && symbol && matchSymbol(board[row]?.[end]) === symbol) end += 1;
      if (symbol && end - start >= 3) {
        for (let col = start; col < end; col += 1) matched.add(coordKey(row, col));
      }
      start = end;
    }
  }
  for (let col = 0; col < COLS; col += 1) {
    let start = 0;
    while (start < ROWS) {
      const symbol = matchSymbol(board[start]?.[col]);
      let end = start + 1;
      while (end < ROWS && symbol && matchSymbol(board[end]?.[col]) === symbol) end += 1;
      if (symbol && end - start >= 3) {
        for (let row = start; row < end; row += 1) matched.add(coordKey(row, col));
      }
      start = end;
    }
  }
  return matched;
};

const hasPossibleMove = (board) => {
  const copy = cloneBoard(board);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const nextRow = row + dr;
        const nextCol = col + dc;
        if (nextRow >= ROWS || nextCol >= COLS) continue;
        const a = copy[row][col];
        const b = copy[nextRow][nextCol];
        if (!a || !b || a.obstacle || b.obstacle) continue;
        if (a.special || b.special) return true;
        [copy[row][col], copy[nextRow][nextCol]] = [b, a];
        const valid = findMatches(copy).size > 0;
        [copy[row][col], copy[nextRow][nextCol]] = [a, b];
        if (valid) return true;
      }
    }
  }
  return false;
};

const makeMockBoard = (level = 1) => {
  const config = levelConfig(level);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const board = [];
    for (let row = 0; row < ROWS; row += 1) {
      board.push([]);
      for (let col = 0; col < COLS; col += 1) {
        const blocked = new Set();
        if (col >= 2 && matchSymbol(board[row][col - 1]) === matchSymbol(board[row][col - 2])) blocked.add(matchSymbol(board[row][col - 1]));
        if (row >= 2 && matchSymbol(board[row - 1][col]) === matchSymbol(board[row - 2][col])) blocked.add(matchSymbol(board[row - 1][col]));
        const options = SYMBOLS.filter((symbol) => !blocked.has(symbol));
        board[row].push(makeCell(options[Math.floor(Math.random() * options.length)]));
      }
    }
    if (config.obstacles.length) {
      const count = Math.min(10, 2 + Math.floor(level / 5));
      for (let index = 0; index < count; index += 1) {
        const row = Math.floor(Math.random() * ROWS);
        const col = Math.floor(Math.random() * COLS);
        const obstacle = config.obstacles[Math.floor(Math.random() * config.obstacles.length)];
        board[row][col] = makeCell(null, { obstacle, obstacle_hits: obstacle === "core" ? 4 : obstacle === "stone" || obstacle === "metal" ? 3 : 2 });
      }
    }
    if (!findMatches(board).size && hasPossibleMove(board)) return board;
  }
  return Array.from({ length: ROWS }, (_, row) => Array.from({ length: COLS }, (_, col) => makeCell(SYMBOLS[(row * 2 + col * 3) % SYMBOLS.length])));
};

const collapseMockBoard = (board) => {
  const result = cloneBoard(board);
  const spawned = [];
  for (let col = 0; col < COLS; col += 1) {
    const fixedRows = [];
    for (let row = 0; row < ROWS; row += 1) if (result[row][col]?.obstacle) fixedRows.push(row);
    const boundaries = [-1, ...fixedRows, ROWS];
    for (let segment = 0; segment < boundaries.length - 1; segment += 1) {
      const start = boundaries[segment] + 1;
      const end = boundaries[segment + 1] - 1;
      if (start > end) continue;
      const values = [];
      for (let row = start; row <= end; row += 1) if (result[row][col]) values.push(result[row][col]);
      let writeRow = end;
      for (let index = values.length - 1; index >= 0; index -= 1) {
        result[writeRow][col] = values[index];
        writeRow -= 1;
      }
      while (writeRow >= start) {
        const fresh = makeCell(SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
        result[writeRow][col] = fresh;
        spawned.push({ row: writeRow, col, id: fresh.id });
        writeRow -= 1;
      }
    }
  }
  return { board: result, spawned };
};


const runMockMove = (game, from, to) => {
  const original = cloneBoard(game.board);
  const board = cloneBoard(game.board);
  const first = board[from.row][from.col];
  const second = board[to.row][to.col];
  if (!first || !second || first.obstacle || second.obstacle) {
    return {
      valid: false,
      message: "Ця клітинка заблокована",
      session: game,
      animation: { swapped_board: original, reverted_board: original, steps: [] },
    };
  }

  [board[from.row][from.col], board[to.row][to.col]] = [second, first];
  const swapped = cloneBoard(board);
  let matches = findMatches(board);
  if (!matches.size && !first.special && !second.special) {
    return {
      valid: false,
      message: "Цей хід не створює комбінацію",
      session: game,
      animation: { swapped_board: swapped, reverted_board: original, steps: [] },
    };
  }

  const steps = [];
  let scoreGain = 0;
  let coinsGain = 0;
  let combo = 0;
  while (matches.size && combo < 8) {
    combo += 1;
    const cells = [...matches].map((key) => key.split(":").map(Number));
    const boardBeforeClear = cloneBoard(board);
    const createdSpecials = [];
    const anchor = cells.find(([row, col]) => row === to.row && col === to.col) || cells[Math.floor(cells.length / 2)];
    let protectedKey = null;
    if (cells.length >= 5 && anchor) {
      board[anchor[0]][anchor[1]].special = "color_bomb";
      protectedKey = coordKey(anchor[0], anchor[1]);
      createdSpecials.push({ row: anchor[0], col: anchor[1], special: "color_bomb", id: board[anchor[0]][anchor[1]].id });
    } else if (cells.length === 4 && anchor) {
      const sameRow = cells.every(([row]) => row === cells[0][0]);
      const special = sameRow ? "rocket_row" : "rocket_col";
      board[anchor[0]][anchor[1]].special = special;
      protectedKey = coordKey(anchor[0], anchor[1]);
      createdSpecials.push({ row: anchor[0], col: anchor[1], special, id: board[anchor[0]][anchor[1]].id });
    }

    const clearedCells = cells.filter(([row, col]) => coordKey(row, col) !== protectedKey);
    const coinsThisStep = clearedCells.filter(([row, col]) => board[row][col]?.symbol === "coin").length;
    const stepScore = Math.floor((clearedCells.length * 100 + Math.max(0, cells.length - 3) * 120) * (1 + (combo - 1) * 0.25));
    scoreGain += stepScore;
    coinsGain += coinsThisStep;
    clearedCells.forEach(([row, col]) => { board[row][col] = null; });
    const boardAfterClear = cloneBoard(board);
    const collapsed = collapseMockBoard(board);
    collapsed.board.forEach((row, rowIndex) => row.forEach((cell, colIndex) => { board[rowIndex][colIndex] = cell; }));
    steps.push({
      combo,
      score_gain: stepScore,
      coins_gain: coinsThisStep,
      matched_cells: cells.map(([row, col]) => ({ row, col })),
      cleared_cells: clearedCells.map(([row, col]) => ({ row, col })),
      created_specials: createdSpecials,
      activated_specials: [],
      obstacle_changes: [],
      board_before_clear: boardBeforeClear,
      board_after_clear: boardAfterClear,
      board_after_collapse: cloneBoard(board),
      spawned: collapsed.spawned,
    });
    matches = findMatches(board);
  }

  if (!hasPossibleMove(board)) {
    const fresh = makeMockBoard(game.level);
    fresh.forEach((row, rowIndex) => row.forEach((cell, colIndex) => { board[rowIndex][colIndex] = cell; }));
  }

  const score = game.score + scoreGain;
  const coins = game.coins_collected + coinsGain;
  const moves = Math.max(0, game.moves_left - 1);
  const won = score >= game.config.target_score && coins >= game.config.target_coins;
  const status = won ? "won" : moves === 0 ? "lost" : "active";
  const stars = won ? (score >= game.config.star_thresholds[2] ? 3 : score >= game.config.star_thresholds[1] ? 2 : 1) : 0;
  const session = { ...game, board, score, coins_collected: coins, moves_left: moves, status };
  return {
    valid: true,
    message: `+${scoreGain} очок`,
    score_gain: scoreGain,
    coins_gain: coinsGain,
    cascade_count: steps.length,
    session,
    animation: { swapped_board: swapped, steps, reshuffled: false },
    result: status === "active" ? null : {
      stars,
      points_awarded: won ? [0, 2, 4, 7][stars] + 5 : 0,
      xp_awarded: won ? [0, 5, 10, 15][stars] : 0,
      first_win_bonus: won ? 5 : 0,
      lives: won ? 5 : 4,
      current_level: won ? Math.min(MAX_LEVEL, game.level + 1) : game.level,
      total_stars: won ? stars : 0,
      first_completion: won,
      reward_multiplier: game.config.reward_multiplier || 1,
    },
  };
};

const formatNumber = (value) => Number(value || 0).toLocaleString("uk-UA");

function Piece({
  cell,
  selected,
  disabled,
  removing,
  shaking,
  spawned,
  activated,
  removeDelay = 0,
  onClick,
  row,
  col,
  reducedMotion,
}) {
  if (!cell) return null;
  const obstacle = cell.obstacle ? OBSTACLES[cell.obstacle] || OBSTACLES.stone : null;
  const special = cell.special ? SPECIALS[cell.special] || SPECIALS.bomb : null;
  const piece = PIECES[cell.symbol] || PIECES.star;
  const Icon = obstacle?.Icon || special?.Icon || piece.Icon;
  const color = obstacle?.color || special?.color || piece.color;
  const background = obstacle?.background || piece.background;
  const label = obstacle?.label || special?.label || piece.label;
  const shakeAnimation = shaking && !reducedMotion ? [0, -7, 7, -6, 6, -3, 3, 0] : 0;

  return (
    <motion.button
      layout="position"
      layoutId={`bonus-piece-${cell.id}`}
      type="button"
      onClick={onClick}
      disabled={disabled || Boolean(obstacle)}
      aria-label={`${label}, рядок ${row + 1}, колонка ${col + 1}`}
      className="relative flex aspect-square min-w-0 touch-manipulation items-center justify-center overflow-hidden rounded-[10px] border border-white/10"
      style={{
        background,
        gridRowStart: row + 1,
        gridColumnStart: col + 1,
      }}
      initial={spawned && !reducedMotion ? { y: -70, opacity: 0, scale: 0.72 } : { opacity: 1, scale: 1 }}
      animate={{
        x: shakeAnimation,
        y: 0,
        opacity: removing ? 0 : 1,
        scale: removing ? 0 : selected ? 1.12 : activated ? 1.16 : 1,
        rotate: removing ? 24 : activated ? [0, 8, -8, 0] : 0,
      }}
      exit={reducedMotion
        ? { opacity: 0, transition: { duration: 0.05 } }
        : {
          opacity: 0,
          scale: 0,
          rotate: 30,
          transition: { duration: 0.28, delay: removeDelay, ease: "easeIn" },
        }}
      whileTap={disabled || obstacle ? undefined : { scale: 0.86 }}
      transition={
        shaking
          ? { duration: reducedMotion ? 0.01 : 0.32, ease: "easeInOut" }
          : {
            layout: { duration: reducedMotion ? 0.05 : 0.23, ease: [0.22, 1, 0.36, 1] },
            y: { type: "spring", stiffness: 480, damping: 20, bounce: 0.24 },
            scale: { type: "spring", stiffness: 420, damping: 24, delay: removing ? removeDelay : 0 },
            opacity: { duration: reducedMotion ? 0.05 : 0.22, delay: removing ? removeDelay : 0 },
            rotate: { duration: reducedMotion ? 0.05 : 0.28, delay: removing ? removeDelay : 0 },
          }
      }
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />
      <AnimatePresence>
        {selected && (
          <motion.div
            className="pointer-events-none absolute inset-[2px] rounded-[8px] border-2 border-white"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 0.95, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
          />
        )}
      </AnimatePresence>
      {special && (
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-[10px] border-2"
          style={{ borderColor: special.color }}
          animate={reducedMotion ? { opacity: 0.45 } : { opacity: [0.28, 0.72, 0.28], scale: [0.92, 1.06, 0.92] }}
          transition={{ duration: 1.25, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <Icon
        className="relative drop-shadow-[0_3px_3px_rgba(0,0,0,.72)]"
        size={special ? 25 : obstacle ? 23 : 24}
        strokeWidth={special ? 3.1 : 2.8}
        color={color}
        fill={!special && cell.symbol === "star" ? color : "none"}
        style={{ transform: special?.rotate ? `rotate(${special.rotate}deg)` : undefined }}
      />
      {cell.special === "color_bomb" && (
        <div className="pointer-events-none absolute inset-[7px] rounded-full border-2 border-white/70 bg-[conic-gradient(#FFB800,#F64CFF,#00F0FF,#39FF14,#FF5C00,#FFB800)] opacity-65" />
      )}
      {obstacle && (
        <div className="absolute bottom-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-black/75 px-1 text-[8px] font-black text-white">
          {cell.obstacle_hits}
        </div>
      )}
    </motion.button>
  );
}

function Stars({ count = 0, size = 19, animated = false, reducedMotion = false }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3].map((star) => (
        <motion.div
          key={star}
          initial={animated && star <= count && !reducedMotion ? { scale: 0, rotate: -35, opacity: 0 } : false}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 18, delay: animated ? (star - 1) * 0.15 : 0 }}
        >
          <Star
            size={size}
            strokeWidth={2.6}
            color={star <= count ? "#FFB800" : "#3F3F46"}
            fill={star <= count ? "#FFB800" : "transparent"}
          />
        </motion.div>
      ))}
    </div>
  );
}

function SpecialEffects({ effects = [] }) {
  return (
    <AnimatePresence>
      {effects.flatMap((effect, effectIndex) => {
        if (effect.special === "rocket_row") {
          return (
            <motion.div
              key={`row-${effectIndex}`}
              className="pointer-events-none absolute left-0 right-0 h-[7px] rounded-full bg-gradient-to-r from-transparent via-[#FFB800] to-transparent"
              style={{ top: `${((effect.row + 0.5) / ROWS) * 100}%` }}
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: [0, 1, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28 }}
            />
          );
        }
        if (effect.special === "rocket_col") {
          return (
            <motion.div
              key={`col-${effectIndex}`}
              className="pointer-events-none absolute bottom-0 top-0 w-[7px] rounded-full bg-gradient-to-b from-transparent via-[#00F0FF] to-transparent"
              style={{ left: `${((effect.col + 0.5) / COLS) * 100}%` }}
              initial={{ scaleY: 0, opacity: 0 }}
              animate={{ scaleY: 1, opacity: [0, 1, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28 }}
            />
          );
        }
        if (effect.special === "bomb") {
          return (
            <motion.div
              key={`bomb-${effectIndex}`}
              className="pointer-events-none absolute aspect-square rounded-full border-4 border-[#FF5C00]"
              style={{
                width: `${(3 / COLS) * 100}%`,
                left: `${((effect.col - 1) / COLS) * 100}%`,
                top: `${((effect.row - 1) / ROWS) * 100}%`,
              }}
              initial={{ scale: 0.1, opacity: 1 }}
              animate={{ scale: 1.35, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
            />
          );
        }
        return (effect.targets || []).slice(0, 24).map((target, targetIndex) => (
          <motion.div
            key={`joker-${effectIndex}-${targetIndex}`}
            className="pointer-events-none absolute h-2 w-2 rounded-full bg-[#F64CFF]"
            style={{
              left: `${((target.col + 0.5) / COLS) * 100}%`,
              top: `${((target.row + 0.5) / ROWS) * 100}%`,
            }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.8, 0], opacity: [0, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.32, delay: targetIndex * 0.008 }}
          />
        ));
      })}
    </AnimatePresence>
  );
}


export default function BonusMatch() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const { user, mode, refreshMe } = useApp();
  const boardRef = useRef(null);
  const scoreRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [game, setGame] = useState(null);
  const [displayBoard, setDisplayBoard] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [shakingIds, setShakingIds] = useState(new Set());
  const [removingIds, setRemovingIds] = useState(new Set());
  const [spawnedIds, setSpawnedIds] = useState(new Set());
  const [activatedIds, setActivatedIds] = useState(new Set());
  const [specialEffects, setSpecialEffects] = useState([]);
  const [combo, setCombo] = useState(0);
  const [flash, setFlash] = useState("");
  const [animatedScore, setAnimatedScore] = useState(0);
  const [scorePulse, setScorePulse] = useState(false);
  const [scoreFlights, setScoreFlights] = useState([]);
  const [boardFx, setBoardFx] = useState("");
  const [bossPrompt, setBossPrompt] = useState(null);

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
      if (data.active_session) {
        const session = { ...data.active_session, board: normalizeBoard(data.active_session.board) };
        setGame(session);
        setDisplayBoard(session.board);
        setAnimatedScore(session.score || 0);
      }
    } catch (error) {
      toast.error(extractError(error, "Не вдалося завантажити Bonus Match"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const completionsByLevel = useMemo(
    () => new Map((status?.completions || []).map((item) => [Number(item.level), item])),
    [status?.completions],
  );
  const chosenCompletion = completionsByLevel.get(selectedLevel);
  const selectedConfig = levelConfig(selectedLevel);
  const config = game?.config || selectedConfig;
  const scoreProgress = Math.min(100, Math.round(((animatedScore || 0) / Math.max(1, config.target_score)) * 100));
  const coinProgress = Math.min(100, Math.round(((game?.coins_collected || 0) / Math.max(1, config.target_coins)) * 100));

  const startGame = async (level = selectedLevel, confirmed = false) => {
    const preview = levelConfig(level);
    if (preview.is_boss && !confirmed) {
      setBossPrompt(preview);
      return;
    }
    setBossPrompt(null);
    setSelected(null);
    setResult(null);
    setFlash("");
    setBoardFx("");
    setCombo(0);
    if (mode === "mock") {
      const levelBoard = makeMockBoard(level);
      const session = {
        id: `mock-${Date.now()}`,
        level,
        board: levelBoard,
        moves_left: preview.moves,
        score: 0,
        coins_collected: 0,
        status: "active",
        config: preview,
        cascades: 0,
      };
      setGame(session);
      setDisplayBoard(levelBoard);
      setAnimatedScore(0);
      setStatus((current) => ({ ...current, profile: { ...current.profile, lives: Math.max(0, current.profile.lives - 1) } }));
      return;
    }
    try {
      setLoading(true);
      const { data } = await api.post("/games/bonus-match/start", { level });
      const session = { ...data.session, board: normalizeBoard(data.session.board) };
      setGame(session);
      setDisplayBoard(session.board);
      setAnimatedScore(session.score || 0);
      setStatus((current) => (current ? { ...current, profile: { ...current.profile, ...data.profile } } : current));
      if (data.resumed) toast.info("Продовжуємо незавершений рівень");
    } catch (error) {
      toast.error(extractError(error, "Не вдалося почати рівень"));
    } finally {
      setLoading(false);
    }
  };

  const burstAtCells = (cells = [], color = "#B78CFF") => {
    if (reducedMotion || !boardRef.current || !cells.length) return;
    const rect = boardRef.current.getBoundingClientRect();
    const averageRow = cells.reduce((sum, item) => sum + item.row, 0) / cells.length;
    const averageCol = cells.reduce((sum, item) => sum + item.col, 0) / cells.length;
    const originX = (rect.left + ((averageCol + 0.5) / COLS) * rect.width) / window.innerWidth;
    const originY = (rect.top + ((averageRow + 0.5) / ROWS) * rect.height) / window.innerHeight;
    confetti({
      particleCount: Math.min(18, 7 + cells.length),
      spread: 28,
      startVelocity: 13,
      gravity: 0.8,
      ticks: 45,
      scalar: 0.42,
      colors: [color, "#FFB800", "#FFFFFF"],
      origin: { x: originX, y: originY },
      disableForReducedMotion: true,
    });
  };

  const launchScoreFlight = (cells, amount) => {
    if (!boardRef.current || !scoreRef.current || !cells?.length || amount <= 0) return;
    const boardRect = boardRef.current.getBoundingClientRect();
    const scoreRect = scoreRef.current.getBoundingClientRect();
    const averageRow = cells.reduce((sum, item) => sum + item.row, 0) / cells.length;
    const averageCol = cells.reduce((sum, item) => sum + item.col, 0) / cells.length;
    const x = ((averageCol + 0.5) / COLS) * boardRect.width;
    const y = ((averageRow + 0.5) / ROWS) * boardRect.height;
    const targetX = scoreRect.left + scoreRect.width / 2 - boardRect.left;
    const targetY = scoreRect.top + scoreRect.height / 2 - boardRect.top;
    const id = `${Date.now()}-${Math.random()}`;
    setScoreFlights((current) => [...current, { id, x, y, targetX, targetY, amount }]);
    window.setTimeout(() => setScoreFlights((current) => current.filter((item) => item.id !== id)), reducedMotion ? 150 : 720);
  };

  const tickScore = async (start, end) => {
    if (reducedMotion) {
      setAnimatedScore(end);
      return;
    }
    const ticks = 5;
    for (let index = 1; index <= ticks; index += 1) {
      setAnimatedScore(Math.round(start + ((end - start) * index) / ticks));
      setScorePulse(true);
      await wait(38);
      setScorePulse(false);
    }
  };

  const animateServerMove = async (data, baseScore) => {
    const animation = data.animation || {};
    const frames = Array.isArray(animation.frames) && animation.frames.length
      ? animation.frames
      : [
        ...(animation.swapped_board ? [{ phase: "swap", board: animation.swapped_board, duration_ms: 220 }] : []),
        ...(animation.steps || []).flatMap((step) => [
          {
            phase: "match",
            duration_ms: 290,
            combo: step.combo,
            score_gain: step.score_gain,
            coins_gain: step.coins_gain,
            board: step.board_before_clear,
            matched_cells: step.matched_cells,
            cleared_cells: step.cleared_cells,
            cleared_ids: (step.cleared_cells || []).map(({ row, col }) => step.board_before_clear?.[row]?.[col]?.id).filter(Boolean),
            created_specials: step.created_specials,
            activated_specials: step.activated_specials,
            obstacle_changes: step.obstacle_changes,
          },
          {
            phase: "collapse",
            duration_ms: 430,
            combo: step.combo,
            board: step.board_after_collapse,
            spawned: step.spawned,
            spawned_ids: (step.spawned || []).map((item) => item.id).filter(Boolean),
          },
        ]),
      ];

    const swapFrame = frames.find((frame) => frame.phase === "swap");
    if (swapFrame?.board) {
      setDisplayBoard(normalizeBoard(swapFrame.board));
      await wait(reducedMotion ? 35 : Number(swapFrame.duration_ms || 220));
    }

    if (!data.valid) {
      const invalidFrame = frames.find((frame) => frame.phase === "invalid");
      const pair = animation.swap;
      const boardForIds = normalizeBoard(animation.swapped_board || displayBoard);
      const ids = new Set((invalidFrame?.shake_ids || []).filter(Boolean));
      if (!ids.size && pair) {
        const firstId = boardForIds?.[pair.from.row]?.[pair.from.col]?.id;
        const secondId = boardForIds?.[pair.to.row]?.[pair.to.col]?.id;
        if (firstId) ids.add(firstId);
        if (secondId) ids.add(secondId);
      }
      setShakingIds(ids);
      await wait(reducedMotion ? 60 : Number(invalidFrame?.duration_ms || 320));
      setShakingIds(new Set());
      setDisplayBoard(normalizeBoard(invalidFrame?.board || animation.reverted_board || data.session?.board || game.board));
      await wait(reducedMotion ? 30 : 220);
      toast.info(data.message || "Спробуй інший хід");
      return;
    }

    let runningScore = Number(baseScore || 0);
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      if (frame.phase === "swap") continue;

      if (frame.phase === "match") {
        const before = normalizeBoard(frame.board || displayBoard);
        setDisplayBoard(before);

        const removed = new Set(
          (frame.cleared_ids || []).filter(Boolean),
        );
        if (!removed.size) {
          (frame.cleared_cells || []).forEach(({ row, col }) => {
            const id = before?.[row]?.[col]?.id;
            if (id) removed.add(id);
          });
        }

        const active = new Set();
        (frame.activated_specials || []).forEach(({ row, col, id }) => {
          const pieceId = id || before?.[row]?.[col]?.id;
          if (pieceId) active.add(pieceId);
        });
        setActivatedIds(active);
        setSpecialEffects(frame.activated_specials || []);
        setRemovingIds(removed);
        setCombo(frame.combo || 1);
        setFlash(frame.combo > 1 ? `КОМБО ×${frame.combo}` : "");

        for (const created of frame.created_specials || []) {
          toast.success(SPECIAL_TOASTS[created.special] || "Бонусна фішка створена!");
        }

        const burstColor = (frame.activated_specials || []).some((item) => item.special === "bomb")
          ? "#FF5C00"
          : (frame.activated_specials || []).some((item) => item.special === "color_bomb")
            ? "#F64CFF"
            : "#B78CFF";
        burstAtCells(frame.cleared_cells || [], burstColor);
        launchScoreFlight(frame.cleared_cells || [], frame.score_gain || 0);

        // Let the exiting pieces receive their removal state before the board
        // advances. The next frame then starts falling pieces immediately,
        // while AnimatePresence keeps removed pieces visible until exit ends.
        await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));

        const collapseFrame = frames[index + 1]?.phase === "collapse" ? frames[index + 1] : null;
        if (collapseFrame?.board) {
          setSpawnedIds(new Set(
            (collapseFrame.spawned_ids || collapseFrame.spawned?.map((item) => item.id) || []).filter(Boolean),
          ));
          setDisplayBoard(normalizeBoard(collapseFrame.board));
          const nextScore = runningScore + Number(frame.score_gain || 0);
          await Promise.all([
            tickScore(runningScore, nextScore),
            wait(reducedMotion ? 70 : Number(collapseFrame.duration_ms || 430)),
          ]);
          runningScore = nextScore;
          index += 1;
        } else {
          await wait(reducedMotion ? 70 : Number(frame.duration_ms || 290));
        }

        setRemovingIds(new Set());
        setSpawnedIds(new Set());
        setActivatedIds(new Set());
        setSpecialEffects([]);
        setFlash("");
        continue;
      }

      if (frame.phase === "collapse" && frame.board) {
        setSpawnedIds(new Set((frame.spawned_ids || []).filter(Boolean)));
        setDisplayBoard(normalizeBoard(frame.board));
        await wait(reducedMotion ? 60 : Number(frame.duration_ms || 430));
        setSpawnedIds(new Set());
        continue;
      }

      if (frame.phase === "reshuffle" && frame.board) {
        setDisplayBoard(normalizeBoard(frame.board));
        await wait(reducedMotion ? 60 : Number(frame.duration_ms || 360));
      }
    }

    if (animation.reshuffled) toast.info("На полі не залишилося ходів. Фішки перемішано");
    setAnimatedScore(data.session.score || runningScore);
    setDisplayBoard(normalizeBoard(data.session.board));
    setGame({ ...data.session, board: normalizeBoard(data.session.board) });
  };

  const makeMove = async (from, to) => {
    if (!game || moving || game.status !== "active") return;
    setMoving(true);
    setSelected(null);
    setFlash("");
    const startingBoard = normalizeBoard(displayBoard.length ? displayBoard : game.board);
    const optimistic = cloneBoard(startingBoard);
    [optimistic[from.row][from.col], optimistic[to.row][to.col]] = [optimistic[to.row][to.col], optimistic[from.row][from.col]];
    setDisplayBoard(optimistic);

    try {
      const request = mode === "mock"
        ? Promise.resolve(runMockMove(game, from, to))
        : api.post("/games/bonus-match/move", {
          session_id: game.id,
          from_row: from.row,
          from_col: from.col,
          to_row: to.row,
          to_col: to.col,
        }).then((response) => response.data);

      const [data] = await Promise.all([
        request,
        wait(reducedMotion ? 20 : 210),
      ]);
      await animateServerMove(data, game.score);

      if (data.result) {
        setResult(data.result);
        if (data.session.status === "won") {
          setBoardFx("won");
          if (!reducedMotion) fireConfetti();
          if (mode !== "mock") await refreshMe().catch(() => {});
        } else {
          setBoardFx("lost");
          await wait(reducedMotion ? 30 : 420);
        }
        if (mode !== "mock") await loadStatus();
      }
    } catch (error) {
      setDisplayBoard(startingBoard);
      toast.error(extractError(error, "Не вдалося виконати хід"));
    } finally {
      setMoving(false);
      setCombo(0);
      window.setTimeout(() => setFlash(""), 600);
    }
  };

  const handlePiece = (row, col) => {
    if (moving || game?.status !== "active") return;
    const cell = displayBoard?.[row]?.[col];
    if (!cell || cell.obstacle) {
      if (cell?.obstacle) toast.info(`${OBSTACLE_NAMES[cell.obstacle] || "Перешкода"}: зруйнуй її збігами поруч`);
      return;
    }
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
    if (game?.status === "active") toast.info("Рівень збережено. Ти зможеш продовжити пізніше");
    setGame(null);
    setDisplayBoard([]);
    setResult(null);
    setBoardFx("");
    loadStatus();
  };

  if (loading && !status && !game) {
    return <div className="px-5 py-12 text-center text-sm font-bold text-zinc-500">Завантаження Bonus Match...</div>;
  }

  return (
    <div className="space-y-4 px-4 pb-8 pt-2" data-testid="bonus-match-page">
      <section className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (game?.status === "active" ? navigate("/") : game ? leaveBoard() : navigate("/"))}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-zinc-300 active:scale-95"
          aria-label="Назад"
        >
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
                <div className="text-[10px] font-black uppercase tracking-[.18em] text-[#B78CFF]">ОБЕРИ РІВЕНЬ</div>
                <div className="mt-1 text-xs font-bold text-zinc-500">Відкрито до {status?.profile?.current_level || 1} рівня</div>
              </div>
              <div className="flex items-center gap-1 text-[#FF4D55]">
                {Array.from({ length: status?.profile?.max_lives || 5 }, (_, index) => (
                  <Heart
                    key={index}
                    size={16}
                    strokeWidth={2.5}
                    fill={index < (status?.profile?.lives || 0) ? "#FF4D55" : "transparent"}
                    color={index < (status?.profile?.lives || 0) ? "#FF4D55" : "#3F3F46"}
                  />
                ))}
              </div>
            </div>

            {(selectedConfig.is_milestone || selectedConfig.is_boss) && (
              <motion.div
                className={`mt-4 rounded-2xl border px-3 py-2.5 ${
                  selectedConfig.is_boss
                    ? "border-[#FF5C00]/45 bg-[#FF5C00]/10"
                    : "border-[#B78CFF]/40 bg-[#B78CFF]/10"
                }`}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className={`text-[10px] font-black uppercase tracking-[.16em] ${selectedConfig.is_boss ? "text-[#FF8A3D]" : "text-[#C9A7FF]"}`}>
                  {selectedConfig.is_boss ? "БОС-РІВЕНЬ" : "РІВЕНЬ-ВИКЛИК"}
                </div>
                <div className="mt-1 text-xs font-bold text-zinc-400">
                  {selectedConfig.new_obstacle
                    ? `Нова перешкода: ${OBSTACLE_NAMES[selectedConfig.new_obstacle]}.`
                    : "Підвищена складність."}
                  {selectedConfig.reward_multiplier > 1 ? ` Нагорода ×${selectedConfig.reward_multiplier}.` : ""}
                </div>
              </motion.div>
            )}

            <div className="mt-5 flex items-center justify-center gap-4">
              <button type="button" onClick={() => chooseLevel(-1)} disabled={selectedLevel <= 1} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-zinc-300 disabled:opacity-30 active:scale-95"><ChevronLeft /></button>
              <div className="min-w-[140px] text-center">
                <div className="font-display text-[52px] leading-none text-white">{selectedLevel}</div>
                <div className="mt-2 flex justify-center"><Stars count={chosenCompletion?.stars || 0} size={21} reducedMotion={reducedMotion} /></div>
              </div>
              <button type="button" onClick={() => chooseLevel(1)} disabled={selectedLevel >= (status?.profile?.current_level || 1)} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-zinc-300 disabled:opacity-30 active:scale-95"><ChevronRight /></button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-white/10 bg-black/25 px-2 py-3 text-center"><div className="text-[9px] font-black uppercase text-zinc-600">ХОДИ</div><div className="mt-1 text-lg font-black text-white">{selectedConfig.moves}</div></div>
              <div className="rounded-2xl border border-[#FFB800]/20 bg-[#FFB800]/[.06] px-2 py-3 text-center"><div className="text-[9px] font-black uppercase text-zinc-600">МОНЕТИ</div><div className="mt-1 text-lg font-black text-[#FFB800]">{selectedConfig.target_coins}</div></div>
              <div className="rounded-2xl border border-[#B78CFF]/20 bg-[#B78CFF]/[.06] px-2 py-3 text-center"><div className="text-[9px] font-black uppercase text-zinc-600">ЦІЛЬ</div><div className="mt-1 text-lg font-black text-[#B78CFF]">{formatNumber(selectedConfig.target_score)}</div></div>
            </div>

            <button
              type="button"
              onClick={() => startGame()}
              disabled={loading || (status?.profile?.lives || 0) <= 0}
              className="mt-5 flex h-14 w-full items-center justify-center gap-3 rounded-2xl border-b-4 border-[#6A3A00] bg-gradient-to-r from-[#FFB800] to-[#FF7A00] font-display text-xl text-[#14100A] shadow-[0_12px_30px_rgba(255,184,0,.2)] active:translate-y-0.5 active:border-b-2 disabled:cursor-not-allowed disabled:grayscale disabled:opacity-50"
            >
              <Gamepad2 size={23} strokeWidth={2.8} />
              ГРАТИ
              <span className="flex items-center gap-1 border-l border-black/20 pl-3 text-sm font-black"><Heart size={15} fill="#14100A" />1</span>
            </button>
            {(status?.profile?.lives || 0) <= 0 && <div className="mt-2 text-center text-[11px] font-bold text-zinc-500">Наступне життя відновиться автоматично через 30 хвилин</div>}
          </section>

          <section className="grid grid-cols-2 gap-3">
            <div className="rounded-3xl border border-[#FFB800]/25 bg-[#1A1A1E] p-4">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-[#FFB800]"><Star size={15} fill="#FFB800" />ЩОДЕННА НАГОРОДА</div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-black/40"><div className="h-full rounded-full bg-gradient-to-r from-[#FFB800] to-[#FF5C00]" style={{ width: `${Math.min(100, ((status?.profile?.daily_points || 0) / Math.max(1, status?.profile?.daily_point_cap || 40)) * 100)}%` }} /></div>
              <div className="mt-2 flex justify-between text-xs font-black"><span className="text-white">{status?.profile?.daily_points || 0}</span><span className="text-zinc-600">/ {status?.profile?.daily_point_cap || 40} Point</span></div>
            </div>
            <div className="rounded-3xl border border-[#B78CFF]/25 bg-[#1A1A1E] p-4">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-[#B78CFF]"><Sparkles size={15} />МІЙ ПРОГРЕС</div>
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
          <motion.section
            className="rounded-3xl border border-[#7C3AED]/40 bg-gradient-to-br from-[#201139] to-[#111114] p-3 shadow-[0_18px_45px_rgba(124,58,237,.18)]"
            animate={
              boardFx === "lost" && !reducedMotion
                ? { x: [0, -8, 8, -6, 6, 0], opacity: 0.58 }
                : { x: 0, opacity: 1 }
            }
            transition={{ duration: boardFx === "lost" ? 0.48 : 0.2 }}
          >
            {(config.is_milestone || config.is_boss) && (
              <div className="mb-3 flex items-center justify-between rounded-2xl border border-[#FF5C00]/25 bg-[#FF5C00]/[.07] px-3 py-2">
                <div className="text-[9px] font-black uppercase tracking-[.16em] text-[#FF8A3D]">{config.is_boss ? "БОС-РІВЕНЬ" : "РІВЕНЬ-ВИКЛИК"}</div>
                {config.reward_multiplier > 1 && <div className="rounded-full bg-[#FFB800]/15 px-2 py-1 text-[9px] font-black text-[#FFB800]">НАГОРОДА ×{config.reward_multiplier}</div>}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-white/10 bg-black/25 px-2 py-2.5 text-center"><div className="text-[8px] font-black uppercase tracking-wider text-zinc-600">РІВЕНЬ</div><div className="mt-0.5 text-lg font-black text-white">{game.level}</div></div>
              <div className="rounded-2xl border border-[#FFB800]/20 bg-[#FFB800]/[.06] px-2 py-2.5 text-center"><div className="text-[8px] font-black uppercase tracking-wider text-zinc-600">ХОДИ</div><div className="mt-0.5 text-lg font-black text-[#FFB800]">{game.moves_left}</div></div>
              <motion.div
                ref={scoreRef}
                className="rounded-2xl border border-[#B78CFF]/20 bg-[#B78CFF]/[.06] px-2 py-2.5 text-center"
                animate={{ scale: scorePulse ? 1.08 : 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 22 }}
              >
                <div className="text-[8px] font-black uppercase tracking-wider text-zinc-600">РАХУНОК</div>
                <div className="mt-0.5 text-lg font-black text-[#B78CFF]">{formatNumber(animatedScore)}</div>
              </motion.div>
            </div>

            <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-white/[.08] bg-black/25 p-3">
              <div>
                <div className="flex items-center justify-between text-[10px] font-black"><span className="text-zinc-500">Ціль: {formatNumber(config.target_score)}</span><span className="text-[#B78CFF]">{scoreProgress}%</span></div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#0A0A0A]"><motion.div className="h-full rounded-full bg-gradient-to-r from-[#7C3AED] to-[#B78CFF]" animate={{ width: `${scoreProgress}%` }} transition={{ duration: reducedMotion ? 0.05 : 0.25 }} /></div>
              </div>
              <div className="flex min-w-[72px] items-center justify-center gap-1.5 rounded-xl border border-[#FFB800]/25 bg-[#FFB800]/10 px-2 py-2 text-[#FFB800]"><Coins size={15} /><span className="text-sm font-black">{game.coins_collected}/{config.target_coins}</span></div>
            </div>

            <motion.div
              ref={boardRef}
              className="relative mt-3 rounded-[22px] border border-[#7C3AED]/55 bg-[#090711] p-1.5 shadow-[inset_0_0_30px_rgba(124,58,237,.12)]"
              animate={boardFx === "won" && !reducedMotion ? { scale: [1, 1.025, 1] } : { scale: 1 }}
              transition={{ duration: 0.45 }}
            >
              <div className="grid grid-cols-7 gap-1" aria-hidden="true">
                {Array.from({ length: ROWS * COLS }, (_, index) => (
                  <div
                    key={`slot-${index}`}
                    className="aspect-square min-w-0 rounded-[10px] border border-white/[.055] bg-[#11101A]"
                  />
                ))}
              </div>

              <LayoutGroup id={`bonus-board-${game.id}`}>
                <div
                  className="absolute inset-1.5 grid grid-cols-7 gap-1"
                  style={{ gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))` }}
                >
                  <AnimatePresence initial={false}>
                    {(displayBoard || []).flatMap((boardRow, row) =>
                      (boardRow || []).map((cell, col) => (cell ? (
                        <Piece
                          key={cell.id}
                          cell={cell}
                          row={row}
                          col={col}
                          selected={selected?.row === row && selected?.col === col}
                          disabled={moving || game.status !== "active"}
                          removing={removingIds.has(cell.id)}
                          shaking={shakingIds.has(cell.id)}
                          spawned={spawnedIds.has(cell.id)}
                          activated={activatedIds.has(cell.id)}
                          removeDelay={(row + col) * 0.012}
                          reducedMotion={reducedMotion}
                          onClick={() => handlePiece(row, col)}
                        />
                      ) : null)),
                    )}
                  </AnimatePresence>
                </div>
              </LayoutGroup>

              <SpecialEffects effects={specialEffects} />

              <AnimatePresence>
                {flash && (
                  <motion.div
                    className="pointer-events-none absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#39FF14]/30 bg-black/80 px-4 py-2 font-display text-lg text-[#39FF14]"
                    initial={{ opacity: 0, scale: 0.5, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 1.25, y: -12 }}
                  >
                    {flash || (combo > 1 ? `КОМБО ×${combo}` : "")}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {scoreFlights.map((flight) => (
                  <motion.div
                    key={flight.id}
                    className="pointer-events-none absolute z-30 text-sm font-black text-[#FFB800]"
                    style={{ left: 0, top: 0 }}
                    initial={{ x: flight.x, y: flight.y, opacity: 0, scale: 0.55 }}
                    animate={{ x: flight.targetX, y: flight.targetY, opacity: [0, 1, 1, 0], scale: [0.55, 1.2, 0.9, 0.55] }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reducedMotion ? 0.12 : 0.68, ease: [0.22, 1, 0.36, 1] }}
                  >
                    +{flight.amount}
                  </motion.div>
                ))}
              </AnimatePresence>

              {moving && (
                <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1">
                  {[0, 1, 2].map((dot) => (
                    <motion.span
                      key={dot}
                      className="h-1.5 w-1.5 rounded-full bg-[#B78CFF]"
                      animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: dot * 0.1 }}
                    />
                  ))}
                </div>
              )}
            </motion.div>

            <div className="mt-3 flex items-center justify-between px-1 text-[10px] font-bold text-zinc-600"><span>Натисни фішку, потім сусідню</span><span>{coinProgress}% монет</span></div>
          </motion.section>

          <AnimatePresence>
            {game.status !== "active" && (
              <motion.section
                className={`rounded-3xl border p-5 text-center ${game.status === "won" ? "border-[#39FF14]/35 bg-[#39FF14]/[.07]" : "border-[#FF4D55]/35 bg-[#FF4D55]/[.07]"}`}
                initial={{ opacity: 0, y: 18, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ type: "spring", stiffness: 320, damping: 24 }}
              >
                <div className={`font-display text-[27px] ${game.status === "won" ? "text-[#39FF14]" : "text-[#FF4D55]"}`}>{game.status === "won" ? "РІВЕНЬ ПРОЙДЕНО!" : "ХОДИ ЗАКІНЧИЛИСЯ"}</div>
                <div className="mt-3 flex justify-center"><Stars count={result?.stars || 0} size={30} animated={game.status === "won"} reducedMotion={reducedMotion} /></div>
                <div className="mt-3 text-sm font-bold text-zinc-400">Рахунок: <span className="font-black text-white">{formatNumber(game.score)}</span></div>
                {game.status === "won" && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-2xl border border-[#FFB800]/25 bg-[#FFB800]/10 p-3"><div className="text-[9px] font-black uppercase text-zinc-600">НАГОРОДА</div><div className="mt-1 text-xl font-black text-[#FFB800]">+{result?.points_awarded || 0} Point</div></div>
                    <div className="rounded-2xl border border-[#00F0FF]/25 bg-[#00F0FF]/10 p-3"><div className="text-[9px] font-black uppercase text-zinc-600">ДОСВІД</div><div className="mt-1 text-xl font-black text-[#00F0FF]">+{result?.xp_awarded || 0} XP</div></div>
                  </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => { setGame(null); setDisplayBoard([]); setResult(null); setBoardFx(""); loadStatus(); }} className="flex h-12 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-sm font-black text-zinc-300 active:scale-95"><RotateCcw size={17} className="mr-2" />РІВНІ</button>
                  <button type="button" onClick={() => startGame(game.status === "won" ? Math.min(MAX_LEVEL, result?.current_level || game.level + 1) : game.level)} className="flex h-12 items-center justify-center rounded-2xl bg-[#7C3AED] text-sm font-black text-white active:scale-95">{game.status === "won" ? "ДАЛІ" : "ЩЕ РАЗ"}<ChevronRight size={17} className="ml-1" /></button>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </>
      )}

      <AnimatePresence>
        {bossPrompt && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 px-5 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-sm rounded-[28px] border border-[#FF5C00]/45 bg-gradient-to-br from-[#2A0F09] via-[#181216] to-[#0B0B0E] p-5 text-center"
              initial={{ opacity: 0, scale: 0.82, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 12 }}
              transition={{ type: "spring", stiffness: 330, damping: 24 }}
            >
              <motion.div
                className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border border-[#FF5C00]/50 bg-[#FF5C00]/15"
                animate={reducedMotion ? undefined : { rotate: [0, -5, 5, 0], scale: [1, 1.06, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              >
                <Trophy size={42} color="#FFB800" />
              </motion.div>
              <div className="mt-4 font-display text-3xl text-[#FFB800]">БОС-РІВЕНЬ</div>
              <div className="mt-2 text-sm font-bold leading-relaxed text-zinc-400">Рівень {bossPrompt.level} має посилену ціль, менше ходів і складні перешкоди.</div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-black/30 p-2"><div className="text-[8px] font-black uppercase text-zinc-600">ХОДИ</div><div className="mt-1 font-black text-white">{bossPrompt.moves}</div></div>
                <div className="rounded-xl bg-black/30 p-2"><div className="text-[8px] font-black uppercase text-zinc-600">ЦІЛЬ</div><div className="mt-1 font-black text-[#B78CFF]">{formatNumber(bossPrompt.target_score)}</div></div>
                <div className="rounded-xl bg-black/30 p-2"><div className="text-[8px] font-black uppercase text-zinc-600">БОНУС</div><div className="mt-1 font-black text-[#FFB800]">×{bossPrompt.reward_multiplier}</div></div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setBossPrompt(null)} className="h-12 rounded-2xl border border-white/10 bg-[#1A1A1E] text-sm font-black text-zinc-300">НАЗАД</button>
                <button type="button" onClick={() => startGame(bossPrompt.level, true)} className="h-12 rounded-2xl bg-gradient-to-r from-[#FFB800] to-[#FF5C00] text-sm font-black text-[#17100A]">ПРИЙНЯТИ ВИКЛИК</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
