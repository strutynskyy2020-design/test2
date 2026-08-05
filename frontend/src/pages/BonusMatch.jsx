import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
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
  Home,
  Lock,
  Maximize2,
  Minimize2,
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
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";
import { fireConfetti } from "@/lib/confetti";
import { useApp } from "@/context/AppContext";
import AvatarFrame from "@/components/AvatarFrame";
import BonusMatchErrorBoundary from "@/components/BonusMatchErrorBoundary";
import BonusMatchDebugOverlay from "@/components/BonusMatchDebugOverlay";
import { bonusMatchDiagnostics } from "@/lib/bonusMatchDiagnostics";
import authoredBonusMatchLevels from "@/data/bonusMatchLevels.json";
import {
  BONUS_MATCH_OBSTACLE_SPRITES,
  BONUS_MATCH_PIECE_SPRITES,
  BONUS_MATCH_CELL_IMAGE,
  BONUS_MATCH_HIT_BADGES,
  preloadBonusMatchArtwork,
} from "@/lib/bonusMatchAssets";

const ROWS = 7;
const COLS = 7;
const MAX_LEVEL = 200;
const SYMBOLS = ["coin", "star", "gift", "cube", "zap", "trophy"];
const BOSS_LEVELS = { 25: 2, 40: 2, 50: 3, 60: 2, 70: 2, 80: 2, 90: 2, 100: 3, 110: 3, 120: 3, 130: 3, 140: 3, 150: 4 };
const OBSTACLE_ORDER = ["ice", "chain", "crate", "stone", "crystal", "web", "shield", "slime", "metal", "core"];
const OVERLAY_OBSTACLES = new Set(["chain", "web"]);
const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
const nextPaint = () => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
const waitUntil = async (deadline) => {
  const remaining = deadline - performance.now();
  if (remaining > 1) await wait(remaining);
};
const coordKey = (row, col) => `${row}:${col}`;
const cloneBoard = (board) => (board || []).map((row) => row.map((cell) => (cell ? { ...cell } : null)));
const HINT_DELAY_MS = 5600;
const SQUASH_ANTICIPATION_MS = 100;
const OPTIMISTIC_SWAP_MS = 165;
const INVALID_SHAKE_MS = 120;
const INVALID_RETURN_MS = 135;
const MATCH_FIRE_LEAD_MS = 58;
const MATCH_COLLAPSE_LEAD_MS = 100;
const OBSTACLE_TURN_MS = 240;
const RESHUFFLE_MS = 330;
const CASCADE_STEP_MS = [320, 230, 165];
const BOARD_SHAPES = {
  full: ["1111111", "1111111", "1111111", "1111111", "1111111", "1111111", "1111111"],
  rounded: ["0111110", "1111111", "1111111", "1111111", "1111111", "1111111", "0111110"],
  diamond: ["0011100", "0111110", "1111111", "1111111", "1111111", "0111110", "0011100"],
  cross: ["0011100", "0011100", "1111111", "1111111", "1111111", "0011100", "0011100"],
  staircase: ["1111100", "1111110", "1111111", "1111111", "1111111", "0111111", "0011111"],
};
const boardShapeForLevel = (level = 1) => {
  const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Number(level || 1)));
  if (safeLevel <= 4) return "full";
  const cycle = ["rounded", "full", "diamond", "rounded", "staircase", "full", "cross", "rounded"];
  return cycle[Math.floor((safeLevel - 5) / 2) % cycle.length];
};
const boardMaskForShape = (shape = "full") => (BOARD_SHAPES[shape] || BOARD_SHAPES.full).map((row) => [...row].map((value) => value === "1"));
const cascadeDurationForStep = (step = 0) => {
  if (step < CASCADE_STEP_MS.length) return CASCADE_STEP_MS[step];
  return Math.max(105, Math.round(CASCADE_STEP_MS.at(-1) * (0.82 ** (step - CASCADE_STEP_MS.length + 1))));
};
const boardCellPositions = (board) => {
  const positions = new Map();
  (board || []).forEach((boardRow, row) => {
    (boardRow || []).forEach((cell, col) => {
      if (cell?.id && !cell.void) positions.set(cell.id, { row, col });
    });
  });
  return positions;
};
const buildFallMeta = (before, after, spawnedIds, boardWidth, token) => {
  const previous = boardCellPositions(before);
  const pitch = Math.max(38, Number(boardWidth || 350) / COLS);
  const spawned = new Set(spawnedIds || []);
  const spawnOrderByColumn = new Map();
  const result = new Map();

  (after || []).forEach((boardRow, row) => {
    (boardRow || []).forEach((cell, col) => {
      if (!cell?.id || cell.void) return;
      const old = previous.get(cell.id);
      let rows = old ? row - old.row : 0;
      const isSpawned = spawned.has(cell.id) || !old;
      let order = 0;
      if (isSpawned) {
        order = spawnOrderByColumn.get(col) || 0;
        spawnOrderByColumn.set(col, order + 1);
        let segmentStart = row;
        while (segmentStart > 0) {
          const above = after?.[segmentStart - 1]?.[col];
          if (!above || above.void || above.obstacle) break;
          segmentStart -= 1;
        }
        rows = (row - segmentStart) + order + 1.35;
      }
      if (rows <= 0 && !isSpawned) return;
      result.set(cell.id, {
        token: `${token}-${cell.id}`,
        distance: Math.max(pitch * 0.9, rows * pitch),
        delay: Math.min(0.075, col * 0.006 + (isSpawned ? order * 0.012 : 0)),
        spawned: isSpawned,
      });
    });
  });
  return result;
};

const flattenVisualPieces = (board) => (board || []).flatMap((boardRow, row) =>
  (boardRow || []).flatMap((cell, col) => (cell && !cell.void ? [{ cell, row, col }] : [])),
);

const PIECES = {
  coin: { Icon: Coins, label: "Монета", color: "#FFB800", sprite: BONUS_MATCH_PIECE_SPRITES.coin },
  star: { Icon: Star, label: "Зірка", color: "#35B8FF", sprite: BONUS_MATCH_PIECE_SPRITES.star },
  gift: { Icon: Gift, label: "Подарунок", color: "#F64CFF", sprite: BONUS_MATCH_PIECE_SPRITES.gift },
  cube: { Icon: Dice5, label: "Куб", color: "#39FF14", sprite: BONUS_MATCH_PIECE_SPRITES.cube },
  zap: { Icon: Zap, label: "Блискавка", color: "#FF5C00", sprite: BONUS_MATCH_PIECE_SPRITES.zap },
  trophy: { Icon: Trophy, label: "Трофей", color: "#B78CFF", sprite: BONUS_MATCH_PIECE_SPRITES.trophy },
};

const SPECIALS = {
  rocket_row: { Icon: Rocket, label: "Ракета по рядку", color: "#FFB800", rotate: 45 },
  rocket_col: { Icon: Rocket, label: "Ракета по колонці", color: "#00F0FF", rotate: -45 },
  bomb: { Icon: Bomb, label: "Бомба", color: "#FF5C00", rotate: 0 },
  color_bomb: { Icon: CircleDot, label: "Веселковий джокер", color: "#F64CFF", rotate: 0 },
};

const OBSTACLES = {
  ice: { Icon: Snowflake, label: "Крига", color: "#7DD3FC", sprite: BONUS_MATCH_OBSTACLE_SPRITES.ice },
  chain: { Icon: Lock, label: "Ланцюг", color: "#A1A1AA", sprite: BONUS_MATCH_OBSTACLE_SPRITES.chain },
  crate: { Icon: Box, label: "Ящик", color: "#FDBA74", sprite: BONUS_MATCH_OBSTACLE_SPRITES.crate },
  stone: { Icon: Shield, label: "Камінь", color: "#D4D4D8", sprite: BONUS_MATCH_OBSTACLE_SPRITES.stone },
  crystal: { Icon: Gem, label: "Кристал", color: "#C084FC", sprite: BONUS_MATCH_OBSTACLE_SPRITES.crystal },
  web: { Icon: Sparkles, label: "Павутина", color: "#E4E4E7", sprite: BONUS_MATCH_OBSTACLE_SPRITES.web },
  shield: { Icon: Shield, label: "Щит", color: "#60A5FA", sprite: BONUS_MATCH_OBSTACLE_SPRITES.shield },
  slime: { Icon: CircleDot, label: "Слиз", color: "#4ADE80", sprite: BONUS_MATCH_OBSTACLE_SPRITES.slime },
  metal: { Icon: Shield, label: "Метал", color: "#CBD5E1", sprite: BONUS_MATCH_OBSTACLE_SPRITES.metal },
  core: { Icon: Zap, label: "Ядро", color: "#FF4D55", sprite: BONUS_MATCH_OBSTACLE_SPRITES.core },
};

const SPECIAL_TOASTS = {
  rocket_row: "Ракета створена!",
  rocket_col: "Ракета створена!",
  bomb: "Бомба готова!",
  color_bomb: "Джокер зібрано!",
};

const BOOSTERS = {
  hammer: { Icon: Hammer, label: "Молоток", short: "Прибрати одну фішку або перешкоду", color: "#B78CFF", price: 10 },
  rocket: { Icon: Rocket, label: "Ракета", short: "Очистити рядок і колонку", color: "#FF5C00", price: 20 },
  color_bomb: { Icon: CircleDot, label: "Веселковий джокер", short: "Прибрати всі фішки одного типу", color: "#F64CFF", price: 50 },
  shuffle: { Icon: RotateCcw, label: "Перемішати", short: "Повністю перемішати поле", color: "#00F0FF", price: 30 },
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
  web: "Павутина: звільни фішку збігом. Якщо за хід знищено хоча б одну павутину, нова не з’явиться",
  shield: "Щит: спецфішки пробивають одразу два шари",
  slime: "Слиз: поширюється після ходу, якщо його не пошкодити",
  metal: "Метал: пошкоджується тільки спецфішками або бустерами",
  core: "Ядро: бий спецфішками або комбінаціями 4+, після руйнування вибухне 3×3",
};

const makeCell = (symbol = null, extras = {}) => ({
  id: extras.id || `mock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  symbol: extras.void ? null : symbol,
  special: extras.special || null,
  obstacle: extras.obstacle || null,
  obstacle_hits: extras.obstacle_hits || 0,
  obstacle_age: extras.obstacle_age || 0,
  void: Boolean(extras.void),
});

const normalizeCell = (cell) => {
  if (!cell) return null;
  if (typeof cell === "string") return makeCell(cell);
  if (cell.void) return makeCell(null, { id: cell.id || `void-${Math.random().toString(36).slice(2, 10)}`, void: true });
  return {
    id: cell.id || `cell-${Math.random().toString(36).slice(2, 10)}`,
    symbol: cell.symbol || null,
    special: cell.special || null,
    obstacle: cell.obstacle || null,
    obstacle_hits: Number(cell.obstacle_hits || 0),
    obstacle_age: Number(cell.obstacle_age || 0),
    void: Boolean(cell.void),
  };
};

const normalizeBoard = (board) => (board || []).map((row) => row.map(normalizeCell));

const levelConfig = (level) => {
  const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Number(level || 1)));
  const authored = authoredBonusMatchLevels.find((item) => Number(item.level) === safeLevel) || null;
  if (authored) {
    const boardShape = BOARD_SHAPES[authored.board_shape] ? authored.board_shape : "full";
    const obstacleLayout = Array.isArray(authored.obstacle_layout) ? authored.obstacle_layout : [];
    return {
      ...authored,
      level: safeLevel,
      board_shape: boardShape,
      board_mask: boardMaskForShape(boardShape),
      obstacle_layout: obstacleLayout,
      obstacle_count: obstacleLayout.length,
      obstacles: [...new Set(obstacleLayout.map((item) => item.obstacle).filter(Boolean))],
    };
  }

  const milestone = safeLevel % 5 === 0;
  const stage = Math.floor(safeLevel / 5);
  const baseTarget = 900 + safeLevel * 260;
  const targetScore = Math.floor(baseTarget * (1 + Math.floor((safeLevel - 1) / 5) * 0.1));
  const rewardMultiplier = BOSS_LEVELS[safeLevel] || 1;
  const moves = Math.max(18, 30 - Math.floor((safeLevel - 1) / 10));
  const obstacles = OBSTACLE_ORDER.slice(0, Math.min(OBSTACLE_ORDER.length, stage));
  const boardShape = boardShapeForLevel(safeLevel);
  return {
    level: safeLevel, board_shape: boardShape, board_mask: boardMaskForShape(boardShape),
    moves, target_score: targetScore, target_coins: 8 + Math.floor((safeLevel + 1) / 3),
    star_thresholds: [targetScore, Math.floor(targetScore * 1.35), Math.floor(targetScore * 1.72)],
    is_milestone: milestone, is_boss: rewardMultiplier > 1, reward_multiplier: rewardMultiplier,
    new_obstacle: milestone ? obstacles.at(-1) : null, obstacles, obstacle_layout: [], obstacle_count: Math.min(10, 2 + stage),
  };
};


const matchSymbol = (cell) => {
  if (!cell || cell.void || cell.special === "color_bomb") return null;
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

const findHintMove = (board) => {
  const copy = cloneBoard(board);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const nextRow = row + dr;
        const nextCol = col + dc;
        if (nextRow >= ROWS || nextCol >= COLS) continue;
        const a = copy[row]?.[col];
        const b = copy[nextRow]?.[nextCol];
        if (!a || !b || a.void || b.void || a.obstacle || b.obstacle) continue;
        if (a.special || b.special) {
          return { from: { row, col }, to: { row: nextRow, col: nextCol } };
        }
        [copy[row][col], copy[nextRow][nextCol]] = [b, a];
        const valid = findMatches(copy).size > 0;
        [copy[row][col], copy[nextRow][nextCol]] = [a, b];
        if (valid) return { from: { row, col }, to: { row: nextRow, col: nextCol } };
      }
    }
  }
  return null;
};

const hasPossibleMove = (board) => Boolean(findHintMove(board));

const makeMockBoard = (level = 1, suppliedConfig = null) => {
  const config = suppliedConfig || levelConfig(level);
  const mask = config.board_mask || boardMaskForShape(config.board_shape);
  for (let attempt = 0; attempt < 140; attempt += 1) {
    const board = [];
    for (let row = 0; row < ROWS; row += 1) {
      board.push([]);
      for (let col = 0; col < COLS; col += 1) {
        if (!mask[row]?.[col]) {
          board[row].push(makeCell(null, { id: `void-${row}-${col}`, void: true }));
          continue;
        }
        const blocked = new Set();
        if (col >= 2 && matchSymbol(board[row][col - 1]) === matchSymbol(board[row][col - 2])) blocked.add(matchSymbol(board[row][col - 1]));
        if (row >= 2 && matchSymbol(board[row - 1][col]) === matchSymbol(board[row - 2][col])) blocked.add(matchSymbol(board[row - 1][col]));
        const options = SYMBOLS.filter((symbol) => !blocked.has(symbol));
        board[row].push(makeCell(options[Math.floor(Math.random() * options.length)]));
      }
    }
    const manualLayout = Array.isArray(config.obstacle_layout) ? config.obstacle_layout : [];
    if (manualLayout.length) {
      manualLayout.forEach((item) => {
        const row = Number(item.row);
        const col = Number(item.col);
        const obstacle = item.obstacle;
        if (!board[row]?.[col] || board[row][col].void || !OBSTACLE_ORDER.includes(obstacle)) return;
        const hits = Number(item.hits || (obstacle === "core" ? 4 : ["stone", "shield", "metal"].includes(obstacle) ? 3 : obstacle === "web" ? 1 : 2));
        if (OVERLAY_OBSTACLES.has(obstacle)) {
          board[row][col] = { ...board[row][col], obstacle, obstacle_hits: hits, obstacle_age: 0, special: null };
        } else {
          board[row][col] = makeCell(null, { obstacle, obstacle_hits: hits });
        }
      });
    } else if (config.obstacles.length) {
      const count = Math.min(10, Number(config.obstacle_count || 2 + Math.floor(level / 5)));
      const activePositions = [];
      for (let row = 0; row < ROWS; row += 1) for (let col = 0; col < COLS; col += 1) if (!board[row][col]?.void) activePositions.push({ row, col });
      for (let index = 0; index < Math.min(count, activePositions.length); index += 1) {
        const positionIndex = Math.floor(Math.random() * activePositions.length);
        const { row, col } = activePositions.splice(positionIndex, 1)[0];
        const obstacle = config.obstacles[index % config.obstacles.length];
        const hits = obstacle === "core" ? 4 : ["stone", "shield", "metal"].includes(obstacle) ? 3 : obstacle === "web" ? 1 : 2;
        if (OVERLAY_OBSTACLES.has(obstacle)) board[row][col] = { ...board[row][col], obstacle, obstacle_hits: hits, obstacle_age: 0, special: null };
        else board[row][col] = makeCell(null, { obstacle, obstacle_hits: hits });
      }
    }
    if (!findMatches(board).size && hasPossibleMove(board)) return board;
  }
  return Array.from({ length: ROWS }, (_, row) => Array.from({ length: COLS }, (_, col) => (
    mask[row]?.[col]
      ? makeCell(SYMBOLS[(row * 2 + col * 3) % SYMBOLS.length])
      : makeCell(null, { id: `void-${row}-${col}`, void: true })
  )));
};


const collapseMockBoard = (board) => {
  const result = cloneBoard(board);
  const spawned = [];
  for (let col = 0; col < COLS; col += 1) {
    const fixedRows = [];
    for (let row = 0; row < ROWS; row += 1) if (result[row][col]?.obstacle || result[row][col]?.void) fixedRows.push(row);
    const boundaries = [-1, ...fixedRows, ROWS];
    for (let segment = 0; segment < boundaries.length - 1; segment += 1) {
      const start = boundaries[segment] + 1;
      const end = boundaries[segment + 1] - 1;
      if (start > end) continue;
      const values = [];
      for (let row = start; row <= end; row += 1) if (result[row][col] && !result[row][col].void) values.push(result[row][col]);
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
  if (!first || !second || first.void || second.void || first.obstacle || second.obstacle) {
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
    clearedCells.forEach(([row, col]) => { if (!board[row][col]?.void) board[row][col] = null; });
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
    const fresh = makeMockBoard(game.level, game.config);
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
      points_awarded: won ? 2 : 0,
      xp_awarded: won ? 10 : 0,
      first_win_bonus: 0,
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

const fxTempo = (tempo = 1) => Math.max(0.45, Math.min(1.2, Number(tempo || 1)));
const fxDuration = (base, tempo = 1, minimum = 0.08) => Math.max(minimum, base * fxTempo(tempo));
const fxDelay = (base, tempo = 1) => base * fxTempo(tempo);

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
  hinted = false,
  hintDirection = null,
  fall = null,
  cascadeDurationMs = 350,
  positionDurationMs = OPTIMISTIC_SWAP_MS,
  celebrating = false,
  removeDelay = 0,
  onClick,
  onSwipe,
  swipeEnabled = false,
  row,
  col,
  reducedMotion,
  artworkFailed = false,
}) {
  const gestureRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  if (!cell || cell.void) return null;
  const obstacle = cell.obstacle ? OBSTACLES[cell.obstacle] || OBSTACLES.stone : null;
  const special = cell.special ? SPECIALS[cell.special] || SPECIALS.bomb : null;
  const piece = PIECES[cell.symbol] || PIECES.star;
  const overlayObstacle = Boolean(cell.obstacle && OVERLAY_OBSTACLES.has(cell.obstacle));
  const SpecialIcon = special?.Icon || null;
  const PieceIcon = piece?.Icon || Star;
  const ObstacleIcon = obstacle?.Icon || Shield;
  const color = obstacle?.color || special?.color || piece.color;
  const background = "transparent";
  const label = overlayObstacle
    ? `${obstacle?.label || "Перешкода"} на фішці ${piece.label}`
    : obstacle?.label || special?.label || piece.label;
  const shakeAnimation = shaking && !reducedMotion ? [0, -7, 7, -6, 6, -3, 3, 0] : dragOffset.x;
  const pieceTempo = Math.max(0.55, Math.min(1, cascadeDurationMs / CASCADE_STEP_MS[0]));
  const impactMotion = obstacleImageMotion(cell.obstacle, impact, reducedMotion);
  const impactTransition = impact
    ? { duration: reducedMotion ? 0.06 : (impact.destroyed ? 0.5 : 0.38) * pieceTempo, ease: [0.22, 1, 0.36, 1] }
    : cell.obstacle === "core" || cell.obstacle === "slime"
      ? { duration: cell.obstacle === "core" ? 1.75 : 1.45, repeat: Infinity, ease: "easeInOut" }
      : { duration: 0.2 };
  const specialMotion = specialIconMotion(cell.special, activated, reducedMotion);
  const specialTransition = activated
    ? { duration: reducedMotion ? 0.05 : (cell.special === "color_bomb" ? 0.34 : 0.28) * pieceTempo, ease: [0.22, 1, 0.36, 1] }
    : { duration: cell.special === "color_bomb" ? 2.8 : 1.2, repeat: Infinity, ease: "easeInOut" };
  const fallDuration = reducedMotion ? 0.05 : Math.max(0.12, Math.min(0.34, cascadeDurationMs / 1000 * 0.68));
  const removalDuration = reducedMotion ? 0.05 : Math.max(0.11, Math.min(0.27, cascadeDurationMs / 1000 * 0.72));
  const anticipationDuration = reducedMotion ? 0.05 : SQUASH_ANTICIPATION_MS / 1000;
  const celebrationDelay = reducedMotion ? 0 : (row + col) * 0.035;
  const isSpawned = Boolean(spawned || fall?.spawned);
  const fallY = fall && !reducedMotion
    ? [-fall.distance, -Math.max(8, fall.distance * 0.24), isSpawned ? 10 : 8, -4, 0]
    : dragOffset.y;
  const selectedScale = selected ? 1.08 : activated ? 1.08 : 1;
  const scaleMotion = removing && !obstacle && !reducedMotion
    ? [1, 0.86, 1.15]
    : celebrating && !reducedMotion
      ? [1, 1.12, 0.96, 1]
      : selectedScale;
  const yMotion = celebrating && !reducedMotion
    ? [0, -12, 3, 0]
    : fallY;
  const pieceArtworkMotion = activated && !reducedMotion
    ? { scale: [1, 0.9, 1.12], rotate: [0, -3, 3, 0] }
    : hinted && !reducedMotion
      ? {
        x: [0, Number(hintDirection?.dc || 0) * 5, 0],
        y: [0, Number(hintDirection?.dr || 0) * 5, 0],
        scale: [1, 1.075, 1],
      }
      : { scale: 1, rotate: 0 };

  const resetGesture = () => {
    gestureRef.current = null;
    setDragOffset({ x: 0, y: 0 });
  };

  const handlePointerDown = (event) => {
    if (!swipeEnabled || event.button !== 0) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const magnitude = Math.max(Math.abs(dx), Math.abs(dy));
    if (magnitude > 5) {
      event.preventDefault();
      setDragOffset({
        x: Math.max(-18, Math.min(18, dx * 0.34)),
        y: Math.max(-18, Math.min(18, dy * 0.34)),
      });
    }
  };

  const handlePointerUp = (event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      resetGesture();
      return;
    }
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    resetGesture();
    if (distance < 22) return;

    const direction = Math.abs(dx) >= Math.abs(dy)
      ? { dr: 0, dc: dx > 0 ? 1 : -1 }
      : { dr: dy > 0 ? 1 : -1, dc: 0 };
    const to = { row: row + direction.dr, col: col + direction.dc };
    suppressClickRef.current = true;
    if (to.row >= 0 && to.row < ROWS && to.col >= 0 && to.col < COLS) {
      onSwipe?.({ row, col }, to);
    }
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const exitMotion = reducedMotion
    ? { opacity: 0, transition: { duration: 0.05 } }
    : cell.obstacle === "slime"
      ? {
        opacity: [1, 1, 0],
        scaleX: [1, 1.45, 1.65],
        scaleY: [1, 0.22, 0.05],
        y: [0, 5, 12],
        transition: { duration: removalDuration, delay: removeDelay, times: [0, 0.35, 1], ease: "easeIn" },
      }
      : cell.obstacle === "stone" || cell.obstacle === "metal"
        ? {
          opacity: [1, 1, 0],
          scale: [1, 1.08, 0.54],
          y: [0, -2, 14],
          rotate: [0, -2, 9],
          transition: { duration: removalDuration * 1.18, delay: removeDelay, times: [0, 0.28, 1], ease: "easeIn" },
        }
        : {
          opacity: [1, 1, 0],
          scale: [1.15, 1.26, 0],
          rotate: [0, -3, cell.special === "color_bomb" ? 120 : 24],
          transition: {
            duration: removalDuration,
            delay: removeDelay,
            times: [0, 0.28, 1],
            ease: ["easeOut", "easeIn"],
          },
        };

  return (
    <div
      className="absolute left-1.5 top-1.5 p-0.5"
      style={{
        width: "calc((100% - 36px) / 7)",
        height: "calc((100% - 36px) / 7)",
        transform: `translate3d(calc(${col * 100}% + ${col * 4}px), calc(${row * 100}% + ${row * 4}px), 0)`,
        transition: fall || reducedMotion
          ? "none"
          : `transform ${positionDurationMs}ms cubic-bezier(.2,.82,.25,1)`,
        zIndex: selected ? 24 : removing ? 18 : activated ? 16 : 10,
        willChange: (fall || removing || shaking || celebrating || dragOffset.x || dragOffset.y) ? "transform" : "auto",
        backfaceVisibility: "hidden",
      }}
    >
      <motion.button
      type="button"
      onClick={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault();
          return;
        }
        onClick?.(row, col);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={resetGesture}
      disabled={disabled}
      aria-label={`${label}, рядок ${row + 1}, колонка ${col + 1}`}
      data-bonus-piece={cell.id}
      data-piece-symbol={cell.symbol || ""}
      className="relative flex h-full w-full min-w-0 items-center justify-center overflow-visible rounded-[10px] border border-transparent"
      style={{
        background,
        touchAction: swipeEnabled ? "none" : "manipulation",
      }}
      initial={fall?.spawned && !reducedMotion
        ? { y: -fall.distance, opacity: 0.65, scale: 0.88 }
        : false}
      animate={{
        x: shakeAnimation,
        y: yMotion,
        opacity: 1,
        scale: scaleMotion,
        rotate: removing && !obstacle && !reducedMotion ? [0, -1.5, 1.5] : 0,
      }}
      exit={exitMotion}
      whileTap={disabled ? undefined : { scale: obstacle && !targetable ? 0.96 : 0.88 }}
      transition={
        shaking
          ? { duration: reducedMotion ? 0.01 : 0.32, ease: "easeInOut" }
          : {
            x: dragOffset.x || dragOffset.y ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 27 },
            y: celebrating && !reducedMotion
              ? { duration: 0.48, delay: celebrationDelay, times: [0, 0.42, 0.72, 1], ease: ["easeOut", "easeIn", "easeOut"] }
              : fall && !reducedMotion
                ? {
                  duration: fallDuration,
                  delay: fall.delay,
                  times: [0, 0.56, 0.8, 0.9, 1],
                  ease: ["easeIn", "easeOut", "easeInOut", "easeOut"],
                }
                : { type: "spring", stiffness: 520, damping: 25, bounce: 0.22 },
            scale: removing && !obstacle && !reducedMotion
              ? { duration: anticipationDuration, times: [0, 0.55, 1], ease: ["easeOut", [0.16, 1, 0.3, 1]] }
              : celebrating && !reducedMotion
                ? { duration: 0.48, delay: celebrationDelay, times: [0, 0.42, 0.72, 1] }
                : { type: "spring", stiffness: 450, damping: 23 },
            opacity: { duration: reducedMotion ? 0.05 : 0.18 },
            rotate: { duration: anticipationDuration },
          }
      }
    >
      <div className="absolute inset-0 overflow-hidden rounded-[10px] bg-transparent" />
      {(!obstacle || overlayObstacle) && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[2%] left-[8%] z-[1] h-[24%] w-[84%] select-none rounded-[50%] opacity-70"
          style={{
            background: "radial-gradient(ellipse at center, rgba(0,0,0,.72) 0%, rgba(0,0,0,.38) 48%, rgba(0,0,0,0) 76%)",
            transform: "translateZ(0)",
          }}
        />
      )}
      {(!obstacle || overlayObstacle) && piece.sprite && !artworkFailed && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-[3%] z-[2] select-none"
          style={{ ...piece.sprite, backfaceVisibility: "hidden" }}
          animate={pieceArtworkMotion}
          transition={
            activated
              ? { duration: 0.28 * pieceTempo }
              : hinted
                ? { duration: 0.78, repeat: Infinity, ease: "easeInOut" }
                : { duration: 0.2 }
          }
        />
      )}
      {(!obstacle || overlayObstacle) && artworkFailed && (
        <PieceIcon
          aria-hidden="true"
          className="pointer-events-none absolute inset-[18%] z-[2] h-[64%] w-[64%]"
          color={piece.color}
          strokeWidth={2.4}
        />
      )}
      {obstacle?.sprite && !artworkFailed && (
        <motion.div
          key={`${cell.id}-${impact?.token || "steady"}`}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[3] select-none"
          style={{
            ...obstacle.sprite,
            ...(cell.obstacle === "chain" || cell.obstacle === "web"
              ? { mixBlendMode: "screen", opacity: cell.obstacle === "chain" ? 0.9 : 0.84 }
              : {}),
          }}
          animate={impactMotion}
          transition={impactTransition}
        />
      )}
      {obstacle && artworkFailed && (
        <ObstacleIcon
          aria-hidden="true"
          className={`pointer-events-none absolute z-[3] ${overlayObstacle ? "inset-[20%]" : "inset-[14%]"} h-auto w-auto`}
          color={obstacle.color}
          strokeWidth={2.3}
        />
      )}
      <div
        className="bonus-piece-surface-gloss pointer-events-none absolute inset-[3%] z-[4] rounded-[12%]"
        style={{
          background: obstacle && !overlayObstacle
            ? "linear-gradient(145deg,rgba(255,255,255,.10),transparent 42%,rgba(0,0,0,.18))"
            : "radial-gradient(ellipse at 29% 16%,rgba(255,255,255,.76),rgba(255,255,255,.20) 18%,transparent 38%), radial-gradient(ellipse at 76% 88%,rgba(0,0,0,.24),transparent 42%), linear-gradient(145deg,rgba(255,255,255,.10),transparent 45%,rgba(0,0,0,.16))",
          boxShadow: obstacle && !overlayObstacle
            ? "inset 1px 1px 0 rgba(255,255,255,.16), inset -1.5px -1.5px 0 rgba(0,0,0,.28)"
            : "inset 2px 2px 0 rgba(255,255,255,.48), inset -2.4px -2.4px 0 rgba(0,0,0,.44), inset 0 0 0 1px rgba(255,255,255,.14)",
        }}
      />
      {impact && (
        <motion.div
          key={`impact-glint-${impact.token}`}
          className="pointer-events-none absolute inset-0 z-[5] rounded-[10px] bg-[radial-gradient(circle_at_center,rgba(255,255,255,.9),rgba(255,255,255,.18)_38%,transparent_72%)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, impact.destroyed ? 0.38 : 0.22, 0] }}
          transition={{ duration: reducedMotion ? 0.06 : 0.28 * pieceTempo }}
        />
      )}
      {special && (
        <motion.div
          className="pointer-events-none absolute inset-[1px] z-[5] rounded-[9px] border-2"
          style={{ borderColor: special.color }}
          animate={activated && !reducedMotion
            ? { opacity: [0.35, 1, 0.7], scale: [1, 1.08, 1] }
            : reducedMotion ? { opacity: 0.55 } : { opacity: [0.35, 0.85, 0.35] }}
          transition={activated ? { duration: 0.28 * pieceTempo } : { duration: 1.25, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {special && cell.special !== "color_bomb" && SpecialIcon && (
        <motion.div
          className="pointer-events-none absolute inset-0 z-[6] flex items-center justify-center"
          animate={specialMotion}
          transition={specialTransition}
        >
          <span className="flex h-[62%] w-[62%] items-center justify-center rounded-full border border-white/45 bg-black/70 shadow-[0_0_10px_rgba(183,140,255,.45)]">
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
        {hinted && !selected && (
          <motion.div
            className="pointer-events-none absolute inset-[1px] z-[7] rounded-[10px] border-2 border-[#FFB800]"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: [0.28, 1, 0.28], scale: [0.94, 1.05, 0.94] }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.78, repeat: Infinity, ease: "easeInOut" }}
            style={{ boxShadow: "0 0 14px rgba(255,184,0,.72), inset 0 0 10px rgba(255,184,0,.24)" }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {selected && (
          <motion.div
            className="pointer-events-none absolute inset-[-2px] z-[8] rounded-[12px] border-2 border-white"
            initial={{ opacity: 0, scale: 0.86 }}
            animate={{
              opacity: reducedMotion ? 1 : [0.35, 1, 0.72],
              scale: reducedMotion ? 1 : [0.96, 1.055, 1],
            }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: reducedMotion ? 0.05 : 0.42, ease: "easeOut" }}
            style={{ boxShadow: `0 0 18px ${color}, 0 0 30px ${color}88, inset 0 0 12px rgba(255,255,255,.3)` }}
          >
            <motion.div
              className="absolute inset-[3px] rounded-[8px] border border-white/70"
              animate={reducedMotion ? { opacity: 0.8 } : { opacity: [0.25, 0.9, 0.62], scale: [1.04, 0.94, 1] }}
              transition={{ duration: 0.42, ease: "easeOut" }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {obstacle && (
        <motion.div
          className="pointer-events-none absolute bottom-[-3px] right-[-3px] z-[9] flex h-[22px] w-[22px] items-center justify-center"
          animate={impact && !reducedMotion ? { scale: [1, 1.35, 0.92, 1] } : { scale: 1 }}
          transition={{ duration: 0.34 * pieceTempo }}
        >
          {BONUS_MATCH_HIT_BADGES[cell.obstacle_hits] ? (
            <img
              src={BONUS_MATCH_HIT_BADGES[cell.obstacle_hits]}
              alt=""
              className="h-full w-full object-contain"
              draggable="false"
            />
          ) : (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#171222] px-1 text-[8px] font-black text-white">{cell.obstacle_hits}</span>
          )}
        </motion.div>
      )}
      </motion.button>
    </div>
  );
}

const sameCellVisual = (first, second) => (
  first === second
  || (
    first?.id === second?.id
    && first?.symbol === second?.symbol
    && first?.special === second?.special
    && first?.obstacle === second?.obstacle
    && Number(first?.obstacle_hits || 0) === Number(second?.obstacle_hits || 0)
    && Number(first?.obstacle_age || 0) === Number(second?.obstacle_age || 0)
    && Boolean(first?.void) === Boolean(second?.void)
  )
);

const sameMotionToken = (first, second) => (
  first === second
  || (
    first?.token === second?.token
    && first?.distance === second?.distance
    && first?.delay === second?.delay
    && first?.spawned === second?.spawned
  )
);

const sameDirection = (first, second) => (
  first === second
  || (Number(first?.dr || 0) === Number(second?.dr || 0) && Number(first?.dc || 0) === Number(second?.dc || 0))
);

const arePiecePropsEqual = (previous, next) => {
  const motionSensitive = Boolean(
    previous.removing || next.removing
    || previous.shaking || next.shaking
    || previous.spawned || next.spawned
    || previous.activated || next.activated
    || previous.celebrating || next.celebrating
    || previous.fall || next.fall
    || previous.impact || next.impact
  );
  return (
    sameCellVisual(previous.cell, next.cell)
    && previous.row === next.row
    && previous.col === next.col
    && previous.selected === next.selected
    && previous.disabled === next.disabled
    && previous.targetable === next.targetable
    && previous.removing === next.removing
    && previous.shaking === next.shaking
    && previous.spawned === next.spawned
    && previous.activated === next.activated
    && previous.hinted === next.hinted
    && previous.celebrating === next.celebrating
    && previous.swipeEnabled === next.swipeEnabled
    && previous.reducedMotion === next.reducedMotion
    && previous.artworkFailed === next.artworkFailed
    && (!motionSensitive || (
      previous.cascadeDurationMs === next.cascadeDurationMs
      && previous.removeDelay === next.removeDelay
    ))
    && sameMotionToken(previous.fall, next.fall)
    && sameMotionToken(previous.impact, next.impact)
    && sameDirection(previous.hintDirection, next.hintDirection)
  );
};

const MemoPiece = memo(Piece, arePiecePropsEqual);

const BoardPiecesLayer = memo(function BoardPiecesLayer({
  pieces,
  selectedKey,
  moving,
  gameStatus,
  activeBooster,
  removingIds,
  shakingIds,
  spawnedIds,
  fallMeta,
  cascadeDurationMs,
  celebrating,
  hintDirections,
  activatedIds,
  obstacleImpacts,
  reducedMotion,
  artworkFailed,
  onPieceClick,
  onPieceSwipe,
}) {
  const positionDurationMs = Math.max(110, Math.min(190, cascadeDurationMs || OPTIMISTIC_SWAP_MS));
  return (
    <AnimatePresence initial={false}>
      {pieces.map(({ cell, row, col }) => {
          const key = coordKey(row, col);
          return (
            <MemoPiece
              key={cell.id}
              cell={cell}
              row={row}
              col={col}
              selected={selectedKey === key}
              disabled={moving || gameStatus !== "active"}
              targetable={Boolean(activeBooster && activeBooster !== "shuffle")}
              removing={removingIds.has(cell.id)}
              shaking={shakingIds.has(cell.id)}
              spawned={spawnedIds.has(cell.id)}
              fall={fallMeta.get(cell.id)}
              cascadeDurationMs={cascadeDurationMs}
              positionDurationMs={positionDurationMs}
              celebrating={celebrating}
              hinted={hintDirections.has(key)}
              hintDirection={hintDirections.get(key)}
              activated={activatedIds.has(cell.id)}
              impact={obstacleImpacts.get(cell.id)}
              removeDelay={(row + col) * Math.max(0.005, Math.min(0.012, cascadeDurationMs / 30000))}
              reducedMotion={reducedMotion}
              artworkFailed={artworkFailed}
              swipeEnabled={!moving && !activeBooster && gameStatus === "active" && !cell.obstacle}
              onSwipe={onPieceSwipe}
              onClick={onPieceClick}
            />
          );
      })}
    </AnimatePresence>
  );
});

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

function FxParticles() {
  // Particle rendering moved to one GPU-friendly canvas layer in v77.
  return null;
}

const particleColorForEffect = (effect = {}) => {
  if (effect.special === "color_bomb" || effect.special === "booster_color_bomb") return "#F64CFF";
  if (effect.special === "bomb") return "#FF5C00";
  if (["rocket_row", "rocket_col", "booster_rocket"].includes(effect.special)) return "#FFB800";
  if (effect.obstacle && OBSTACLES[effect.obstacle]) return OBSTACLES[effect.obstacle].color;
  if (effect.effect === "core_blast" || effect.effect === "core_pulse") return "#FF4D55";
  if (effect.effect === "crystal_burst") return "#C084FC";
  if (effect.effect === "slime_spread") return "#4ADE80";
  if (effect.effect === "web_spread") return "#E4E4E7";
  return "#B78CFF";
};

const MAX_EFFECTS_CANVAS_CSS_SIZE = 2048;
const MAX_EFFECTS_CANVAS_BITMAP_SIZE = 4096;

const BoardEffectsCanvas = forwardRef(function BoardEffectsCanvas({ effects = [], reducedMotion = false }, ref) {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const seenTokensRef = useRef(new Set());
  const frameRef = useRef(0);
  const resizeFrameRef = useRef(0);
  const lastInvalidSizeRef = useRef(null);
  const sizeRef = useRef({ width: 1, height: 1, dpr: 1 });

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const rawWidth = Number(rect.width);
    const rawHeight = Number(rect.height);
    const invalidSize = !Number.isFinite(rawWidth)
      || !Number.isFinite(rawHeight)
      || rawWidth <= 0
      || rawHeight <= 0
      || rawWidth > MAX_EFFECTS_CANVAS_CSS_SIZE
      || rawHeight > MAX_EFFECTS_CANVAS_CSS_SIZE;

    if (invalidSize) {
      const signature = `${rawWidth}x${rawHeight}`;
      if (lastInvalidSizeRef.current !== signature) {
        lastInvalidSizeRef.current = signature;
        bonusMatchDiagnostics.log("effects_canvas_invalid_size_blocked", {
          rawWidth,
          rawHeight,
          bitmapWidth: canvas.width,
          bitmapHeight: canvas.height,
          parentRect: canvas.parentElement?.getBoundingClientRect?.() || null,
        }, "error");
      }
      return;
    }

    lastInvalidSizeRef.current = null;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rawWidth));
    const height = Math.max(1, Math.round(rawHeight));
    const bitmapWidth = Math.min(MAX_EFFECTS_CANVAS_BITMAP_SIZE, Math.max(1, Math.round(width * dpr)));
    const bitmapHeight = Math.min(MAX_EFFECTS_CANVAS_BITMAP_SIZE, Math.max(1, Math.round(height * dpr)));

    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
      canvas.width = bitmapWidth;
      canvas.height = bitmapHeight;
    }
    sizeRef.current = { width, height, dpr };
  }, []);

  const drawFrame = useCallback((now) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    const { width, height, dpr } = sizeRef.current;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const active = [];
    for (const particle of particlesRef.current) {
      if (now < particle.startAt) {
        active.push(particle);
        continue;
      }
      const progress = (now - particle.startAt) / particle.lifeMs;
      if (progress >= 1) continue;
      active.push(particle);
      const eased = 1 - ((1 - progress) ** 3);
      const fade = progress < 0.18 ? progress / 0.18 : 1 - ((progress - 0.18) / 0.82);
      const minSize = Math.min(width, height);
      const x = particle.x * width + Math.cos(particle.angle) * particle.distance * eased;
      const y = particle.y * height + Math.sin(particle.angle) * particle.distance * eased + progress * progress * minSize * 0.045;
      const size = particle.size * (0.72 + Math.sin(Math.PI * progress) * 0.42);

      context.save();
      context.globalAlpha = Math.max(0, fade);
      context.translate(x, y);
      context.rotate(particle.square ? progress * Math.PI * 1.6 : 0);
      context.fillStyle = particle.color;
      context.globalCompositeOperation = "lighter";
      if (particle.square) {
        context.fillRect(-size / 2, -size / 2, size, size);
      } else {
        context.beginPath();
        context.arc(0, 0, size / 2, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha *= 0.26;
      context.beginPath();
      context.arc(0, 0, size * 1.5, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    particlesRef.current = active;
    frameRef.current = active.length ? window.requestAnimationFrame(drawFrame) : 0;
  }, []);

  const ensureAnimation = useCallback(() => {
    if (!frameRef.current && particlesRef.current.length) {
      frameRef.current = window.requestAnimationFrame(drawFrame);
    }
  }, [drawFrame]);

  const emitAt = useCallback((row, col, options = {}) => {
    if (reducedMotion || row === undefined || col === undefined) return;
    resizeCanvas();
    const count = Math.max(3, Math.min(16, Number(options.count || 8)));
    const distance = Math.max(18, Number(options.distance || 36));
    const now = performance.now();
    for (let index = 0; index < count; index += 1) {
      particlesRef.current.push({
        x: (Number(col) + 0.5) / COLS,
        y: (Number(row) + 0.5) / ROWS,
        angle: ((Math.PI * 2) / count) * index + (index % 2) * 0.19,
        distance: distance * (0.72 + (index % 4) * 0.105),
        color: options.color || "#B78CFF",
        size: Number(options.size || (options.square ? 5.5 : 4.5)),
        square: Boolean(options.square),
        startAt: now + Number(options.delayMs || 0) + index * Number(options.staggerMs || 7),
        lifeMs: Math.max(180, Number(options.lifeMs || 430)),
      });
    }
    if (particlesRef.current.length > 180) particlesRef.current = particlesRef.current.slice(-180);
    ensureAnimation();
  }, [ensureAnimation, reducedMotion, resizeCanvas]);

  useImperativeHandle(ref, () => ({
    burstCells(cells = [], color = "#B78CFF") {
      if (!cells.length) return;
      const averageRow = cells.reduce((sum, item) => sum + Number(item.row || 0), 0) / cells.length;
      const averageCol = cells.reduce((sum, item) => sum + Number(item.col || 0), 0) / cells.length;
      emitAt(averageRow, averageCol, {
        color,
        count: Math.min(16, 7 + cells.length),
        distance: Math.min(58, 30 + cells.length * 2),
        lifeMs: 420,
      });
    },
    emit(effect = {}) {
      const row = effect.to_row ?? effect.row;
      const col = effect.to_col ?? effect.col;
      emitAt(row, col, {
        color: particleColorForEffect(effect),
        count: effect.special === "bomb" || effect.effect === "core_blast" ? 14 : 8,
        distance: effect.special === "bomb" || effect.effect === "core_blast" ? 54 : 34,
        square: ["crate", "stone", "metal"].includes(effect.obstacle),
      });
    },
  }), [emitAt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const host = canvas.parentElement;

    const scheduleResize = () => {
      if (resizeFrameRef.current) window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = 0;
        resizeCanvas();
      });
    };

    scheduleResize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleResize) : null;
    if (host) observer?.observe(host);
    window.addEventListener("resize", scheduleResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", scheduleResize);
      if (resizeFrameRef.current) window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = 0;
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      particlesRef.current = [];
    };
  }, [resizeCanvas]);

  useEffect(() => {
    for (const effect of effects || []) {
      const token = effect.token || `${effect.stage}-${effect.special || effect.obstacle || effect.effect}-${effect.row}-${effect.col}`;
      if (!token || seenTokensRef.current.has(token)) continue;
      seenTokensRef.current.add(token);
      if (effect.stage !== "fire") continue;
      const row = effect.to_row ?? effect.row;
      const col = effect.to_col ?? effect.col;
      if (row === undefined || col === undefined) continue;
      const heavy = effect.special === "bomb" || effect.effect === "core_blast";
      emitAt(row, col, {
        color: particleColorForEffect(effect),
        count: heavy ? 14 : effect.special === "color_bomb" ? 12 : 8,
        distance: heavy ? 56 : effect.special === "color_bomb" ? 48 : 34,
        square: ["crate", "stone", "metal"].includes(effect.obstacle),
        lifeMs: heavy ? 520 : 400,
      });
      if (Array.isArray(effect.targets) && effect.targets.length && ["crystal_burst", "core_blast"].includes(effect.effect)) {
        effect.targets.slice(0, 9).forEach((target, index) => emitAt(target.row, target.col, {
          color: particleColorForEffect(effect),
          count: 3,
          distance: 20,
          delayMs: index * 12,
          lifeMs: 300,
        }));
      }
    }
    if (seenTokensRef.current.size > 320) {
      seenTokensRef.current = new Set((effects || []).map((item) => item.token).filter(Boolean));
    }
  }, [effects, emitAt]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute left-1.5 top-1.5 z-30 block"
      style={{
        width: "calc(100% - 0.75rem)",
        height: "calc(100% - 0.75rem)",
      }}
      data-bonus-effects-canvas="v90"
      aria-hidden="true"
    />
  );
});

function FxCellFlash({ row, col, color, delay = 0, reducedMotion = false, tempo = 1 }) {
  return (
    <motion.div
      className="pointer-events-none absolute z-20 rounded-[10px] border-2"
      style={{ ...cellBoxStyle(row, col), borderColor: color, background: `${color}2E` }}
      initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.55 }}
      animate={{ opacity: [0, 0.95, 0], scale: reducedMotion ? 1 : [0.55, 1.12, 0.88] }}
      transition={{ duration: reducedMotion ? 0.12 : fxDuration(0.36, tempo, 0.14), delay: reducedMotion ? 0 : fxDelay(delay, tempo), ease: "easeOut" }}
    />
  );
}

function FxRing({ row, col, color, size = 1.7, delay = 0, duration = 0.42, reducedMotion = false, border = 4, tempo = 1 }) {
  return (
    <motion.div
      className="pointer-events-none absolute z-20 aspect-square rounded-full"
      style={{ ...cellBoxStyle(row, col, size), border: `${border}px solid ${color}` }}
      initial={{ opacity: 0.95, scale: reducedMotion ? 1 : 0.12 }}
      animate={{ opacity: 0, scale: reducedMotion ? 1 : 1.35 }}
      transition={{ duration: reducedMotion ? 0.12 : fxDuration(duration, tempo, 0.12), delay: reducedMotion ? 0 : fxDelay(delay, tempo), ease: "easeOut" }}
    />
  );
}

function FxSpecialCharge({ effect, reducedMotion }) {
  const tempo = effect.tempo || 1;
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
        transition={{ duration: reducedMotion ? 0.12 : fxDuration(special === "color_bomb" ? 0.42 : 0.32, tempo, 0.12), ease: "easeOut" }}
      >
        <motion.span
          className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white/70 bg-black/75"
          animate={reducedMotion ? undefined : special === "color_bomb" ? { rotate: 360 } : { scale: [0.88, 1.12, 0.88] }}
          transition={{ duration: fxDuration(special === "color_bomb" ? 0.38 : 0.24, tempo, 0.1), ease: "easeInOut" }}
        >
          <Icon size={21} color={color} strokeWidth={3} />
        </motion.span>
      </motion.div>
      <FxRing row={effect.row} col={effect.col} color={color} size={1.55} duration={0.35} reducedMotion={reducedMotion} border={2} tempo={tempo} />
      <FxRing row={effect.row} col={effect.col} color="#FFFFFF" size={1.15} delay={0.06} duration={0.28} reducedMotion={reducedMotion} border={2} tempo={tempo} />
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
  const tempo = effect.tempo || 1;
  const targets = (effect.targets || []).filter((target) => target.row !== effect.row || target.col !== effect.col).slice(0, 24);
  return (
    <>
      <motion.svg
        className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible"
        viewBox={`0 0 ${COLS} ${ROWS}`}
        preserveAspectRatio="none"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0] }}
        transition={{ duration: reducedMotion ? 0.16 : fxDuration(0.72, tempo, 0.28) }}
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
            transition={{ duration: reducedMotion ? 0.12 : fxDuration(0.36, tempo, 0.14), delay: reducedMotion ? 0 : fxDelay(Math.floor(index / 5) * 0.07, tempo), ease: "easeOut" }}
          />
        ))}
      </motion.svg>
      <FxRing row={effect.row} col={effect.col} color="#F64CFF" size={2.1} duration={0.55} reducedMotion={reducedMotion} border={4} tempo={tempo} />
      <FxParticles row={effect.row} col={effect.col} color="#F64CFF" count={10} distance={46} reducedMotion={reducedMotion} tempo={tempo} />
      {targets.map((target, index) => (
        <FxCellFlash
          key={`joker-flash-${target.row}-${target.col}-${index}`}
          row={target.row}
          col={target.col}
          color={index % 2 ? "#00F0FF" : "#F64CFF"}
          delay={reducedMotion ? 0 : Math.floor(index / 5) * 0.07 + 0.08}
          reducedMotion={reducedMotion}
          tempo={tempo}
        />
      ))}
    </>
  );
}

function FxRocket({ effect, reducedMotion }) {
  const tempo = effect.tempo || 1;
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
        transition={{ duration: reducedMotion ? 0.14 : fxDuration(0.42, tempo, 0.16), ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.div
        className="pointer-events-none absolute z-40 flex items-center justify-center"
        style={cellBoxStyle(effect.row, effect.col, 1.05)}
        initial={{ opacity: 1, scale: 0.7, x: 0, y: 0 }}
        animate={rowRocket
          ? { opacity: [1, 1, 0], scale: [0.7, 1.2, 0.8], x: [0, reducedMotion ? 0 : 130] }
          : { opacity: [1, 1, 0], scale: [0.7, 1.2, 0.8], y: [0, reducedMotion ? 0 : -130] }}
        transition={{ duration: reducedMotion ? 0.14 : fxDuration(0.42, tempo, 0.16), ease: "easeIn" }}
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
          tempo={tempo}
        />
      ))}
    </>
  );
}

function FxBomb({ effect, reducedMotion }) {
  const tempo = effect.tempo || 1;
  const targets = (effect.targets || []).slice(0, 12);
  return (
    <>
      <motion.div
        className="pointer-events-none absolute z-30 rounded-full bg-white"
        style={cellBoxStyle(effect.row, effect.col, 0.75)}
        initial={{ scale: 0.15, opacity: 1 }}
        animate={{ scale: reducedMotion ? 1 : [0.15, 1.2, 0.25], opacity: [1, 0.95, 0] }}
        transition={{ duration: reducedMotion ? 0.12 : fxDuration(0.34, tempo, 0.13), ease: "easeOut" }}
      />
      <FxRing row={effect.row} col={effect.col} color="#FFB800" size={2.15} duration={0.46} reducedMotion={reducedMotion} border={4} tempo={tempo} />
      <FxRing row={effect.row} col={effect.col} color="#FF5C00" size={3.25} delay={0.05} duration={0.52} reducedMotion={reducedMotion} border={5} tempo={tempo} />
      <FxParticles row={effect.row} col={effect.col} color="#FF5C00" count={12} distance={54} reducedMotion={reducedMotion} square tempo={tempo} />
      {targets.map((target, index) => (
        <FxCellFlash
          key={`bomb-target-${target.row}-${target.col}-${index}`}
          row={target.row}
          col={target.col}
          color={index % 2 ? "#FFB800" : "#FF5C00"}
          delay={reducedMotion ? 0 : (Math.abs(target.row - effect.row) + Math.abs(target.col - effect.col)) * 0.045}
          reducedMotion={reducedMotion}
          tempo={tempo}
        />
      ))}
    </>
  );
}

function FxObstacle({ effect, reducedMotion }) {
  const tempo = effect.tempo || 1;
  const obstacle = effect.obstacle;
  if (!obstacle) return null;
  const destroyed = Boolean(effect.destroyed);
  const color = OBSTACLES[obstacle]?.color || "#B78CFF";
  const count = destroyed ? 10 : 5;
  const common = (
    <>
      <FxCellFlash row={effect.row} col={effect.col} color={color} reducedMotion={reducedMotion} tempo={tempo} />
      <FxParticles row={effect.row} col={effect.col} color={color} count={count} distance={destroyed ? 44 : 27} reducedMotion={reducedMotion} square={["crate", "stone", "metal"].includes(obstacle)} tempo={tempo} />
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
            transition={{ duration: reducedMotion ? 0.12 : fxDuration(0.34, tempo, 0.13), delay: reducedMotion ? 0 : fxDelay(line * 0.035, tempo) }}
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
            transition={{ duration: reducedMotion ? 0.12 : fxDuration(0.42, tempo, 0.16), ease: "easeOut" }}
          />
        ))}
      </>
    );
  }

  if (obstacle === "crate") {
    return <>{common}<FxRing row={effect.row} col={effect.col} color="#FDBA74" size={1.55} duration={0.38} reducedMotion={reducedMotion} border={3} tempo={tempo} /></>;
  }

  if (obstacle === "stone") {
    return <>{common}<FxRing row={effect.row} col={effect.col} color="#D4D4D8" size={1.4} duration={0.35} reducedMotion={reducedMotion} border={5} tempo={tempo} /></>;
  }

  if (obstacle === "crystal") {
    return (
      <>{common}
        <motion.div
          className="pointer-events-none absolute z-40"
          style={cellBoxStyle(effect.row, effect.col, destroyed ? 3 : 1.5)}
          initial={{ opacity: 0, scale: 0.25, rotate: -12 }}
          animate={{ opacity: [0, 1, 0], scale: [0.25, 1.1, 1.32], rotate: 12 }}
          transition={{ duration: reducedMotion ? 0.14 : fxDuration(0.52, tempo, 0.2), ease: "easeOut" }}
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
          transition={{ duration: reducedMotion ? 0.12 : fxDuration(0.4, tempo, 0.15), ease: "easeIn" }}
        />
      </>
    );
  }

  if (obstacle === "shield") {
    return (
      <>{common}
        <FxRing row={effect.row} col={effect.col} color="#60A5FA" size={1.75} duration={0.45} reducedMotion={reducedMotion} border={4} tempo={tempo} />
        <FxRing row={effect.row} col={effect.col} color="#FFFFFF" size={1.25} delay={0.05} duration={0.3} reducedMotion={reducedMotion} border={2} tempo={tempo} />
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
            transition={{ duration: reducedMotion ? 0.12 : fxDuration(0.48, tempo, 0.18), delay: reducedMotion ? 0 : fxDelay(bubble * 0.04, tempo) }}
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
            transition={{ duration: reducedMotion ? 0.12 : fxDuration(0.3, tempo, 0.12), delay: reducedMotion ? 0 : fxDelay((spark + 1) * 0.03, tempo) }}
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
          transition={{ duration: reducedMotion ? 0.14 : fxDuration(destroyed ? 0.68 : 0.42, tempo, destroyed ? 0.26 : 0.16), ease: "easeOut" }}
        />
        <FxRing row={effect.row} col={effect.col} color="#FF4D55" size={destroyed ? 3.6 : 2.1} duration={destroyed ? 0.7 : 0.45} reducedMotion={reducedMotion} border={5} tempo={tempo} />
      </>
    );
  }

  return common;
}

function FxSpread({ effect, reducedMotion }) {
  const tempo = effect.tempo || 1;
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
        transition={{ duration: reducedMotion ? 0.14 : fxDuration(web ? 0.48 : 0.56, tempo, 0.18), ease: "easeOut" }}
      />
      <FxCellFlash row={effect.to_row} col={effect.to_col} color={color} delay={reducedMotion ? 0 : 0.22} reducedMotion={reducedMotion} tempo={tempo} />
      {!web && <FxParticles row={effect.to_row} col={effect.to_col} color={color} count={6} distance={26} delay={0.18} reducedMotion={reducedMotion} tempo={tempo} />}
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
              {(effect.targets || []).map((target, index) => <FxCellFlash key={`crystal-target-${index}`} row={target.row} col={target.col} color="#C084FC" delay={index * 0.04} reducedMotion={reducedMotion} tempo={effect.tempo || 1} />)}
            </motion.div>
          );
        }

        if (effectType === "core_pulse" || effectType === "core_blast") {
          const blast = effectType === "core_blast";
          return (
            <motion.div key={`core-${token}`} className="pointer-events-none absolute inset-0 z-30">
              <FxObstacle effect={{ ...effect, obstacle: "core", destroyed: blast }} reducedMotion={reducedMotion} />
              {blast && (effect.targets || []).map((target, index) => <FxCellFlash key={`core-target-${index}`} row={target.row} col={target.col} color="#FF4D55" delay={index * 0.025} reducedMotion={reducedMotion} tempo={effect.tempo || 1} />)}
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
            tempo={effect.tempo || 1}
          />
        ));
      })}
    </AnimatePresence>
  );
}


function BonusMatchScreen() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const { user, mode, refreshMe } = useApp();
  const boardRef = useRef(null);
  const scoreRef = useRef(null);
  const effectsCanvasRef = useRef(null);
  const pieceClickHandlerRef = useRef(null);
  const pieceSwipeHandlerRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [game, setGame] = useState(null);
  const [displayBoard, setDisplayBoard] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [artworkReady, setArtworkReady] = useState(false);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [moving, setMoving] = useState(false);
  const [shakingIds, setShakingIds] = useState(new Set());
  const [removingIds, setRemovingIds] = useState(new Set());
  const [spawnedIds, setSpawnedIds] = useState(new Set());
  const [fallMeta, setFallMeta] = useState(new Map());
  const [cascadeMotion, setCascadeMotion] = useState({ step: 0, durationMs: CASCADE_STEP_MS[0], token: "idle" });
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
  const [buyingLife, setBuyingLife] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [nativeFullscreenElement, setNativeFullscreenElement] = useState(
    () => document.fullscreenElement || document.webkitFullscreenElement || null,
  );
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const [hintMove, setHintMove] = useState(null);
  const [activityToken, setActivityToken] = useState(0);
  const [celebrating, setCelebrating] = useState(false);
  const diagnosticsStateRef = useRef({});
  const gameFullscreenRef = useRef(null);
  const autoResumeSessionRef = useRef(true);
  const fullscreenScrollRef = useRef(0);

  const isAdmin = user?.role === "admin";
  const isFullscreen = Boolean(nativeFullscreenElement || pseudoFullscreen);
  const visualPieces = useMemo(() => flattenVisualPieces(displayBoard), [displayBoard]);
  const selectedKey = selected ? coordKey(selected.row, selected.col) : null;
  diagnosticsStateRef.current = {
    gameId: game?.id || null,
    level: game?.level || selectedLevel,
    gameStatus: game?.status || null,
    movesLeft: game?.moves_left ?? null,
    score: game?.score ?? animatedScore,
    visualPieceCount: visualPieces.length,
    displayBoard,
    moving,
    selected,
    activeBooster,
    combo,
    boardFx,
    flash,
    cascadeMotion,
    removingCount: removingIds.size,
    spawnedCount: spawnedIds.size,
    activatedCount: activatedIds.size,
    specialEffectCount: specialEffects.length,
    artworkReady,
    artworkFailed,
    fullscreenMode: nativeFullscreenElement ? "native" : pseudoFullscreen ? "viewport" : "off",
  };
  const dispatchPieceClick = useCallback((row, col) => {
    pieceClickHandlerRef.current?.(row, col);
  }, []);
  const dispatchPieceSwipe = useCallback((from, to) => {
    pieceSwipeHandlerRef.current?.(from, to);
  }, []);

  const hintDirections = useMemo(() => {
    const directions = new Map();
    if (!hintMove) return directions;
    const dr = hintMove.to.row - hintMove.from.row;
    const dc = hintMove.to.col - hintMove.from.col;
    directions.set(coordKey(hintMove.from.row, hintMove.from.col), { dr, dc });
    directions.set(coordKey(hintMove.to.row, hintMove.to.col), { dr: -dr, dc: -dc });
    return directions;
  }, [hintMove]);

  const registerBoardInteraction = () => {
    setHintMove(null);
    setActivityToken((current) => current + 1);
  };

  useEffect(() => {
    if (!isAdmin) return undefined;
    const uninstall = bonusMatchDiagnostics.installGlobalHandlers();
    bonusMatchDiagnostics.log("bonus_match_mount", { version: "v97" });
    return () => {
      bonusMatchDiagnostics.log("bonus_match_unmount");
      bonusMatchDiagnostics.stopWatch();
      uninstall?.();
    };
  }, [isAdmin]);

  // V112: every active board opens in the viewport-only game mode by default.
  // A user can still leave fullscreen with the in-game button; the effect only
  // runs again when a different session is opened.
  useEffect(() => {
    if (game?.id) setPseudoFullscreen(true);
  }, [game?.id]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setNativeFullscreenElement(document.fullscreenElement || document.webkitFullscreenElement || null);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!pseudoFullscreen) return undefined;
    fullscreenScrollRef.current = window.scrollY;
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
    document.body.style.top = `-${fullscreenScrollRef.current}px`;
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
      window.scrollTo(0, fullscreenScrollRef.current);
    };
  }, [pseudoFullscreen]);

  const exitGameFullscreen = async () => {
    if (pseudoFullscreen) setPseudoFullscreen(false);
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fullscreenElement) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (typeof exit === "function") {
      try {
        await exit.call(document);
      } catch (error) {
        bonusMatchDiagnostics.log("fullscreen_exit_failed", { error }, "warn");
      }
    }
  };

  const toggleFullscreen = async () => {
    if (!game) return;
    if (isFullscreen) {
      await exitGameFullscreen();
      return;
    }

    const target = gameFullscreenRef.current;
    const request = target?.requestFullscreen || target?.webkitRequestFullscreen;
    if (typeof request === "function") {
      try {
        await request.call(target);
        bonusMatchDiagnostics.log("fullscreen_native_entered", { target: "bonus-game-surface" });
        return;
      } catch (error) {
        bonusMatchDiagnostics.log("fullscreen_native_failed_fallback", { error }, "warn");
      }
    }

    setPseudoFullscreen(true);
    bonusMatchDiagnostics.log("fullscreen_pseudo_entered", {
      reason: typeof request === "function" ? "native-request-failed" : "fullscreen-api-unavailable",
    });
  };

  useEffect(() => {
    if (!isAdmin || !game || game.status !== "active") {
      bonusMatchDiagnostics.stopWatch();
      return undefined;
    }
    bonusMatchDiagnostics.startWatch({
      getState: () => diagnosticsStateRef.current,
      getBoard: () => boardRef.current,
    });
    bonusMatchDiagnostics.snapshot("active_session_watch_started", diagnosticsStateRef.current, true);
    return () => bonusMatchDiagnostics.stopWatch();
  }, [game?.id, game?.status, isAdmin]);

  useEffect(() => {
    let mounted = true;
    bonusMatchDiagnostics.log("artwork_preload_started");
    preloadBonusMatchArtwork()
      .then((result) => {
        if (!mounted) return;
        setArtworkFailed(!result?.ok);
        setArtworkReady(true);
        bonusMatchDiagnostics.log("artwork_preload_finished", result || {});
      })
      .catch((error) => {
        if (!mounted) return;
        setArtworkFailed(true);
        setArtworkReady(true);
        bonusMatchDiagnostics.log("artwork_preload_failed", { error }, "error");
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const board = boardRef.current;
    if (!board || typeof MutationObserver === "undefined") return undefined;

    const removeUnexpectedReplacedElements = () => {
      board.querySelectorAll("img, picture, object, embed, iframe").forEach((node) => node.remove());
    };

    removeUnexpectedReplacedElements();
    const observer = new MutationObserver(removeUnexpectedReplacedElements);
    observer.observe(board, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [game?.id, game?.status]);

  useEffect(() => {
    if (!selected || moving || activeBooster) return undefined;
    const timer = window.setTimeout(() => setSelected(null), 2500);
    return () => window.clearTimeout(timer);
  }, [selected, moving, activeBooster]);

  useEffect(() => {
    setHintMove(null);
    if (!game || game.status !== "active" || moving || selected || activeBooster || celebrating) return undefined;
    const timer = window.setTimeout(() => {
      const move = findHintMove(displayBoard);
      if (move) setHintMove(move);
    }, HINT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [game, moving, selected, activeBooster, celebrating, displayBoard, activityToken]);

  // A hint is ephemeral. Clear it after one pulse so old highlighted pieces can never accumulate.
  useEffect(() => {
    if (!hintMove) return undefined;
    const clearTimer = window.setTimeout(() => setHintMove(null), 1350);
    return () => window.clearTimeout(clearTimer);
  }, [hintMove]);

  const applySessionState = async (rawSession, animation = null) => {
    bonusMatchDiagnostics.log("apply_session_state", { sessionId: rawSession?.id, status: rawSession?.status, reshuffled: Boolean(animation?.reshuffled) });
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
      await wait(reducedMotion ? 70 : RESHUFFLE_MS);
      setFlash("");
      toast.info("На полі не залишилося ходів. Фішки автоматично перемішано");
      return session;
    }

    setDisplayBoard(session.board);
    return session;
  };

  const loadStatus = async ({ restoreActiveSession = autoResumeSessionRef.current } = {}) => {
    bonusMatchDiagnostics.log("status_load_started", { mode, restoreActiveSession });
    if (mode === "mock") {
      const mockStatus = {
        profile: { current_level: 1, max_level: 150, total_stars: 0, lives: 5, max_lives: 5, next_life_at: null, daily_points: 0, daily_point_cap: null, balance: 24500, life_price: 10, booster_prices: { hammer: 10, rocket: 20, color_bomb: 50, shuffle: 30 }, boosters: { hammer: 2, rocket: 1, color_bomb: 1, shuffle: 2 } },
        levels: Array.from({ length: 150 }, (_, index) => levelConfig(index + 1)),
        completions: [],
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
      bonusMatchDiagnostics.log("status_load_succeeded", { hasActiveSession: Boolean(data.active_session), level: data.profile?.current_level });
      setStatus(data);
      setSelectedLevel(Number(data.profile.current_level || 1));
      if (restoreActiveSession && data.active_session) {
        await applySessionState(data.active_session, data.active_session_animation);
      }
    } catch (error) {
      bonusMatchDiagnostics.log("status_load_failed", { error }, "error");
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
  const boardMask = useMemo(() => {
    const supplied = config?.board_mask;
    if (Array.isArray(supplied) && supplied.length === ROWS) {
      return supplied.map((row) => Array.from({ length: COLS }, (_, col) => Boolean(row?.[col])));
    }
    if (game && !config?.board_shape) {
      const hasVoidCells = (displayBoard || []).some((row) => (row || []).some((cell) => cell?.void));
      if (!hasVoidCells) return boardMaskForShape("full");
      return (displayBoard || []).map((row) => Array.from({ length: COLS }, (_, col) => !row?.[col]?.void));
    }
    return boardMaskForShape(config?.board_shape || boardShapeForLevel(game?.level || selectedLevel));
  }, [config?.board_mask, config?.board_shape, displayBoard, game, selectedLevel]);
  const lowMoves = Boolean(game?.status === "active" && Number(game?.moves_left) <= 3);
  const boosterInventory = status?.profile?.boosters || {};
  const boosterPrices = useMemo(() => {
    const catalog = new Map((status?.booster_catalog || []).map((item) => [item.id, Number(item.price)]));
    return Object.fromEntries(Object.entries(BOOSTERS).map(([id, item]) => [
      id,
      Number(status?.profile?.booster_prices?.[id] ?? catalog.get(id) ?? item.price),
    ]));
  }, [status?.booster_catalog, status?.profile?.booster_prices]);
  const lifePrice = Number(status?.profile?.life_price || 10);
  const scoreProgress = Math.min(100, Math.round(((animatedScore || 0) / Math.max(1, config.target_score)) * 100));
  const coinProgress = Math.min(100, Math.round(((game?.coins_collected || 0) / Math.max(1, config.target_coins)) * 100));

  const startGame = async (level = selectedLevel, confirmed = false) => {
    autoResumeSessionRef.current = true;
    bonusMatchDiagnostics.log("game_start_requested", { level, confirmed, mode });
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
    setHintMove(null);
    setFallMeta(new Map());
    setCelebrating(false);
    setCascadeMotion({ step: 0, durationMs: CASCADE_STEP_MS[0], token: "idle" });
    if (mode === "mock") {
      const levelBoard = makeMockBoard(level, preview);
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
      bonusMatchDiagnostics.log("game_start_succeeded", { sessionId: data.session?.id, level: data.session?.level, resumed: data.resumed });
      await applySessionState(data.session, data.animation);
      setStatus((current) => (current ? { ...current, profile: { ...current.profile, ...data.profile } } : current));
      if (data.resumed) toast.info("Продовжуємо незавершений рівень");
    } catch (error) {
      bonusMatchDiagnostics.log("game_start_failed", { level, error }, "error");
      toast.error(extractError(error, "Не вдалося почати рівень"));
    } finally {
      setLoading(false);
    }
  };

  const burstAtCells = (cells = [], color = "#B78CFF") => {
    if (reducedMotion || !cells.length) return;
    effectsCanvasRef.current?.burstCells(cells, color);
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

  const tickScore = async (start, end, totalDurationMs = 190) => {
    if (reducedMotion) {
      setAnimatedScore(end);
      return;
    }
    const ticks = Math.max(3, Math.min(6, Math.round(totalDurationMs / 42)));
    const delay = Math.max(20, Math.round(totalDurationMs / ticks));
    for (let index = 1; index <= ticks; index += 1) {
      setAnimatedScore(Math.round(start + ((end - start) * index) / ticks));
      setScorePulse(true);
      await wait(delay);
      setScorePulse(false);
    }
  };

  const playWinCelebration = async () => {
    setHintMove(null);
    setCelebrating(true);
    setBoardFx("won");
    setFlash("РІВЕНЬ ПРОЙДЕНО!");
    await wait(reducedMotion ? 120 : 920);
    setCelebrating(false);
    setFlash("");
    setBoardFx("");
    if (!reducedMotion) fireConfetti();
  };

  const queueSpecialEffects = (items, lifetimeMs = 720) => {
    const nextItems = (items || []).filter(Boolean);
    if (!nextItems.length) return;
    const tokens = new Set(nextItems.map((item) => item.token).filter(Boolean));
    setSpecialEffects((current) => [...current.slice(-28), ...nextItems]);
    window.setTimeout(() => {
      setSpecialEffects((current) => current.filter((item) => !tokens.has(item.token)));
    }, reducedMotion ? Math.min(180, lifetimeMs) : lifetimeMs);
  };

  const animateServerMove = async (data, baseScore) => {
    bonusMatchDiagnostics.log("animation_pipeline_started", { valid: data?.valid, sessionId: data?.session?.id, baseScore });
    const animation = data.animation || {};
    const frames = Array.isArray(animation.frames) && animation.frames.length
      ? animation.frames
      : [
        ...(animation.swapped_board ? [{ phase: "swap", board: animation.swapped_board }] : []),
        ...(animation.steps || []).flatMap((step) => [
          {
            phase: "match",
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
            combo: step.combo,
            board: step.board_after_collapse,
            spawned: step.spawned,
            spawned_ids: (step.spawned || []).map((item) => item.id).filter(Boolean),
          },
        ]),
        ...(animation.reshuffled && data.session?.board
          ? [{ phase: "reshuffle", board: data.session.board }]
          : []),
      ];

    setHintMove(null);
    setFallMeta(new Map());

    const swapFrame = frames.find((frame) => frame.phase === "swap");
    let currentBoard = normalizeBoard(
      swapFrame?.board
      || animation.swapped_board
      || displayBoard
      || data.session?.board,
    );

    if (!data.valid) {
      const invalidFrame = frames.find((frame) => frame.phase === "invalid");
      const pair = animation.swap;
      const ids = new Set((invalidFrame?.shake_ids || []).filter(Boolean));
      if (!ids.size && pair) {
        const firstId = currentBoard?.[pair.from.row]?.[pair.from.col]?.id;
        const secondId = currentBoard?.[pair.to.row]?.[pair.to.col]?.id;
        if (firstId) ids.add(firstId);
        if (secondId) ids.add(secondId);
      }
      setShakingIds(ids);
      await wait(reducedMotion ? 45 : INVALID_SHAKE_MS);
      setShakingIds(new Set());
      const reverted = normalizeBoard(invalidFrame?.board || animation.reverted_board || data.session?.board || game.board);
      setDisplayBoard(reverted);
      await wait(reducedMotion ? 35 : INVALID_RETURN_MS);
      if (data.session) {
        const session = { ...data.session, board: normalizeBoard(data.session.board) };
        setGame(session);
        setAnimatedScore(session.score || 0);
      }
      toast.info(data.message || "Спробуй інший хід");
      return;
    }

    let runningScore = Number(baseScore || 0);
    let cascadeIndex = 0;

    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      bonusMatchDiagnostics.log("animation_frame", { index, phase: frame.phase, combo: frame.combo, scoreGain: frame.score_gain, cleared: frame.cleared_cells?.length || 0, spawned: frame.spawned_ids?.length || frame.spawned?.length || 0 });
      if (frame.phase === "swap") continue;

      if (frame.phase === "match") {
        const stepStartedAt = performance.now();
        const stepDurationMs = reducedMotion ? 80 : cascadeDurationForStep(cascadeIndex);
        const tempoRatio = stepDurationMs / CASCADE_STEP_MS[0];
        const before = normalizeBoard(frame.board || currentBoard);
        currentBoard = before;
        const fxToken = `${Date.now()}-${index}-${cascadeIndex}`;
        setCascadeMotion({ step: cascadeIndex, durationMs: stepDurationMs, token: fxToken });
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
        const active = new Set();
        activations.forEach(({ row, col, id }) => {
          const pieceId = id || before?.[row]?.[col]?.id;
          if (pieceId) active.add(pieceId);
        });

        const impactMap = new Map();
        changes.forEach((change, changeIndex) => {
          const pieceId = before?.[change.row]?.[change.col]?.id;
          if (pieceId) impactMap.set(pieceId, { ...change, token: `${fxToken}-impact-${changeIndex}` });
        });
        setObstacleImpacts(impactMap);
        setActivatedIds(active);
        setRemovingIds(removed);
        setCombo(frame.combo || cascadeIndex + 1);
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
        setBoardFx(nextBoardFx);

        const effectTempo = Math.max(0.48, tempoRatio);
        const chargeEffects = activations
          .filter((item) => ["rocket_row", "rocket_col", "bomb", "color_bomb"].includes(item.special))
          .map((item, effectIndex) => ({
            ...item,
            stage: "charge",
            tempo: effectTempo,
            token: `${fxToken}-charge-${effectIndex}`,
          }));
        queueSpecialEffects(chargeEffects, 420);

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
          toast.success(crateReward.replacement_symbol === "coin" ? "У ЯЩИКУ БУЛА МОНЕТА!" : "ЯЩИК ВІДКРИТО!");
        }

        // Flush the anticipation frame immediately. The server response never controls timing.
        await nextPaint();
        await waitUntil(stepStartedAt + (reducedMotion ? 20 : MATCH_FIRE_LEAD_MS));

        const fireEffects = [
          ...activations.map((item, effectIndex) => ({ ...item, stage: "fire", tempo: effectTempo, token: `${fxToken}-special-${effectIndex}` })),
          ...changes.map((item, effectIndex) => ({ ...item, stage: "fire", tempo: effectTempo, token: `${fxToken}-obstacle-${effectIndex}` })),
          ...obstacleEvents.map((item, effectIndex) => ({ ...item, stage: "fire", tempo: effectTempo, token: `${fxToken}-event-${effectIndex}` })),
        ];
        queueSpecialEffects(fireEffects, hasColorBomb || hasCoreBlast ? 760 : hasBomb ? 620 : 520);

        const burstColor = hasBomb || hasCoreBlast
          ? "#FF5C00"
          : hasColorBomb
            ? "#F64CFF"
            : hasRocket
              ? "#FFB800"
              : "#B78CFF";
        burstAtCells(frame.cleared_cells || [], burstColor);
        launchScoreFlight(frame.cleared_cells || [], frame.score_gain || 0);

        await waitUntil(stepStartedAt + (reducedMotion ? 38 : MATCH_COLLAPSE_LEAD_MS));

        const collapseFrame = frames[index + 1]?.phase === "collapse" ? frames[index + 1] : null;
        if (collapseFrame?.board) {
          const spawnedList = (collapseFrame.spawned_ids || collapseFrame.spawned?.map((item) => item.id) || []).filter(Boolean);
          const collapsedBoard = normalizeBoard(collapseFrame.board);
          const fall = buildFallMeta(before, collapsedBoard, spawnedList, boardRef.current?.clientWidth, `${fxToken}-fall`);
          setSpawnedIds(new Set(spawnedList));
          setFallMeta(fall);
          setDisplayBoard(collapsedBoard);
          currentBoard = collapsedBoard;

          const nextScore = runningScore + Number(frame.score_gain || 0);
          void tickScore(runningScore, nextScore, Math.min(160, Math.max(80, stepDurationMs * 0.46)));
          runningScore = nextScore;
          index += 1;
        }

        // Match, obstacle effects and falling overlap. Only the step deadline gates the next cascade.
        await waitUntil(stepStartedAt + stepDurationMs);
        setRemovingIds(new Set());
        setSpawnedIds(new Set());
        setFallMeta(new Map());
        setActivatedIds(new Set());
        setObstacleImpacts(new Map());
        setBoardFx("");
        setFlash("");
        cascadeIndex += 1;
        continue;
      }

      if (frame.phase === "collapse" && frame.board) {
        const stepStartedAt = performance.now();
        const stepDurationMs = reducedMotion ? 70 : cascadeDurationForStep(cascadeIndex);
        const collapsedBoard = normalizeBoard(frame.board);
        const spawnedList = (frame.spawned_ids || frame.spawned?.map((item) => item.id) || []).filter(Boolean);
        const fall = buildFallMeta(currentBoard, collapsedBoard, spawnedList, boardRef.current?.clientWidth, `${Date.now()}-orphan-fall`);
        setCascadeMotion({ step: cascadeIndex, durationMs: stepDurationMs, token: `${Date.now()}-collapse` });
        setSpawnedIds(new Set(spawnedList));
        setFallMeta(fall);
        setDisplayBoard(collapsedBoard);
        currentBoard = collapsedBoard;
        await waitUntil(stepStartedAt + stepDurationMs);
        setSpawnedIds(new Set());
        setFallMeta(new Map());
        cascadeIndex += 1;
        continue;
      }

      if (frame.phase === "obstacle" && frame.board) {
        const turnStartedAt = performance.now();
        const events = frame.events || [];
        const token = `${Date.now()}-obstacle-turn`;
        queueSpecialEffects(events.map((item, eventIndex) => ({ ...item, stage: "fire", tempo: 0.72, token: `${token}-${eventIndex}` })), 620);
        const obstacleBoard = normalizeBoard(frame.board);
        setDisplayBoard(obstacleBoard);
        currentBoard = obstacleBoard;
        if (events.some((item) => item.effect === "slime_spread")) {
          setBoardFx("slime");
          setFlash("СЛИЗ ПОШИРИВСЯ");
          toast.info("Слиз зайняв сусідню клітинку");
        } else if (events.some((item) => item.effect === "web_spread")) {
          setBoardFx("web");
          setFlash("ПАВУТИНА РОЗРОСЛАСЯ");
          toast.info("Павутина обплутала сусідню фішку");
        }
        await waitUntil(turnStartedAt + (reducedMotion ? 80 : OBSTACLE_TURN_MS));
        setBoardFx("");
        setFlash("");
        continue;
      }

      if (frame.phase === "reshuffle" && frame.board) {
        const shuffleStartedAt = performance.now();
        setFlash(animation.reason === "manual" ? "ПЕРЕМІШУЄМО" : "ХОДІВ НЕМАЄ");
        await waitUntil(shuffleStartedAt + (reducedMotion ? 20 : 55));
        setFlash("ПЕРЕМІШУЄМО");
        const shuffledBoard = normalizeBoard(frame.board);
        setDisplayBoard(shuffledBoard);
        currentBoard = shuffledBoard;
        await waitUntil(shuffleStartedAt + (reducedMotion ? 80 : RESHUFFLE_MS));
        setFlash("");
      }
    }

    if (animation.reshuffled) {
      toast.info(animation.reason === "manual" ? "Поле перемішано" : "На полі не залишилося ходів. Фішки автоматично перемішано");
    }
    const finalSession = { ...data.session, board: normalizeBoard(data.session.board) };
    setAnimatedScore(finalSession.score || runningScore);
    setDisplayBoard(finalSession.board);
    setGame(finalSession);
    setCascadeMotion({ step: 0, durationMs: CASCADE_STEP_MS[0], token: "idle" });
    setFallMeta(new Map());
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
    const price = Number(boosterPrices[booster] ?? meta.price);
    if (!window.confirm(`Придбати «${meta.label}» за ${price} Point?`)) return;
    if (mode === "mock") {
      const balance = Number(status?.profile?.balance || 0);
      if (balance < price) return toast.error("Недостатньо Point для покупки");
      patchBoosterProfile({ ...boosterInventory, [booster]: Number(boosterInventory[booster] || 0) + 1 }, balance - price);
      toast.success(`${meta.label} придбано`);
      return;
    }
    setBuyingBooster(booster);
    try {
      const { data } = await api.post("/games/bonus-match/boosters/purchase", { booster });
      patchBoosterProfile(data.boosters, data.balance);
      await refreshMe().catch(() => {});
      toast.success(`${meta.label} придбано`, { description: `−${data.price || price} Point` });
    } catch (error) {
      toast.error(extractError(error, "Не вдалося придбати бонус"));
    } finally {
      setBuyingBooster(null);
    }
  };

  const purchaseLife = async () => {
    if (buyingLife) return;
    const lives = Number(status?.profile?.lives || 0);
    const maxLives = Number(status?.profile?.max_lives || 5);
    if (lives >= maxLives) return toast.info("У тебе вже максимальна кількість життів");
    if (!window.confirm(`Придбати 1 життя за ${lifePrice} Point?`)) return;

    if (mode === "mock") {
      const balance = Number(status?.profile?.balance || 0);
      if (balance < lifePrice) return toast.error("Недостатньо Point для покупки життя");
      setStatus((current) => current ? {
        ...current,
        profile: {
          ...current.profile,
          lives: Math.min(Number(current.profile.max_lives || 5), Number(current.profile.lives || 0) + 1),
          balance: balance - lifePrice,
        },
      } : current);
      toast.success("Життя придбано");
      return;
    }

    setBuyingLife(true);
    try {
      const { data } = await api.post("/games/bonus-match/lives/purchase");
      setStatus((current) => current ? {
        ...current,
        profile: {
          ...current.profile,
          lives: Number(data.lives),
          max_lives: Number(data.max_lives || current.profile.max_lives || 5),
          next_life_at: data.next_life_at,
          balance: Number(data.balance),
        },
      } : current);
      await refreshMe().catch(() => {});
      toast.success("Життя придбано", { description: `−${data.price || lifePrice} Point` });
    } catch (error) {
      toast.error(extractError(error, "Не вдалося придбати життя"));
    } finally {
      setBuyingLife(false);
    }
  };

  const applyBooster = async (booster, row = null, col = null) => {
    if (!game || moving || game.status !== "active") return;
    registerBoardInteraction();
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
        if (data.session?.status === "won") await playWinCelebration();
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
    registerBoardInteraction();
    if (Number(boosterInventory[booster] || 0) <= 0) {
      toast.info(`Натисни «+», щоб придбати за ${boosterPrices[booster] ?? BOOSTERS[booster].price} Point`);
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
    bonusMatchDiagnostics.snapshot("move_started", { ...diagnosticsStateRef.current, from, to }, true);
    registerBoardInteraction();
    setMoving(true);
    setSelected(null);
    setFlash("");
    const startingGame = game;
    const startingBoard = normalizeBoard(displayBoard.length ? displayBoard : game.board);
    const optimistic = cloneBoard(startingBoard);
    [optimistic[from.row][from.col], optimistic[to.row][to.col]] = [optimistic[to.row][to.col], optimistic[from.row][from.col]];
    const swapStartedAt = performance.now();

    // Input feedback is local and immediate. Network latency no longer sits before the first frame.
    setDisplayBoard(optimistic);
    setGame((current) => current ? { ...current, moves_left: Math.max(0, Number(current.moves_left || 0) - 1) } : current);

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

      const data = await request;
      bonusMatchDiagnostics.log("move_response_received", { valid: data?.valid, result: data?.result, sessionStatus: data?.session?.status, frameCount: data?.animation?.frames?.length || 0, elapsedMs: Math.round(performance.now() - swapStartedAt) });
      await waitUntil(swapStartedAt + (reducedMotion ? 25 : OPTIMISTIC_SWAP_MS));
      await animateServerMove(data, game.score);

      if (data.result) {
        setResult(data.result);
        if (data.session.status === "won") {
          await playWinCelebration();
          if (mode !== "mock") await refreshMe().catch(() => {});
        } else {
          setBoardFx("lost");
          await wait(reducedMotion ? 30 : 320);
        }
        if (mode !== "mock") await loadStatus();
      }
    } catch (error) {
      bonusMatchDiagnostics.snapshot("move_failed", { ...diagnosticsStateRef.current, from, to, error }, true);
      setDisplayBoard(startingBoard);
      setGame(startingGame);
      toast.error(extractError(error, "Не вдалося виконати хід"));
    } finally {
      bonusMatchDiagnostics.snapshot("move_finished", { ...diagnosticsStateRef.current, from, to });
      setMoving(false);
      setCombo(0);
      window.setTimeout(() => setFlash(""), 420);
    }
  };

  const restartLevel = async () => {
    if (!game || game.status !== "active" || moving || restarting) return;
    const availableLives = Number(status?.profile?.lives || 0);
    if (availableLives <= 0) {
      toast.error("Для перегравання потрібне ще одне життя. Вийди в меню та придбай його за 10 Point");
      return;
    }
    if (!window.confirm(`Здатися та почати рівень ${game.level} заново? Буде витрачено 1 життя.`)) return;

    setRestarting(true);
    const level = Number(game.level);
    try {
      if (mode !== "mock") {
        await api.post("/games/bonus-match/surrender", { session_id: game.id });
      }
      setGame(null);
      setDisplayBoard([]);
      setResult(null);
      setSelected(null);
      setActiveBooster(null);
      await startGame(level, true);
    } catch (error) {
      toast.error(extractError(error, "Не вдалося переграти рівень"));
    } finally {
      setRestarting(false);
    }
  };

  const handlePiece = (row, col) => {
    if (moving || game?.status !== "active") return;
    registerBoardInteraction();
    const cell = displayBoard?.[row]?.[col];
    if (activeBooster) {
      if (!cell || cell.void) return;
      applyBooster(activeBooster, row, col);
      return;
    }
    if (!cell || cell.void || cell.obstacle) {
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

  const handleSwipe = (from, to) => {
    if (moving || game?.status !== "active" || activeBooster) return;
    registerBoardInteraction();
    const source = displayBoard?.[from.row]?.[from.col];
    const target = displayBoard?.[to.row]?.[to.col];
    if (!source || !target || source.void || target.void || source.obstacle || target.obstacle) return;
    makeMove(from, to);
  };

  // Stable dispatchers keep memoized board pieces from receiving fresh callback identities.
  pieceClickHandlerRef.current = handlePiece;
  pieceSwipeHandlerRef.current = handleSwipe;

  const unlockedLevels = levelCatalog
    .map((item) => Number(item.level))
    .filter((level) => level <= Number(status?.profile?.current_level || 1));
  const nextCatalogLevel = game
    ? levelCatalog.find((item) => Number(item.level) > Number(game.level))?.level || null
    : null;

  const selectedUnlockedIndex = unlockedLevels.indexOf(Number(selectedLevel));

  const chooseLevel = (delta) => {
    if (!unlockedLevels.length) return;
    const currentIndex = Math.max(0, unlockedLevels.indexOf(Number(selectedLevel)));
    const nextIndex = Math.max(0, Math.min(unlockedLevels.length - 1, currentIndex + delta));
    setSelectedLevel(unlockedLevels[nextIndex]);
  };

  const leaveBoard = async () => {
    const savedLevel = Number(game?.level || selectedLevel || 1);
    bonusMatchDiagnostics.log("game_menu_requested", { sessionId: game?.id || null, level: savedLevel, status: game?.status || null });
    if (game?.status === "active") toast.info("Рівень збережено. Ти зможеш продовжити пізніше");
    autoResumeSessionRef.current = false;
    await exitGameFullscreen();
    setGame(null);
    setDisplayBoard([]);
    setResult(null);
    setSelected(null);
    setBoardFx("");
    setActiveBooster(null);
    setHintMove(null);
    setFallMeta(new Map());
    setCelebrating(false);
    setSelectedLevel(savedLevel);
    await loadStatus({ restoreActiveSession: false });
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };

  if (!artworkReady || (loading && !status && !game)) {
    return (
      <>
        {isAdmin && <BonusMatchDebugOverlay getState={() => diagnosticsStateRef.current} />}
        <div className="px-5 py-12 text-center text-sm font-bold text-zinc-500">
          {artworkReady ? "Завантаження Bonus Match..." : "Готуємо фішки..."}
        </div>
      </>
    );
  }

  return (
    <div className="bonus-match-light-theme space-y-4 px-4 pb-8 pt-2" data-testid="bonus-match-page">
      {isAdmin && <BonusMatchDebugOverlay getState={() => diagnosticsStateRef.current} />}
      <section className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (game ? leaveBoard() : navigate("/"))}
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
        {game && (
          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#1A1A1E] text-zinc-300 active:scale-95"
            aria-label={isFullscreen ? "Вийти з повноекранного режиму" : "Відкрити гру на повний екран"}
            title={isFullscreen ? "Вийти з повноекранного режиму" : "Відкрити тільки гру на повний екран"}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        )}
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
              <div className="flex items-center gap-2">
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
                {(status?.profile?.lives || 0) < (status?.profile?.max_lives || 5) && (
                  <button
                    type="button"
                    onClick={purchaseLife}
                    disabled={buyingLife}
                    className="flex items-center gap-1 rounded-xl border border-[#FF4D55]/35 bg-[#FF4D55]/10 px-2 py-1 text-[9px] font-black text-[#FF858B] disabled:opacity-50"
                    aria-label={`Придбати життя за ${lifePrice} Point`}
                  >
                    <Plus size={11} strokeWidth={3} />1 · {lifePrice}
                  </button>
                )}
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
            {(status?.profile?.lives || 0) <= 0 && (
              <div className="mt-3 grid gap-2">
                <button type="button" onClick={purchaseLife} disabled={buyingLife} className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#FF4D55]/35 bg-[#FF4D55]/10 text-xs font-black text-[#FF858B] disabled:opacity-50">
                  <Heart size={16} fill="#FF4D55" />{buyingLife ? "КУПУЄМО…" : `КУПИТИ ЖИТТЯ ЗА ${lifePrice} POINT`}
                </button>
                <div className="text-center text-[11px] font-bold text-zinc-500">Або зачекай 30 хвилин на автоматичне відновлення</div>
              </div>
            )}
          </section>

          <section className="grid grid-cols-2 gap-3">
            <div className="rounded-3xl border border-[#FFB800]/25 bg-[#1A1A1E] p-4">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-[#FFB800]"><Star size={15} fill="#FFB800" />ЩОДЕННА НАГОРОДА</div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div><div className="font-display text-3xl text-white">{status?.profile?.daily_points || 0}</div><div className="text-xs font-bold text-zinc-500">Point сьогодні</div></div>
                <div className="rounded-full border border-[#FFB800]/25 bg-[#FFB800]/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#FFB800]">Без ліміту</div>
              </div>
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
                  <div key={player.user_id || player.rank} className="diamond-card-auto flex items-center gap-3 rounded-2xl border border-white/[.07] bg-black/20 p-2.5">
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
        <div
          ref={gameFullscreenRef}
          data-bonus-game-surface="v97"
          data-fullscreen-mode={nativeFullscreenElement ? "native" : pseudoFullscreen ? "viewport" : "off"}
          className={isFullscreen
            ? "bonus-match-fullscreen fixed inset-0 z-[140] overflow-hidden overscroll-none bg-[#08070D] px-0"
            : ""}
          style={isFullscreen ? {
            width: "100vw",
            height: "100dvh",
            minHeight: "100vh",
            paddingTop: "max(8px, env(safe-area-inset-top))",
            paddingBottom: "max(10px, env(safe-area-inset-bottom))",
            WebkitOverflowScrolling: "auto",
            touchAction: "none",
          } : undefined}
        >
          <div className={isFullscreen ? "mx-auto min-h-full w-full max-w-[560px] px-2 sm:px-4" : ""}>
            {isFullscreen && (
              <div className="sticky top-0 z-[180] mb-2 flex justify-end pt-1">
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-black/85 px-3 text-[10px] font-black text-white shadow-lg backdrop-blur"
                >
                  <Minimize2 size={16} />ВИЙТИ З ПОВНОГО ЕКРАНА
                </button>
              </div>
            )}
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
              <motion.div
                className={`rounded-2xl border px-2 py-2.5 text-center ${lowMoves ? "border-[#FF4D55]/70 bg-[#FF4D55]/[.12]" : "border-[#FFB800]/20 bg-[#FFB800]/[.06]"}`}
                animate={lowMoves && !reducedMotion ? {
                  scale: [1, 1.055, 1],
                  borderColor: ["rgba(255,77,85,.5)", "rgba(255,77,85,1)", "rgba(255,77,85,.5)"],
                  boxShadow: ["0 0 0 rgba(255,77,85,0)", "0 0 20px rgba(255,77,85,.42)", "0 0 0 rgba(255,77,85,0)"],
                } : { scale: 1 }}
                transition={{ duration: 0.82, repeat: lowMoves && !reducedMotion ? Infinity : 0, ease: "easeInOut" }}
              >
                <div className={`text-[8px] font-black uppercase tracking-wider ${lowMoves ? "text-[#FF9CA2]" : "text-zinc-600"}`}>ХОДИ</div>
                <div className={`mt-0.5 text-lg font-black ${lowMoves ? "text-[#FF4D55]" : "text-[#FFB800]"}`}>{game.moves_left}</div>
              </motion.div>
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

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={leaveBoard}
                disabled={moving || restarting}
                className="flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/25 text-[10px] font-black text-zinc-300 disabled:opacity-40"
              >
                <Home size={15} />МЕНЮ ГРИ
              </button>
              <button
                type="button"
                onClick={restartLevel}
                disabled={moving || restarting || game.status !== "active"}
                className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[#FF5C00]/30 bg-[#FF5C00]/10 text-[10px] font-black text-[#FF8A3D] disabled:opacity-40"
              >
                <RotateCcw size={15} className={restarting ? "animate-spin" : ""} />{restarting ? "ПЕРЕЗАПУСК…" : "ЗДАТИСЬ / ПЕРЕГРАТИ"}
              </button>
            </div>

            <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-white/[.08] bg-black/25 p-3">
              <div>
                <div className="flex items-center justify-between text-[10px] font-black"><span className="text-zinc-500">Ціль: {formatNumber(config.target_score)}</span><span className="text-[#B78CFF]">{scoreProgress}%</span></div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#0A0A0A]"><motion.div className="h-full rounded-full bg-gradient-to-r from-[#7C3AED] to-[#B78CFF]" animate={{ width: `${scoreProgress}%` }} transition={{ duration: reducedMotion ? 0.05 : 0.25 }} /></div>
              </div>
              <div className="flex min-w-[72px] items-center justify-center gap-1.5 rounded-xl border border-[#FFB800]/25 bg-[#FFB800]/10 px-2 py-2 text-[#FFB800]"><Coins size={15} /><span className="text-sm font-black">{game.coins_collected}/{config.target_coins}</span></div>
            </div>

            <AnimatePresence>
              {game.status !== "active" && !celebrating && (
                <motion.div
                  className={`mt-3 rounded-2xl border p-3 text-center ${game.status === "won" ? "border-[#22C55E]/35 bg-[#22C55E]/[.08]" : "border-[#EF5350]/35 bg-[#EF5350]/[.08]"}`}
                  initial={{ opacity: 0, y: -10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8 }}
                >
                  <div className={`font-display text-xl ${game.status === "won" ? "text-[#22C55E]" : "text-[#EF5350]"}`}>{game.status === "won" ? "РІВЕНЬ ПРОЙДЕНО!" : "ХОДИ ЗАКІНЧИЛИСЯ"}</div>
                  <div className="mt-2 flex items-center justify-center gap-3">
                    <Stars count={result?.stars || 0} size={22} animated={game.status === "won"} reducedMotion={reducedMotion} />
                    <span className="text-xs font-black text-zinc-500">Рахунок: {formatNumber(game.score)}</span>
                  </div>
                  {game.status === "won" && result && (
                    <div className="mt-2 text-[11px] font-black text-[#FFB800]">
                      +{Number(result.points_awarded || 0)} Point • +{Number(result.xp_awarded || 0)} XP
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={leaveBoard} className="flex h-10 items-center justify-center rounded-xl border border-white/10 bg-[#1A1A1E] text-xs font-black text-zinc-300"><RotateCcw size={15} className="mr-1.5" />РІВНІ</button>
                    <button
                      type="button"
                      onClick={() => {
                        if (game.status === "won" && !nextCatalogLevel) {
                          leaveBoard();
                          return;
                        }
                        startGame(game.status === "won" ? nextCatalogLevel : game.level);
                      }}
                      className="flex h-10 items-center justify-center rounded-xl bg-[#7C3AED] text-xs font-black text-white"
                    >
                      {game.status === "won" ? (nextCatalogLevel ? "НАСТУПНИЙ РІВЕНЬ" : "ДО РІВНІВ") : "ЩЕ РАЗ"}
                      <ChevronRight size={15} className="ml-1" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div
              ref={boardRef}
              className="bonus-match-board relative isolate mt-3 overflow-hidden rounded-[24px] bg-[#B4AFF1] p-1.5 shadow-[0_0_18px_rgba(124,58,237,.26),inset_0_0_20px_rgba(255,255,255,.28)]"
              data-render-engine="v97"
              animate={boardMotionForFx(boardFx, reducedMotion)}
              transition={{
                duration: boardFx === "won"
                  ? 0.92
                  : (boardFx === "core" ? 0.62 : boardFx === "bomb" || boardFx === "color_bomb" ? 0.5 : 0.42)
                    * Math.max(0.55, cascadeMotion.durationMs / CASCADE_STEP_MS[0]),
                ease: "easeOut",
              }}
            >
              <div className="grid grid-cols-7 gap-1" aria-hidden="true">
                {Array.from({ length: ROWS * COLS }, (_, index) => {
                  const row = Math.floor(index / COLS);
                  const col = index % COLS;
                  const active = Boolean(boardMask[row]?.[col]);
                  return (
                    <div
                      key={`slot-${index}`}
                      className={`aspect-square min-w-0 rounded-[11px] ${active ? "bg-cover bg-center" : "pointer-events-none bg-transparent opacity-0"}`}
                      style={active ? { backgroundImage: `url("${BONUS_MATCH_CELL_IMAGE}")` } : undefined}
                    />
                  );
                })}
              </div>


              <BoardPiecesLayer
                pieces={visualPieces}
                selectedKey={selectedKey}
                moving={moving}
                gameStatus={game.status}
                activeBooster={activeBooster}
                removingIds={removingIds}
                shakingIds={shakingIds}
                spawnedIds={spawnedIds}
                fallMeta={fallMeta}
                cascadeDurationMs={cascadeMotion.durationMs}
                celebrating={celebrating}
                hintDirections={hintDirections}
                activatedIds={activatedIds}
                obstacleImpacts={obstacleImpacts}
                reducedMotion={reducedMotion}
                artworkFailed={artworkFailed}
                onPieceClick={dispatchPieceClick}
                onPieceSwipe={dispatchPieceSwipe}
              />

              <SpecialEffects effects={specialEffects} reducedMotion={reducedMotion} />
              <BoardEffectsCanvas ref={effectsCanvasRef} effects={specialEffects} reducedMotion={reducedMotion} />

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
                    transition={{
                      duration: reducedMotion ? 0.12 : 0.68 * Math.max(0.55, cascadeMotion.durationMs / CASCADE_STEP_MS[0]),
                      ease: [0.22, 1, 0.36, 1],
                    }}
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
                  <div className="mt-0.5 text-[8px] font-bold text-zinc-700">Ціна вказана на кожному бонусі</div>
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
                      <span className="text-[8px] font-black text-[#FFB800]">{boosterPrices[id] ?? item.price} Point</span>
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

            <div className="mt-3 flex items-center justify-between px-1 text-[10px] font-bold text-zinc-600"><span>{activeBooster ? "Торкнися цільової клітинки" : "Свайпни фішку або використай два тапи"}</span><span>{coinProgress}% монет</span></div>
          </motion.section>


          </div>
        </div>
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

export default function BonusMatch() {
  const { user } = useApp();
  return (
    <BonusMatchErrorBoundary allowDiagnostics={user?.role === "admin"}>
      <BonusMatchScreen />
    </BonusMatchErrorBoundary>
  );
}
