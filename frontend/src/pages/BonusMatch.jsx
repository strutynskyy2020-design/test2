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
  Hammer,
  Heart,
  Lock,
  Plus,
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
const MAX_LEVEL = 200;
const SYMBOLS = ["coin", "star", "gift", "cube", "zap", "trophy"];
const BOSS_LEVELS = { 25: 2, 40: 2, 50: 3 };
const OBSTACLE_ORDER = ["ice", "chain", "crate", "stone", "crystal", "web", "shield", "slime", "metal", "core"];
const OVERLAY_OBSTACLES = new Set(["chain", "web"]);
const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
const coordKey = (row, col) => `${row}:${col}`;
const cloneBoard = (board) => (board || []).map((row) => row.map((cell) => (cell ? { ...cell } : null)));

const PIECES = {
  coin: { Icon: Coins, label: "Монета", color: "#FFB800", image: "/bonus-match/pieces/coin.webp" },
  star: { Icon: Star, label: "Зірка", color: "#35B8FF", image: "/bonus-match/pieces/star.webp" },
  gift: { Icon: Gift, label: "Подарунок", color: "#F64CFF", image: "/bonus-match/pieces/gift.webp" },
  cube: { Icon: Dice5, label: "Куб", color: "#39FF14", image: "/bonus-match/pieces/cube.webp" },
  zap: { Icon: Zap, label: "Блискавка", color: "#FF5C00", image: "/bonus-match/pieces/zap.webp" },
  trophy: { Icon: Trophy, label: "Трофей", color: "#B78CFF", image: "/bonus-match/pieces/trophy.webp" },
};

const SPECIALS = {
  rocket_row: { Icon: Rocket, label: "Ракета по рядку", color: "#FFB800", rotate: 45 },
  rocket_col: { Icon: Rocket, label: "Ракета по колонці", color: "#00F0FF", rotate: -45 },
  bomb: { Icon: Bomb, label: "Бомба", color: "#FF5C00", rotate: 0 },
  color_bomb: { Icon: CircleDot, label: "Блискавка-джокер", color: "#F64CFF", rotate: 0 },
};

const OBSTACLES = {
  ice: { Icon: Snowflake, label: "Крига", color: "#7DD3FC", image: "/bonus-match/obstacles/ice.webp" },
  chain: { Icon: Lock, label: "Ланцюг", color: "#A1A1AA", image: "/bonus-match/obstacles/chain.webp" },
  crate: { Icon: Box, label: "Ящик", color: "#FDBA74", image: "/bonus-match/obstacles/crate.webp" },
  stone: { Icon: Shield, label: "Камінь", color: "#D4D4D8", image: "/bonus-match/obstacles/stone.webp" },
  crystal: { Icon: Gem, label: "Кристал", color: "#C084FC", image: "/bonus-match/obstacles/crystal.webp" },
  web: { Icon: Sparkles, label: "Павутина", color: "#E4E4E7", image: "/bonus-match/obstacles/web.webp" },
  shield: { Icon: Shield, label: "Щит", color: "#60A5FA", image: "/bonus-match/obstacles/shield.webp" },
  slime: { Icon: CircleDot, label: "Слиз", color: "#4ADE80", image: "/bonus-match/obstacles/slime.webp" },
  metal: { Icon: Shield, label: "Метал", color: "#CBD5E1", image: "/bonus-match/obstacles/metal.webp" },
  core: { Icon: Zap, label: "Ядро", color: "#FF4D55", image: "/bonus-match/obstacles/core.webp" },
};

const BONUS_MATCH_ARTWORK = [
  ...Object.values(PIECES).map((item) => item.image),
  ...Object.values(OBSTACLES).map((item) => item.image),
].filter(Boolean);

const SPECIAL_TOASTS = {
  rocket_row: "Ракета створена!",
  rocket_col: "Ракета створена!",
  bomb: "Бомба готова!",
  color_bomb: "Джокер зібрано!",
};

const BOOSTERS = {
  hammer: { Icon: Hammer, label: "Молоток", short: "Прибрати одну фішку або перешкоду", color: "#B78CFF" },
  rocket: { Icon: Rocket, label: "Ракета", short: "Очистити рядок і колонку", color: "#FF5C00" },
  color_bomb: { Icon: CircleDot, label: "Райдужний джокер", short: "Прибрати всі фішки одного типу", color: "#F64CFF" },
  shuffle: { Icon: RotateCcw, label: "Перемішати", short: "Повністю перемішати поле", color: "#00F0FF" },
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

const OBSTACLE_HELP = {
  ice: "Крига: розбий двома збігами поруч або спецфішкою",
  chain: "Ланцюг: закута фішка не рухається, але може входити у збіг",
  crate: "Ящик: розбий двома збігами поруч, усередині буде нова фішка",
  stone: "Камінь: міцний блок, витримує три удари",
  crystal: "Кристал: після руйнування очищує сусідні клітинки хрестом",
  web: "Павутина: звільни фішку збігом, інакше павутина розростатиметься",
  shield: "Щит: спецфішки пробивають одразу два шари",
  slime: "Слиз: поширюється після ходу, якщо його не пошкодити",
  metal: "Метал: пошкоджується тільки спецфішками або бустерами",
  core: "Ядро: бий спецфішками або комбінаціями 4+, після руйнування вибухне 3×3",
};

const makeCell = (symbol = null, extras = {}) => ({
  id: extras.id || `mock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  symbol,
  special: extras.special || null,
  obstacle: extras.obstacle || null,
  obstacle_hits: extras.obstacle_hits || 0,
  obstacle_age: extras.obstacle_age || 0,
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
    obstacle_age: Number(cell.obstacle_age || 0),
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
  if (!cell || cell.special === "color_bomb") return null;
  if (cell.obstacle && !OVERLAY_OBSTACLES.has(cell.obstacle)) return null;
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
        const hits = obstacle === "core" ? 4 : ["stone", "shield", "metal"].includes(obstacle) ? 3 : obstacle === "web" ? 1 : 2;
        if (OVERLAY_OBSTACLES.has(obstacle)) {
          board[row][col] = { ...board[row][col], obstacle, obstacle_hits: hits, obstacle_age: 0, special: null };
        } else {
          board[row][col] = makeCell(null, { obstacle, obstacle_hits: hits });
        }
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

  let reshuffled = false;
  if (!hasPossibleMove(board)) {
    const fresh = makeMockBoard(game.level);
    fresh.forEach((row, rowIndex) => row.forEach((cell, colIndex) => { board[rowIndex][colIndex] = cell; }));
    reshuffled = true;
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
    animation: { swapped_board: swapped, steps, reshuffled, reason: reshuffled ? "no_moves" : null },
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

const cellBoxStyle = (row, col, size = 1) => ({
  width: `${(size / COLS) * 100}%`,
  height: `${(size / ROWS) * 100}%`,
  left: `${((col + 0.5 - size / 2) / COLS) * 100}%`,
  top: `${((row + 0.5 - size / 2) / ROWS) * 100}%`,
});

const boardMotionForFx = (fx, reducedMotion) => {
  if (reducedMotion) return { x: 0, y: 0, scale: 1, rotate: 0 };
  if (fx === "won") return { scale: [1, 1.025, 0.995, 1], x: 0, y: 0, rotate: 0 };
  if (fx === "rocket") return { x: [0, -3, 4, -2, 0], y: 0, scale: [1, 1.006, 1], rotate: 0 };
  if (fx === "bomb") return { x: [0, -5, 5, -3, 3, 0], y: [0, 2, -2, 0], scale: [1, 0.985, 1.018, 1], rotate: 0 };
  if (fx === "color_bomb") return { x: [0, -2, 2, 0], y: [0, 1, -1, 0], scale: [1, 1.018, 0.994, 1], rotate: [0, -0.45, 0.45, 0] };
  if (fx === "core") return { x: [0, -7, 7, -5, 5, -2, 2, 0], y: [0, 3, -3, 0], scale: [1, 0.975, 1.025, 1], rotate: 0 };
  if (fx === "heavy") return { x: [0, -3, 3, -1, 0], y: [0, 3, -1, 0], scale: 1, rotate: 0 };
  if (fx === "slime") return { x: [0, 2, -2, 0], y: [0, 2, -1, 0], scale: [1, 1.01, 0.995, 1], rotate: [0, 0.3, -0.3, 0] };
  if (fx === "web") return { x: [0, -1, 1, 0], y: 0, scale: [1, 1.006, 1], rotate: 0 };
  if (fx === "match") return { scale: [1, 1.008, 1], x: 0, y: 0, rotate: 0 };
  return { x: 0, y: 0, scale: 1, rotate: 0 };
};

const obstacleImageMotion = (obstacle, impact, reducedMotion) => {
  if (!impact || reducedMotion) {
    if (obstacle === "core") return { scale: [1, 1.045, 1], rotate: [0, 1.5, 0] };
    if (obstacle === "slime") return { scaleX: [1, 1.035, 0.985, 1], scaleY: [1, 0.98, 1.03, 1] };
    return { scale: 1, rotate: 0, x: 0, y: 0, opacity: 1 };
  }
  const destroyed = Boolean(impact.destroyed);
  const motions = {
    ice: { x: [0, -3, 3, -2, 2, 0], scale: [1, 1.08, 0.96, 1], rotate: [0, -2, 2, 0] },
    chain: { x: [0, -6, 6, -4, 4, 0], rotate: [0, -5, 5, 0], scale: [1, 1.04, 0.98, 1] },
    crate: { y: [0, -5, 2, 0], rotate: [0, -5, 4, 0], scale: [1, 1.08, 0.98, 1] },
    stone: { y: [0, 4, -2, 1, 0], x: [0, -2, 2, 0], scale: [1, 0.97, 1.025, 1] },
    crystal: { scale: [1, 1.18, 0.9, 1.08, 1], rotate: [0, -4, 4, 0] },
    web: { scale: [1, 1.07, 0.92, 1], rotate: [0, 3, -3, 0] },
    shield: { x: [0, -4, 4, -2, 0], scale: [1, 0.94, 1.08, 1], rotateY: [0, 14, -7, 0] },
    slime: { scaleX: [1, 1.22, 0.84, 1.08, 1], scaleY: [1, 0.8, 1.22, 0.94, 1], y: [0, 3, -2, 0] },
    metal: { x: [0, -2, 2, -2, 2, 0], y: [0, 2, 0], scale: [1, 0.985, 1.015, 1] },
    core: { scale: [1, 0.86, 1.2, 0.98, 1.08], rotate: [0, -4, 4, 0], x: [0, -4, 4, 0] },
  };
  const motion = motions[obstacle] || motions.stone;
  if (!destroyed) return motion;
  return {
    ...motion,
    opacity: [1, 1, 0.72],
  };
};

const specialIconMotion = (special, activated, reducedMotion) => {
  if (!special) return undefined;
  if (reducedMotion) return { scale: activated ? 1.12 : 1 };
  if (activated) {
    if (special === "rocket_row") return { scale: [1, 0.82, 1.24], x: [0, -5, 9], rotate: [45, 40, 45] };
    if (special === "rocket_col") return { scale: [1, 0.82, 1.24], y: [0, 5, -9], rotate: [-45, -50, -45] };
    if (special === "bomb") return { scale: [1, 1.18, 0.9, 1.36], rotate: [0, -8, 8, 0] };
    return { scale: [1, 0.76, 1.28], rotate: [0, 140, 320], opacity: [1, 0.9, 1] };
  }
  if (special === "rocket_row") return { x: [0, 2, 0], scale: [0.96, 1.04, 0.96] };
  if (special === "rocket_col") return { y: [0, -2, 0], scale: [0.96, 1.04, 0.96] };
  if (special === "bomb") return { scale: [0.94, 1.07, 0.94], rotate: [0, 2, 0] };
  return { rotate: [0, 360], scale: [0.94, 1.04, 0.94] };
};

function Piece({
  cell,
  selected,
  disabled,
  targetable = false,
  removing,
  shaking,
  spawned,
  activated,
  impact,
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
  const overlayObstacle = Boolean(cell.obstacle && OVERLAY_OBSTACLES.has(cell.obstacle));
  const ArtworkIcon = obstacle?.Icon || piece.Icon;
  const SpecialIcon = special?.Icon || null;
  const color = obstacle?.color || special?.color || piece.color;
  const background = "#0A0811";
  const label = obstacle?.label || special?.label || piece.label;
  const shakeAnimation = shaking && !reducedMotion ? [0, -7, 7, -6, 6, -3, 3, 0] : 0;
  const impactMotion = obstacleImageMotion(cell.obstacle, impact, reducedMotion);
  const impactTransition = impact
    ? { duration: reducedMotion ? 0.06 : impact.destroyed ? 0.5 : 0.38, ease: [0.22, 1, 0.36, 1] }
    : cell.obstacle === "core" || cell.obstacle === "slime"
      ? { duration: cell.obstacle === "core" ? 1.75 : 1.45, repeat: Infinity, ease: "easeInOut" }
      : { duration: 0.2 };
  const specialMotion = specialIconMotion(cell.special, activated, reducedMotion);
  const specialTransition = activated
    ? { duration: reducedMotion ? 0.05 : cell.special === "color_bomb" ? 0.34 : 0.28, ease: [0.22, 1, 0.36, 1] }
    : { duration: cell.special === "color_bomb" ? 2.8 : 1.2, repeat: Infinity, ease: "easeInOut" };

  return (
    <motion.button
      layout="position"
      layoutId={`bonus-piece-${cell.id}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${label}, рядок ${row + 1}, колонка ${col + 1}`}
      className="relative flex aspect-square min-w-0 touch-manipulation items-center justify-center overflow-hidden rounded-[10px] border border-white/10"
      style={{
        background,
        gridRowStart: row + 1,
        gridColumnStart: col + 1,
      }}
      initial={spawned && !reducedMotion ? { y: -84, opacity: 0, scale: 0.68 } : { opacity: 1, scale: 1 }}
      animate={{
        x: shakeAnimation,
        y: 0,
        opacity: removing ? 0 : 1,
        scale: removing ? 0.12 : selected ? 1.12 : activated ? 1.08 : 1,
        rotate: removing ? (cell.obstacle === "slime" ? 0 : 18) : 0,
      }}
      exit={reducedMotion
        ? { opacity: 0, transition: { duration: 0.05 } }
        : cell.obstacle === "slime"
          ? { opacity: 0, scaleX: 1.45, scaleY: 0.08, y: 10, transition: { duration: 0.34, delay: removeDelay } }
          : cell.obstacle === "stone" || cell.obstacle === "metal"
            ? { opacity: 0, scale: 0.62, y: 12, rotate: 8, transition: { duration: 0.42, delay: removeDelay, ease: "easeIn" } }
            : {
              opacity: 0,
              scale: 0,
              rotate: cell.special === "color_bomb" ? 120 : 28,
              transition: { duration: 0.32, delay: removeDelay, ease: "easeIn" },
            }}
      whileTap={disabled ? undefined : { scale: obstacle && !targetable ? 0.96 : 0.86 }}
      transition={
        shaking
          ? { duration: reducedMotion ? 0.01 : 0.32, ease: "easeInOut" }
          : {
            layout: { duration: reducedMotion ? 0.05 : 0.3, ease: [0.22, 1, 0.36, 1] },
            y: { type: "spring", stiffness: 470, damping: 19, bounce: 0.3 },
            scale: { type: "spring", stiffness: 430, damping: 23, delay: removing ? removeDelay : 0 },
            opacity: { duration: reducedMotion ? 0.05 : 0.24, delay: removing ? removeDelay : 0 },
            rotate: { duration: reducedMotion ? 0.05 : 0.3, delay: removing ? removeDelay : 0 },
          }
      }
    >
      <div className="absolute inset-0 bg-[#0A0811]" />
      <ArtworkIcon
        className="relative z-[1] opacity-0"
        size={24}
        strokeWidth={2.8}
        color={color}
        aria-hidden="true"
      />
      {!obstacle && piece.image && (
        <motion.img
          src={piece.image}
          alt=""
          draggable="false"
          decoding="async"
          className="pointer-events-none absolute inset-0 z-[2] h-full w-full select-none object-cover"
          animate={activated && !reducedMotion ? { scale: [1, 0.9, 1.12], rotate: [0, -3, 3, 0] } : { scale: 1, rotate: 0 }}
          transition={{ duration: activated ? 0.28 : 0.2 }}
        />
      )}
      {overlayObstacle && piece.image && (
        <motion.img
          src={piece.image}
          alt=""
          draggable="false"
          decoding="async"
          className="pointer-events-none absolute inset-[9%] z-[2] h-[82%] w-[82%] select-none object-contain"
          animate={impact && !reducedMotion ? { scale: [1, 0.9, 1.08, 1] } : { scale: 1 }}
          transition={{ duration: impact ? 0.42 : 0.2 }}
        />
      )}
      {obstacle?.image && (
        <motion.img
          key={`${cell.id}-${impact?.token || "steady"}`}
          src={obstacle.image}
          alt=""
          draggable="false"
          decoding="async"
          className={`pointer-events-none absolute inset-0 z-[3] h-full w-full select-none object-cover ${overlayObstacle ? "opacity-[0.84]" : ""}`}
          style={overlayObstacle && cell.obstacle === "web" ? { mixBlendMode: "screen" } : undefined}
          animate={impactMotion}
          transition={impactTransition}
        />
      )}
      <div className="pointer-events-none absolute inset-0 z-[4] bg-gradient-to-br from-white/8 via-transparent to-black/10" />
      {impact && (
        <motion.div
          key={`impact-glint-${impact.token}`}
          className="pointer-events-none absolute inset-0 z-[5] bg-white"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, impact.destroyed ? 0.38 : 0.22, 0] }}
          transition={{ duration: reducedMotion ? 0.06 : 0.28 }}
        />
      )}
      {special && (
        <motion.div
          className="pointer-events-none absolute inset-[1px] z-[5] rounded-[9px] border-2"
          style={{ borderColor: special.color }}
          animate={activated && !reducedMotion
            ? { opacity: [0.35, 1, 0.7], scale: [1, 1.08, 1] }
            : reducedMotion ? { opacity: 0.55 } : { opacity: [0.35, 0.85, 0.35] }}
          transition={activated ? { duration: 0.28 } : { duration: 1.25, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {special && cell.special !== "color_bomb" && SpecialIcon && (
        <motion.div
          className="pointer-events-none absolute inset-0 z-[6] flex items-center justify-center"
          animate={specialMotion}
          transition={specialTransition}
        >
          <span className="flex h-[62%] w-[62%] items-center justify-center rounded-full border border-white/45 bg-black/60 shadow-[0_0_14px_rgba(183,140,255,.55)] backdrop-blur-[1px]">
            <SpecialIcon
              size={24}
              strokeWidth={3.1}
              color={special.color}
              style={{ transform: special.rotate ? `rotate(${special.rotate}deg)` : undefined }}
            />
          </span>
        </motion.div>
      )}
      {cell.special === "color_bomb" && (
        <motion.div
          className="pointer-events-none absolute inset-[6px] z-[6] rounded-full border-2 border-white/80 bg-[conic-gradient(#FFB800,#F64CFF,#00F0FF,#39FF14,#FF5C00,#FFB800)] opacity-85 shadow-[0_0_14px_rgba(246,76,255,.7)]"
          animate={specialMotion}
          transition={specialTransition}
        >
          <motion.div
            className="absolute inset-[22%] rounded-full bg-white/75"
            animate={reducedMotion ? undefined : { scale: [0.7, 1.25, 0.7], opacity: [0.35, 0.9, 0.35] }}
            transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.div>
      )}
      <AnimatePresence>
        {selected && (
          <motion.div
            className="pointer-events-none absolute inset-[2px] z-[7] rounded-[8px] border-2 border-white"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 0.98, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 500, damping: 25 }}
          />
        )}
      </AnimatePresence>
      {obstacle && (
        <motion.div
          className="absolute bottom-0.5 right-0.5 z-[8] flex h-4 min-w-4 items-center justify-center rounded-full border border-white/25 bg-black/85 px-1 text-[8px] font-black text-white"
          animate={impact && !reducedMotion ? { scale: [1, 1.35, 0.92, 1] } : { scale: 1 }}
          transition={{ duration: 0.34 }}
        >
          {cell.obstacle_hits}
        </motion.div>
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

function FxParticles({ row, col, color, count = 8, distance = 34, delay = 0, reducedMotion = false, square = false }) {
  if (reducedMotion) return null;
  return Array.from({ length: count }, (_, index) => {
    const angle = ((Math.PI * 2) / count) * index + (index % 2) * 0.17;
    const radius = distance * (0.72 + (index % 3) * 0.14);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    return (
      <motion.span
        key={`particle-${index}`}
        className={`pointer-events-none absolute z-30 ${square ? "h-2.5 w-2.5 rounded-[2px]" : "h-2 w-2 rounded-full"}`}
        style={{
          left: `${((col + 0.5) / COLS) * 100}%`,
          top: `${((row + 0.5) / ROWS) * 100}%`,
          background: color,
          boxShadow: `0 0 8px ${color}`,
        }}
        initial={{ x: -4, y: -4, scale: 0.2, opacity: 0 }}
        animate={{ x, y, scale: [0.2, 1.15, 0.1], opacity: [0, 1, 0], rotate: square ? [0, 90, 180] : 0 }}
        transition={{ duration: 0.48, delay: delay + index * 0.018, ease: "easeOut" }}
      />
    );
  });
}

function FxCellFlash({ row, col, color, delay = 0, reducedMotion = false }) {
  return (
    <motion.div
      className="pointer-events-none absolute z-20 rounded-[10px] border-2"
      style={{ ...cellBoxStyle(row, col), borderColor: color, background: `${color}2E` }}
      initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.55 }}
      animate={{ opacity: [0, 0.95, 0], scale: reducedMotion ? 1 : [0.55, 1.12, 0.88] }}
      transition={{ duration: reducedMotion ? 0.12 : 0.36, delay, ease: "easeOut" }}
    />
  );
}

function FxRing({ row, col, color, size = 1.7, delay = 0, duration = 0.42, reducedMotion = false, border = 4 }) {
  return (
    <motion.div
      className="pointer-events-none absolute z-20 aspect-square rounded-full"
      style={{ ...cellBoxStyle(row, col, size), border: `${border}px solid ${color}` }}
      initial={{ opacity: 0.95, scale: reducedMotion ? 1 : 0.12 }}
      animate={{ opacity: 0, scale: reducedMotion ? 1 : 1.35 }}
      transition={{ duration: reducedMotion ? 0.12 : duration, delay, ease: "easeOut" }}
    />
  );
}

function FxSpecialCharge({ effect, reducedMotion }) {
  const special = effect.special;
  const color = special === "rocket_col" ? "#00F0FF" : special === "bomb" ? "#FF5C00" : special === "color_bomb" ? "#F64CFF" : "#FFB800";
  const Icon = special === "bomb" ? Bomb : special === "color_bomb" ? CircleDot : Rocket;
  return (
    <>
      <motion.div
        className="pointer-events-none absolute z-40 flex items-center justify-center rounded-full"
        style={{ ...cellBoxStyle(effect.row, effect.col, 1.35), background: `${color}24` }}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: reducedMotion ? 1 : [0.5, 1.18, 0.92, 1.08], opacity: [0, 1, 0.85, 0] }}
        transition={{ duration: reducedMotion ? 0.12 : special === "color_bomb" ? 0.42 : 0.32, ease: "easeOut" }}
      >
        <motion.span
          className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white/70 bg-black/75"
          animate={reducedMotion ? undefined : special === "color_bomb" ? { rotate: 360 } : { scale: [0.88, 1.12, 0.88] }}
          transition={{ duration: special === "color_bomb" ? 0.38 : 0.24, ease: "easeInOut" }}
        >
          <Icon size={21} color={color} strokeWidth={3} />
        </motion.span>
      </motion.div>
      <FxRing row={effect.row} col={effect.col} color={color} size={1.55} duration={0.35} reducedMotion={reducedMotion} border={2} />
      <FxRing row={effect.row} col={effect.col} color="#FFFFFF" size={1.15} delay={0.06} duration={0.28} reducedMotion={reducedMotion} border={2} />
    </>
  );
}

const lightningPath = (fromRow, fromCol, toRow, toCol, index = 0) => {
  const x1 = fromCol + 0.5;
  const y1 = fromRow + 0.5;
  const x2 = toCol + 0.5;
  const y2 = toRow + 0.5;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
  const px = -dy / length;
  const py = dx / length;
  const wobble = 0.11 + (index % 3) * 0.035;
  const p1x = x1 + dx * 0.32 + px * wobble;
  const p1y = y1 + dy * 0.32 + py * wobble;
  const p2x = x1 + dx * 0.58 - px * wobble * 1.15;
  const p2y = y1 + dy * 0.58 - py * wobble * 1.15;
  const p3x = x1 + dx * 0.8 + px * wobble * 0.7;
  const p3y = y1 + dy * 0.8 + py * wobble * 0.7;
  return `M ${x1} ${y1} L ${p1x} ${p1y} L ${p2x} ${p2y} L ${p3x} ${p3y} L ${x2} ${y2}`;
};

function FxColorBomb({ effect, reducedMotion }) {
  const targets = (effect.targets || []).filter((target) => target.row !== effect.row || target.col !== effect.col).slice(0, 24);
  return (
    <>
      <motion.svg
        className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible"
        viewBox={`0 0 ${COLS} ${ROWS}`}
        preserveAspectRatio="none"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0] }}
        transition={{ duration: reducedMotion ? 0.16 : 0.72 }}
      >
        {targets.map((target, index) => (
          <motion.path
            key={`lightning-${target.row}-${target.col}-${index}`}
            d={lightningPath(effect.row, effect.col, target.row, target.col, index)}
            fill="none"
            stroke={index % 3 === 0 ? "#FFFFFF" : index % 3 === 1 ? "#F64CFF" : "#00F0FF"}
            strokeWidth={index % 3 === 0 ? 0.09 : 0.065}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: [0, 1, 0.85, 0] }}
            transition={{ duration: reducedMotion ? 0.12 : 0.36, delay: reducedMotion ? 0 : Math.floor(index / 5) * 0.07, ease: "easeOut" }}
          />
        ))}
      </motion.svg>
      <FxRing row={effect.row} col={effect.col} color="#F64CFF" size={2.1} duration={0.55} reducedMotion={reducedMotion} border={4} />
      <FxParticles row={effect.row} col={effect.col} color="#F64CFF" count={10} distance={46} reducedMotion={reducedMotion} />
      {targets.map((target, index) => (
        <FxCellFlash
          key={`joker-flash-${target.row}-${target.col}-${index}`}
          row={target.row}
          col={target.col}
          color={index % 2 ? "#00F0FF" : "#F64CFF"}
          delay={reducedMotion ? 0 : Math.floor(index / 5) * 0.07 + 0.08}
          reducedMotion={reducedMotion}
        />
      ))}
    </>
  );
}

function FxRocket({ effect, reducedMotion }) {
  const rowRocket = effect.special === "rocket_row";
  const color = rowRocket ? "#FFB800" : "#00F0FF";
  const targets = (effect.targets || []).slice(0, 14);
  return (
    <>
      <motion.div
        className={`pointer-events-none absolute z-30 rounded-full ${rowRocket ? "left-0 right-0 h-[9px]" : "bottom-0 top-0 w-[9px]"}`}
        style={rowRocket
          ? { top: `${((effect.row + 0.5) / ROWS) * 100}%`, background: `linear-gradient(90deg,transparent,${color},#FFFFFF,${color},transparent)` }
          : { left: `${((effect.col + 0.5) / COLS) * 100}%`, background: `linear-gradient(180deg,transparent,${color},#FFFFFF,${color},transparent)` }}
        initial={rowRocket ? { scaleX: 0, opacity: 0 } : { scaleY: 0, opacity: 0 }}
        animate={rowRocket ? { scaleX: 1, opacity: [0, 1, 1, 0] } : { scaleY: 1, opacity: [0, 1, 1, 0] }}
        transition={{ duration: reducedMotion ? 0.14 : 0.42, ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.div
        className="pointer-events-none absolute z-40 flex items-center justify-center"
        style={cellBoxStyle(effect.row, effect.col, 1.05)}
        initial={{ opacity: 1, scale: 0.7, x: 0, y: 0 }}
        animate={rowRocket
          ? { opacity: [1, 1, 0], scale: [0.7, 1.2, 0.8], x: [0, reducedMotion ? 0 : 130] }
          : { opacity: [1, 1, 0], scale: [0.7, 1.2, 0.8], y: [0, reducedMotion ? 0 : -130] }}
        transition={{ duration: reducedMotion ? 0.14 : 0.42, ease: "easeIn" }}
      >
        <Rocket size={28} color={color} strokeWidth={3.2} style={{ transform: `rotate(${rowRocket ? 45 : -45}deg)` }} />
      </motion.div>
      {targets.map((target, index) => (
        <FxCellFlash
          key={`rocket-target-${target.row}-${target.col}-${index}`}
          row={target.row}
          col={target.col}
          color={color}
          delay={reducedMotion ? 0 : index * 0.022}
          reducedMotion={reducedMotion}
        />
      ))}
    </>
  );
}

function FxBomb({ effect, reducedMotion }) {
  const targets = (effect.targets || []).slice(0, 12);
  return (
    <>
      <motion.div
        className="pointer-events-none absolute z-30 rounded-full bg-white"
        style={cellBoxStyle(effect.row, effect.col, 0.75)}
        initial={{ scale: 0.15, opacity: 1 }}
        animate={{ scale: reducedMotion ? 1 : [0.15, 1.2, 0.25], opacity: [1, 0.95, 0] }}
        transition={{ duration: reducedMotion ? 0.12 : 0.34, ease: "easeOut" }}
      />
      <FxRing row={effect.row} col={effect.col} color="#FFB800" size={2.15} duration={0.46} reducedMotion={reducedMotion} border={4} />
      <FxRing row={effect.row} col={effect.col} color="#FF5C00" size={3.25} delay={0.05} duration={0.52} reducedMotion={reducedMotion} border={5} />
      <FxParticles row={effect.row} col={effect.col} color="#FF5C00" count={12} distance={54} reducedMotion={reducedMotion} square />
      {targets.map((target, index) => (
        <FxCellFlash
          key={`bomb-target-${target.row}-${target.col}-${index}`}
          row={target.row}
          col={target.col}
          color={index % 2 ? "#FFB800" : "#FF5C00"}
          delay={reducedMotion ? 0 : (Math.abs(target.row - effect.row) + Math.abs(target.col - effect.col)) * 0.045}
          reducedMotion={reducedMotion}
        />
      ))}
    </>
  );
}

function FxObstacle({ effect, reducedMotion }) {
  const obstacle = effect.obstacle;
  if (!obstacle) return null;
  const destroyed = Boolean(effect.destroyed);
  const color = OBSTACLES[obstacle]?.color || "#B78CFF";
  const count = destroyed ? 10 : 5;
  const common = (
    <>
      <FxCellFlash row={effect.row} col={effect.col} color={color} reducedMotion={reducedMotion} />
      <FxParticles row={effect.row} col={effect.col} color={color} count={count} distance={destroyed ? 44 : 27} reducedMotion={reducedMotion} square={["crate", "stone", "metal"].includes(obstacle)} />
    </>
  );

  if (obstacle === "ice") {
    return (
      <>{common}
        {[0, 1, 2].map((line) => (
          <motion.span
            key={`ice-line-${line}`}
            className="pointer-events-none absolute z-40 h-[2px] origin-left bg-white/90"
            style={{
              left: `${((effect.col + 0.5) / COLS) * 100}%`,
              top: `${((effect.row + 0.5) / ROWS) * 100}%`,
              width: `${7 + line * 2}%`,
            }}
            initial={{ scaleX: 0, rotate: -58 + line * 54, opacity: 0 }}
            animate={{ scaleX: 1, opacity: [0, 1, 0] }}
            transition={{ duration: reducedMotion ? 0.12 : 0.34, delay: line * 0.035 }}
          />
        ))}
      </>
    );
  }

  if (obstacle === "chain") {
    return (
      <>{common}
        {[-1, 1].map((direction) => (
          <motion.span
            key={`chain-half-${direction}`}
            className="pointer-events-none absolute z-40 h-2 w-[8%] rounded-full bg-zinc-200"
            style={{ left: `${((effect.col + 0.5) / COLS) * 100}%`, top: `${((effect.row + 0.5) / ROWS) * 100}%` }}
            initial={{ x: -12, y: -4, opacity: 1, rotate: direction * 18 }}
            animate={{ x: direction * (destroyed ? 44 : 18), y: destroyed ? 12 : 2, opacity: 0, rotate: direction * 75 }}
            transition={{ duration: reducedMotion ? 0.12 : 0.42, ease: "easeOut" }}
          />
        ))}
      </>
    );
  }

  if (obstacle === "crate") {
    return <>{common}<FxRing row={effect.row} col={effect.col} color="#FDBA74" size={1.55} duration={0.38} reducedMotion={reducedMotion} border={3} /></>;
  }

  if (obstacle === "stone") {
    return <>{common}<FxRing row={effect.row} col={effect.col} color="#D4D4D8" size={1.4} duration={0.35} reducedMotion={reducedMotion} border={5} /></>;
  }

  if (obstacle === "crystal") {
    return (
      <>{common}
        <motion.div
          className="pointer-events-none absolute z-40"
          style={cellBoxStyle(effect.row, effect.col, destroyed ? 3 : 1.5)}
          initial={{ opacity: 0, scale: 0.25, rotate: -12 }}
          animate={{ opacity: [0, 1, 0], scale: [0.25, 1.1, 1.32], rotate: 12 }}
          transition={{ duration: reducedMotion ? 0.14 : 0.52, ease: "easeOut" }}
        >
          <span className="absolute left-1/2 top-0 h-full w-[5px] -translate-x-1/2 rounded-full bg-gradient-to-b from-transparent via-[#C084FC] to-transparent" />
          <span className="absolute left-0 top-1/2 h-[5px] w-full -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent via-[#C084FC] to-transparent" />
        </motion.div>
      </>
    );
  }

  if (obstacle === "web") {
    return (
      <>{common}
        <motion.div
          className="pointer-events-none absolute z-40 rounded-full border border-white/90"
          style={cellBoxStyle(effect.row, effect.col, 1.25)}
          initial={{ scale: 1.25, opacity: 0.9, rotate: 0 }}
          animate={{ scale: destroyed ? 0.05 : 0.75, opacity: 0, rotate: destroyed ? 48 : 18 }}
          transition={{ duration: reducedMotion ? 0.12 : 0.4, ease: "easeIn" }}
        />
      </>
    );
  }

  if (obstacle === "shield") {
    return (
      <>{common}
        <FxRing row={effect.row} col={effect.col} color="#60A5FA" size={1.75} duration={0.45} reducedMotion={reducedMotion} border={4} />
        <FxRing row={effect.row} col={effect.col} color="#FFFFFF" size={1.25} delay={0.05} duration={0.3} reducedMotion={reducedMotion} border={2} />
      </>
    );
  }

  if (obstacle === "slime") {
    return (
      <>{common}
        {[0, 1, 2, 3].map((bubble) => (
          <motion.span
            key={`slime-bubble-${bubble}`}
            className="pointer-events-none absolute z-40 rounded-full border border-white/45 bg-[#39FF14]/60"
            style={{ left: `${((effect.col + 0.4 + (bubble % 2) * 0.22) / COLS) * 100}%`, top: `${((effect.row + 0.38 + Math.floor(bubble / 2) * 0.22) / ROWS) * 100}%`, width: 8 + bubble * 2, height: 8 + bubble * 2 }}
            initial={{ scale: 0.2, opacity: 0 }}
            animate={{ scale: [0.2, 1.25, 0], y: -18 - bubble * 4, opacity: [0, 1, 0] }}
            transition={{ duration: reducedMotion ? 0.12 : 0.48, delay: bubble * 0.04 }}
          />
        ))}
      </>
    );
  }

  if (obstacle === "metal") {
    return (
      <>{common}
        {[-1, 0, 1].map((spark) => (
          <motion.span
            key={`metal-spark-${spark}`}
            className="pointer-events-none absolute z-40 h-[3px] w-8 origin-left bg-[#FFB800]"
            style={{ left: `${((effect.col + 0.5) / COLS) * 100}%`, top: `${((effect.row + 0.5) / ROWS) * 100}%` }}
            initial={{ scaleX: 0, rotate: spark * 42, opacity: 0 }}
            animate={{ scaleX: 1, opacity: [0, 1, 0] }}
            transition={{ duration: reducedMotion ? 0.12 : 0.3, delay: (spark + 1) * 0.03 }}
          />
        ))}
      </>
    );
  }

  if (obstacle === "core") {
    return (
      <>{common}
        <motion.div
          className="pointer-events-none absolute z-30 rounded-full bg-[#FF4D55]/35"
          style={cellBoxStyle(effect.row, effect.col, destroyed ? 3.4 : 2)}
          initial={{ scale: 0.15, opacity: 1 }}
          animate={{ scale: [0.15, 1.2, 1.45], opacity: [1, 0.8, 0] }}
          transition={{ duration: reducedMotion ? 0.14 : destroyed ? 0.68 : 0.42, ease: "easeOut" }}
        />
        <FxRing row={effect.row} col={effect.col} color="#FF4D55" size={destroyed ? 3.6 : 2.1} duration={destroyed ? 0.7 : 0.45} reducedMotion={reducedMotion} border={5} />
      </>
    );
  }

  return common;
}

function FxSpread({ effect, reducedMotion }) {
  const web = effect.effect === "web_spread";
  const color = web ? "#E4E4E7" : "#39FF14";
  const fromX = ((effect.col + 0.5) / COLS) * 100;
  const fromY = ((effect.row + 0.5) / ROWS) * 100;
  const toX = ((effect.to_col + 0.5) / COLS) * 100;
  const toY = ((effect.to_row + 0.5) / ROWS) * 100;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <>
      <motion.div
        className={`pointer-events-none absolute z-30 origin-left rounded-full ${web ? "h-[3px]" : "h-[9px]"}`}
        style={{ left: `${fromX}%`, top: `${fromY}%`, width: `${Math.sqrt(dx * dx + dy * dy)}%`, background: color }}
        initial={{ scaleX: 0, opacity: 0.95, rotate: angle }}
        animate={{ scaleX: 1, opacity: web ? [0.95, 0.8, 0] : [0.8, 1, 0], rotate: angle }}
        transition={{ duration: reducedMotion ? 0.14 : web ? 0.48 : 0.56, ease: "easeOut" }}
      />
      <FxCellFlash row={effect.to_row} col={effect.to_col} color={color} delay={reducedMotion ? 0 : 0.22} reducedMotion={reducedMotion} />
      {!web && <FxParticles row={effect.to_row} col={effect.to_col} color={color} count={6} distance={26} delay={0.18} reducedMotion={reducedMotion} />}
    </>
  );
}

function SpecialEffects({ effects = [], reducedMotion = false }) {
  return (
    <AnimatePresence>
      {effects.flatMap((effect, effectIndex) => {
        const effectType = effect.special || effect.effect;
        const stage = effect.stage || "fire";
        const token = effect.token || `${effectIndex}-${effectType}-${stage}`;

        if (effect.obstacle) {
          return <FxObstacle key={`obstacle-${token}`} effect={effect} reducedMotion={reducedMotion} />;
        }

        if (["rocket_row", "rocket_col", "bomb", "color_bomb"].includes(effectType) && stage === "charge") {
          return <FxSpecialCharge key={`charge-${token}`} effect={effect} reducedMotion={reducedMotion} />;
        }

        if (effectType === "rocket_row" || effectType === "rocket_col") {
          return <FxRocket key={`rocket-${token}`} effect={effect} reducedMotion={reducedMotion} />;
        }

        if (effectType === "bomb") {
          return <FxBomb key={`bomb-${token}`} effect={effect} reducedMotion={reducedMotion} />;
        }

        if (effectType === "color_bomb" || effectType === "booster_color_bomb") {
          return <FxColorBomb key={`color-bomb-${token}`} effect={effect} reducedMotion={reducedMotion} />;
        }

        if (effectType === "booster_rocket") {
          return (
            <motion.div key={`booster-rocket-${token}`} className="pointer-events-none absolute inset-0 z-30">
              <FxRocket effect={{ ...effect, special: "rocket_row" }} reducedMotion={reducedMotion} />
              <FxRocket effect={{ ...effect, special: "rocket_col" }} reducedMotion={reducedMotion} />
            </motion.div>
          );
        }

        if (effectType === "booster_hammer") {
          return (
            <motion.div key={`booster-hammer-${token}`} className="pointer-events-none absolute inset-0 z-40">
              <motion.div
                className="pointer-events-none absolute flex items-center justify-center"
                style={cellBoxStyle(effect.row, effect.col, 1.25)}
                initial={{ y: -65, rotate: -28, scale: 1.25, opacity: 0 }}
                animate={{ y: [reducedMotion ? 0 : -65, 0, -6], rotate: [-28, 12, 0], scale: [1.25, 0.9, 1], opacity: [0, 1, 0] }}
                transition={{ duration: reducedMotion ? 0.14 : 0.42, ease: "easeIn" }}
              >
                <Hammer size={34} color="#B78CFF" strokeWidth={3.2} />
              </motion.div>
              <FxRing row={effect.row} col={effect.col} color="#B78CFF" size={1.8} delay={0.14} duration={0.34} reducedMotion={reducedMotion} border={4} />
            </motion.div>
          );
        }

        if (effectType === "crystal_burst") {
          return (
            <motion.div key={`crystal-${token}`} className="pointer-events-none absolute inset-0 z-30">
              <FxObstacle effect={{ ...effect, obstacle: "crystal", destroyed: true }} reducedMotion={reducedMotion} />
              {(effect.targets || []).map((target, index) => <FxCellFlash key={`crystal-target-${index}`} row={target.row} col={target.col} color="#C084FC" delay={index * 0.04} reducedMotion={reducedMotion} />)}
            </motion.div>
          );
        }

        if (effectType === "core_pulse" || effectType === "core_blast") {
          const blast = effectType === "core_blast";
          return (
            <motion.div key={`core-${token}`} className="pointer-events-none absolute inset-0 z-30">
              <FxObstacle effect={{ ...effect, obstacle: "core", destroyed: blast }} reducedMotion={reducedMotion} />
              {blast && (effect.targets || []).map((target, index) => <FxCellFlash key={`core-target-${index}`} row={target.row} col={target.col} color="#FF4D55" delay={index * 0.025} reducedMotion={reducedMotion} />)}
            </motion.div>
          );
        }

        if (effectType === "web_spread" || effectType === "slime_spread") {
          return <FxSpread key={`spread-${token}`} effect={effect} reducedMotion={reducedMotion} />;
        }

        return (effect.targets || []).slice(0, 20).map((target, targetIndex) => (
          <FxCellFlash
            key={`generic-${token}-${targetIndex}`}
            row={target.row}
            col={target.col}
            color="#F64CFF"
            delay={targetIndex * 0.012}
            reducedMotion={reducedMotion}
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
  const [obstacleImpacts, setObstacleImpacts] = useState(new Map());
  const [combo, setCombo] = useState(0);
  const [flash, setFlash] = useState("");
  const [animatedScore, setAnimatedScore] = useState(0);
  const [scorePulse, setScorePulse] = useState(false);
  const [scoreFlights, setScoreFlights] = useState([]);
  const [boardFx, setBoardFx] = useState("");
  const [bossPrompt, setBossPrompt] = useState(null);
  const [activeBooster, setActiveBooster] = useState(null);
  const [buyingBooster, setBuyingBooster] = useState(null);

  useEffect(() => {
    const preloaded = BONUS_MATCH_ARTWORK.map((src) => {
      const image = new Image();
      image.decoding = "async";
      image.src = src;
      return image;
    });
    return () => {
      preloaded.forEach((image) => {
        image.onload = null;
        image.onerror = null;
      });
    };
  }, []);

  const applySessionState = async (rawSession, animation = null) => {
    const session = { ...rawSession, board: normalizeBoard(rawSession?.board) };
    setGame(session);
    setAnimatedScore(session.score || 0);

    if (animation?.reshuffled) {
      const fromBoard = normalizeBoard(animation.from_board || rawSession?.board);
      const finalFrame = Array.isArray(animation.frames)
        ? [...animation.frames].reverse().find((frame) => frame.phase === "reshuffle") || animation.frames[animation.frames.length - 1]
        : null;
      const targetBoard = normalizeBoard(finalFrame?.board || rawSession?.board);
      setDisplayBoard(fromBoard);
      setFlash("ХОДІВ НЕМАЄ");
      await wait(reducedMotion ? 25 : 90);
      setFlash("ПЕРЕМІШУЄМО");
      setDisplayBoard(targetBoard);
      await wait(reducedMotion ? 70 : Number(finalFrame?.duration_ms || 520));
      setFlash("");
      toast.info("На полі не залишилося ходів. Фішки автоматично перемішано");
      return session;
    }

    setDisplayBoard(session.board);
    return session;
  };

  const loadStatus = async () => {
    if (mode === "mock") {
      const mockStatus = {
        profile: { current_level: 12, max_level: 50, total_stars: 26, lives: 5, max_lives: 5, next_life_at: null, daily_points: 17, daily_point_cap: 40, balance: 24500, booster_price: 50, boosters: { hammer: 2, rocket: 1, color_bomb: 1, shuffle: 2 } },
        levels: Array.from({ length: 50 }, (_, index) => levelConfig(index + 1)),
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
        await applySessionState(data.active_session, data.active_session_animation);
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
  const levelCatalog = useMemo(() => (status?.levels || []).slice().sort((a, b) => Number(a.level) - Number(b.level)), [status?.levels]);
  const levelCatalogMap = useMemo(() => new Map(levelCatalog.map((item) => [Number(item.level), item])), [levelCatalog]);
  const selectedConfig = levelCatalogMap.get(Number(selectedLevel)) || levelConfig(selectedLevel);
  const config = game?.config || selectedConfig;
  const boosterInventory = status?.profile?.boosters || {};
  const boosterPrice = Number(status?.profile?.booster_price || 50);
  const scoreProgress = Math.min(100, Math.round(((animatedScore || 0) / Math.max(1, config.target_score)) * 100));
  const coinProgress = Math.min(100, Math.round(((game?.coins_collected || 0) / Math.max(1, config.target_coins)) * 100));

  const startGame = async (level = selectedLevel, confirmed = false) => {
    const preview = levelCatalogMap.get(Number(level)) || levelConfig(level);
    if (preview.is_boss && !confirmed) {
      setBossPrompt(preview);
      return;
    }
    setBossPrompt(null);
    setSelected(null);
    setActiveBooster(null);
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
      await applySessionState(data.session, data.animation);
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
            obstacle_events: step.obstacle_events,
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
        ...(animation.reshuffled && data.session?.board
          ? [{ phase: "reshuffle", board: data.session.board, duration_ms: 520 }]
          : []),
      ];

    if (data.move_consumed === false && animation.from_board) {
      setDisplayBoard(normalizeBoard(animation.from_board));
      await wait(reducedMotion ? 20 : 70);
    }

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

        const removed = new Set((frame.cleared_ids || []).filter(Boolean));
        if (!removed.size) {
          (frame.cleared_cells || []).forEach(({ row, col }) => {
            const id = before?.[row]?.[col]?.id;
            if (id) removed.add(id);
          });
        }

        const activations = frame.activated_specials || [];
        const changes = frame.obstacle_changes || [];
        const obstacleEvents = frame.obstacle_events || [];
        const fxToken = `${Date.now()}-${index}`;
        const active = new Set();
        activations.forEach(({ row, col, id }) => {
          const pieceId = id || before?.[row]?.[col]?.id;
          if (pieceId) active.add(pieceId);
        });

        const impactMap = new Map();
        changes.forEach((change, changeIndex) => {
          const pieceId = before?.[change.row]?.[change.col]?.id;
          if (pieceId) {
            impactMap.set(pieceId, {
              ...change,
              token: `${fxToken}-impact-${changeIndex}`,
            });
          }
        });
        setObstacleImpacts(impactMap);
        setActivatedIds(active);
        setCombo(frame.combo || 1);
        setFlash(frame.combo > 1 ? `КОМБО ×${frame.combo}` : "");

        const hasColorBomb = activations.some((item) => ["color_bomb", "booster_color_bomb"].includes(item.special));
        const hasBomb = activations.some((item) => item.special === "bomb");
        const hasRocket = activations.some((item) => ["rocket_row", "rocket_col", "booster_rocket"].includes(item.special));
        const hasCoreBlast = changes.some((item) => item.effect === "core_blast");
        const hasHeavyObstacle = changes.some((item) => ["stone", "metal", "shield", "core"].includes(item.obstacle));
        const nextBoardFx = hasCoreBlast
          ? "core"
          : hasColorBomb
            ? "color_bomb"
            : hasBomb
              ? "bomb"
              : hasRocket
                ? "rocket"
                : hasHeavyObstacle
                  ? "heavy"
                  : changes.some((item) => item.obstacle === "slime")
                    ? "slime"
                    : "match";

        const chargeEffects = activations
          .filter((item) => ["rocket_row", "rocket_col", "bomb", "color_bomb"].includes(item.special))
          .map((item, effectIndex) => ({ ...item, stage: "charge", token: `${fxToken}-charge-${effectIndex}` }));
        if (chargeEffects.length) {
          setSpecialEffects(chargeEffects);
          setBoardFx(nextBoardFx);
          await wait(reducedMotion ? 35 : hasColorBomb ? 180 : 135);
        }

        setSpecialEffects([
          ...activations.map((item, effectIndex) => ({ ...item, stage: "fire", token: `${fxToken}-special-${effectIndex}` })),
          ...changes.map((item, effectIndex) => ({ ...item, stage: "fire", token: `${fxToken}-obstacle-${effectIndex}` })),
          ...obstacleEvents.map((item, effectIndex) => ({ ...item, stage: "fire", token: `${fxToken}-event-${effectIndex}` })),
        ]);
        setBoardFx(nextBoardFx);
        setRemovingIds(removed);

        for (const created of frame.created_specials || []) {
          toast.success(SPECIAL_TOASTS[created.special] || "Бонусна фішка створена!");
        }
        if (changes.some((item) => item.effect === "crystal_burst")) {
          toast.success("КРИСТАЛ ВИБУХНУВ!", { description: "Очищено сусідні клітинки" });
        }
        if (hasCoreBlast) {
          toast.success("ЯДРО ЗНИЩЕНО!", { description: "Вибух очищує область 3×3" });
          setFlash("ЯДРО ЗНИЩЕНО!");
        } else if (changes.some((item) => item.effect === "core_pulse")) {
          setFlash("ІМПУЛЬС ЯДРА");
        }
        const crateReward = changes.find((item) => item.effect === "crate_reward");
        if (crateReward) {
          toast.success(
            crateReward.replacement_symbol === "coin" ? "У ЯЩИКУ БУЛА МОНЕТА!" : "ЯЩИК ВІДКРИТО!",
          );
        }

        const burstColor = hasBomb || hasCoreBlast
          ? "#FF5C00"
          : hasColorBomb
            ? "#F64CFF"
            : hasRocket
              ? "#FFB800"
              : "#B78CFF";
        burstAtCells(frame.cleared_cells || [], burstColor);
        launchScoreFlight(frame.cleared_cells || [], frame.score_gain || 0);

        // Give charge, material impact and exit animations a visible first frame.
        // The server remains authoritative; only its frames are being replayed.
        await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
        await wait(reducedMotion ? 20 : activations.length || changes.length ? 90 : 45);

        const collapseFrame = frames[index + 1]?.phase === "collapse" ? frames[index + 1] : null;
        if (collapseFrame?.board) {
          setSpawnedIds(new Set(
            (collapseFrame.spawned_ids || collapseFrame.spawned?.map((item) => item.id) || []).filter(Boolean),
          ));
          setDisplayBoard(normalizeBoard(collapseFrame.board));
          const nextScore = runningScore + Number(frame.score_gain || 0);
          const minimumFxDuration = hasColorBomb || hasCoreBlast
            ? 680
            : hasBomb
              ? 580
              : hasRocket || changes.length
                ? 500
                : 430;
          await Promise.all([
            tickScore(runningScore, nextScore),
            wait(reducedMotion ? 75 : Math.max(Number(collapseFrame.duration_ms || 430), minimumFxDuration)),
          ]);
          runningScore = nextScore;
          index += 1;
        } else {
          await wait(reducedMotion ? 70 : Math.max(Number(frame.duration_ms || 290), 420));
        }

        setRemovingIds(new Set());
        setSpawnedIds(new Set());
        setActivatedIds(new Set());
        setObstacleImpacts(new Map());
        setSpecialEffects([]);
        setBoardFx("");
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

      if (frame.phase === "obstacle" && frame.board) {
        const events = frame.events || [];
        const token = `${Date.now()}-obstacle-turn`;
        setSpecialEffects(events.map((item, eventIndex) => ({ ...item, stage: "fire", token: `${token}-${eventIndex}` })));
        setDisplayBoard(normalizeBoard(frame.board));
        if (events.some((item) => item.effect === "slime_spread")) {
          setBoardFx("slime");
          setFlash("СЛИЗ ПОШИРИВСЯ");
          toast.info("Слиз зайняв сусідню клітинку");
        } else if (events.some((item) => item.effect === "web_spread")) {
          setBoardFx("web");
          setFlash("ПАВУТИНА РОЗРОСЛАСЯ");
          toast.info("Павутина обплутала сусідню фішку");
        }
        await wait(reducedMotion ? 80 : Math.max(Number(frame.duration_ms || 420), 560));
        setSpecialEffects([]);
        setBoardFx("");
        setFlash("");
        continue;
      }

      if (frame.phase === "reshuffle" && frame.board) {
        setFlash(animation.reason === "manual" ? "ПЕРЕМІШУЄМО" : "ХОДІВ НЕМАЄ");
        await wait(reducedMotion ? 20 : 80);
        setFlash("ПЕРЕМІШУЄМО");
        setDisplayBoard(normalizeBoard(frame.board));
        await wait(reducedMotion ? 60 : Number(frame.duration_ms || 520));
        setFlash("");
      }
    }

    if (animation.reshuffled) {
      toast.info(
        animation.reason === "manual"
          ? "Поле перемішано"
          : "На полі не залишилося ходів. Фішки автоматично перемішано",
      );
    }
    setAnimatedScore(data.session.score || runningScore);
    setDisplayBoard(normalizeBoard(data.session.board));
    setGame({ ...data.session, board: normalizeBoard(data.session.board) });
  };

  const patchBoosterProfile = (boosters, balance) => {
    setStatus((current) => current ? {
      ...current,
      profile: {
        ...current.profile,
        boosters: boosters || current.profile.boosters || {},
        balance: balance === undefined ? current.profile.balance : Number(balance),
      },
    } : current);
  };

  const purchaseBooster = async (booster) => {
    if (buyingBooster || moving) return;
    const meta = BOOSTERS[booster];
    if (!window.confirm(`Придбати «${meta.label}» за ${boosterPrice} Point?`)) return;
    if (mode === "mock") {
      const balance = Number(status?.profile?.balance || 0);
      if (balance < boosterPrice) return toast.error("Недостатньо Point для покупки");
      patchBoosterProfile({ ...boosterInventory, [booster]: Number(boosterInventory[booster] || 0) + 1 }, balance - boosterPrice);
      toast.success(`${meta.label} придбано`);
      return;
    }
    setBuyingBooster(booster);
    try {
      const { data } = await api.post("/games/bonus-match/boosters/purchase", { booster });
      patchBoosterProfile(data.boosters, data.balance);
      await refreshMe().catch(() => {});
      toast.success(`${meta.label} придбано`, { description: `−${data.price || boosterPrice} Point` });
    } catch (error) {
      toast.error(extractError(error, "Не вдалося придбати бонус"));
    } finally {
      setBuyingBooster(null);
    }
  };

  const applyBooster = async (booster, row = null, col = null) => {
    if (!game || moving || game.status !== "active") return;
    if (Number(boosterInventory[booster] || 0) <= 0) {
      toast.info("Спочатку придбай цей бонус");
      return;
    }
    setMoving(true);
    setSelected(null);
    setActiveBooster(null);
    const startingBoard = normalizeBoard(displayBoard.length ? displayBoard : game.board);
    try {
      if (mode === "mock") {
        let nextBoard = cloneBoard(startingBoard);
        if (booster === "shuffle") {
          nextBoard = makeMockBoard(game.level);
        } else if (row !== null && col !== null) {
          if (booster === "hammer") nextBoard[row][col] = null;
          if (booster === "rocket") {
            for (let index = 0; index < COLS; index += 1) nextBoard[row][index] = null;
            for (let index = 0; index < ROWS; index += 1) nextBoard[index][col] = null;
          }
          if (booster === "color_bomb") {
            const symbol = matchSymbol(nextBoard[row]?.[col]);
            if (!symbol) throw new Error("Джокер потрібно застосувати до звичайної фішки");
            for (let currentRow = 0; currentRow < ROWS; currentRow += 1) {
              for (let currentCol = 0; currentCol < COLS; currentCol += 1) {
                if (matchSymbol(nextBoard[currentRow][currentCol]) === symbol) nextBoard[currentRow][currentCol] = null;
              }
            }
          }
          nextBoard = collapseMockBoard(nextBoard).board;
        }
        const nextScore = Number(game.score || 0) + (booster === "shuffle" ? 0 : 500);
        setDisplayBoard(normalizeBoard(nextBoard));
        setGame((current) => ({ ...current, board: normalizeBoard(nextBoard), score: nextScore }));
        setAnimatedScore(nextScore);
        patchBoosterProfile({ ...boosterInventory, [booster]: Math.max(0, Number(boosterInventory[booster] || 0) - 1) });
        toast.success(`${BOOSTERS[booster].label} використано`);
        return;
      }
      const { data } = await api.post("/games/bonus-match/boosters/use", {
        session_id: game.id,
        booster,
        row,
        col,
      });
      await animateServerMove(data, game.score);
      patchBoosterProfile(data.profile?.boosters);
      toast.success(data.message || `${BOOSTERS[booster].label} використано`);
      if (data.result) {
        setResult(data.result);
        setBoardFx("won");
        if (!reducedMotion) fireConfetti();
        await refreshMe().catch(() => {});
        await loadStatus();
      }
    } catch (error) {
      setDisplayBoard(startingBoard);
      toast.error(extractError(error, "Не вдалося використати бонус"));
    } finally {
      setMoving(false);
    }
  };

  const selectBooster = (booster) => {
    if (!game || game.status !== "active" || moving) return;
    if (Number(boosterInventory[booster] || 0) <= 0) {
      toast.info(`Натисни «+», щоб придбати за ${boosterPrice} Point`);
      return;
    }
    if (booster === "shuffle") {
      applyBooster(booster);
      return;
    }
    const next = activeBooster === booster ? null : booster;
    setActiveBooster(next);
    setSelected(null);
    if (next) toast.info(BOOSTERS[booster].short);
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
    if (activeBooster) {
      if (!cell) return;
      applyBooster(activeBooster, row, col);
      return;
    }
    if (!cell || cell.obstacle) {
      if (cell?.obstacle) {
        toast.info(
          OBSTACLE_HELP[cell.obstacle]
          || `${OBSTACLE_NAMES[cell.obstacle] || "Перешкода"}: зруйнуй її збігами поруч`,
        );
      }
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

  const unlockedLevels = levelCatalog
    .map((item) => Number(item.level))
    .filter((level) => level <= Number(status?.profile?.current_level || 1));

  const selectedUnlockedIndex = unlockedLevels.indexOf(Number(selectedLevel));

  const chooseLevel = (delta) => {
    if (!unlockedLevels.length) return;
    const currentIndex = Math.max(0, unlockedLevels.indexOf(Number(selectedLevel)));
    const nextIndex = Math.max(0, Math.min(unlockedLevels.length - 1, currentIndex + delta));
    setSelectedLevel(unlockedLevels[nextIndex]);
  };

  const leaveBoard = () => {
    if (game?.status === "active") toast.info("Рівень збережено. Ти зможеш продовжити пізніше");
    setGame(null);
    setDisplayBoard([]);
    setResult(null);
    setBoardFx("");
    setActiveBooster(null);
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
          <span className="text-sm font-black tabular-nums">{formatNumber(status?.profile?.balance ?? user?.balance)}</span>
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
              <button type="button" onClick={() => chooseLevel(-1)} disabled={selectedUnlockedIndex <= 0} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-zinc-300 disabled:opacity-30 active:scale-95"><ChevronLeft /></button>
              <div className="min-w-[140px] text-center">
                <div className="font-display text-[52px] leading-none text-white">{selectedLevel}</div>
                <div className="mt-1 truncate text-[10px] font-black uppercase tracking-wider text-zinc-500">{selectedConfig.title || `Рівень ${selectedLevel}`}</div>
                <div className="mt-2 flex justify-center"><Stars count={chosenCompletion?.stars || 0} size={21} reducedMotion={reducedMotion} /></div>
              </div>
              <button type="button" onClick={() => chooseLevel(1)} disabled={selectedUnlockedIndex < 0 || selectedUnlockedIndex >= unlockedLevels.length - 1} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-zinc-300 disabled:opacity-30 active:scale-95"><ChevronRight /></button>
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
              animate={boardMotionForFx(boardFx, reducedMotion)}
              transition={{ duration: boardFx === "core" ? 0.62 : boardFx === "bomb" || boardFx === "color_bomb" ? 0.5 : 0.42, ease: "easeOut" }}
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
                          targetable={Boolean(activeBooster && activeBooster !== "shuffle")}
                          removing={removingIds.has(cell.id)}
                          shaking={shakingIds.has(cell.id)}
                          spawned={spawnedIds.has(cell.id)}
                          activated={activatedIds.has(cell.id)}
                          impact={obstacleImpacts.get(cell.id)}
                          removeDelay={(row + col) * 0.012}
                          reducedMotion={reducedMotion}
                          onClick={() => handlePiece(row, col)}
                        />
                      ) : null)),
                    )}
                  </AnimatePresence>
                </div>
              </LayoutGroup>

              <SpecialEffects effects={specialEffects} reducedMotion={reducedMotion} />

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

            <div className="mt-3 rounded-2xl border border-white/[.08] bg-black/25 p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[.16em] text-zinc-500">БОНУСИ</div>
                  <div className="mt-0.5 text-[8px] font-bold text-zinc-700">Кожен бонус коштує {boosterPrice} Point</div>
                </div>
                {activeBooster && <button type="button" onClick={() => setActiveBooster(null)} className="rounded-full border border-[#FF4D55]/30 bg-[#FF4D55]/10 px-2 py-1 text-[8px] font-black uppercase text-[#FF686F]">СКАСУВАТИ</button>}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {Object.entries(BOOSTERS).map(([id, item]) => {
                  const Icon = item.Icon;
                  const count = Number(boosterInventory[id] || 0);
                  const active = activeBooster === id;
                  return <div key={id} className={`relative rounded-xl border p-1.5 text-center transition-colors ${active ? "border-[#B78CFF] bg-[#B78CFF]/15" : "border-white/10 bg-[#11101A]"}`}>
                    <button type="button" disabled={moving || game.status !== "active"} onClick={() => selectBooster(id)} className="flex w-full flex-col items-center gap-1 py-1 disabled:opacity-40" aria-label={item.label}>
                      <motion.div animate={active && !reducedMotion ? { scale: [1, 1.12, 1] } : { scale: 1 }} transition={{ duration: 0.8, repeat: active ? Infinity : 0 }} className="flex h-9 w-9 items-center justify-center rounded-xl border" style={{ borderColor: `${item.color}66`, background: `${item.color}18` }}>
                        <Icon size={20} color={item.color} strokeWidth={2.8} />
                      </motion.div>
                      <span className="max-w-full truncate text-[7px] font-black uppercase text-zinc-400">{item.label}</span>
                    </button>
                    <div className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#7C3AED] px-1 text-[9px] font-black text-white">{count}</div>
                    <button type="button" disabled={buyingBooster === id || moving} onClick={(event) => { event.stopPropagation(); purchaseBooster(id); }} className="absolute -bottom-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[#FFB800]/50 bg-[#2C2100] text-[#FFB800] disabled:opacity-50" aria-label={`Придбати ${item.label}`}>
                      {buyingBooster === id ? <span className="text-[8px]">…</span> : <Plus size={12} strokeWidth={3} />}
                    </button>
                  </div>;
                })}
              </div>
              {activeBooster && <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 rounded-xl border border-[#B78CFF]/25 bg-[#B78CFF]/10 px-3 py-2 text-center text-[9px] font-black text-[#D8C1FF]">ОБЕРИ КЛІТИНКУ: {BOOSTERS[activeBooster].short}</motion.div>}
            </div>

            <div className="mt-3 flex items-center justify-between px-1 text-[10px] font-bold text-zinc-600"><span>{activeBooster ? "Торкнися цільової клітинки" : "Натисни фішку, потім сусідню"}</span><span>{coinProgress}% монет</span></div>
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
                  <button type="button" onClick={() => startGame(game.status === "won" ? (result?.current_level || game.level) : game.level)} className="flex h-12 items-center justify-center rounded-2xl bg-[#7C3AED] text-sm font-black text-white active:scale-95">{game.status === "won" ? "ДАЛІ" : "ЩЕ РАЗ"}<ChevronRight size={17} className="ml-1" /></button>
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
