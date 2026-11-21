import { Chess, type Square } from 'chess.js';

/**
 * Position complexity for the perceived-depth selector.
 *
 * `computeComplexity` answers one question: how much is going on here that a
 * human has to *see*? It is a pure, engine-free score in [0, 1] built from
 * board features only, so it can run on every bot move.
 *
 * ---------------------------------------------------------------------------
 * Calibration hooks — every constant below is intended to be refit
 * ---------------------------------------------------------------------------
 * | constant                  | what it changes        | target statistic            |
 * | ------------------------- | ---------------------- | --------------------------- |
 * | `DEFAULT_COMPLEXITY_WEIGHTS` | how much each feature counts | ACPL by rating band: |
 * |                           |                        | weak players lose more in    |
 * |                           |                        | high-complexity positions    |
 * | `COMPLEXITY_SQUASH_GAIN`  | how fast complexity saturates | blunder rate vs |
 * |                           |                        | complexity curve shape       |
 * | `HANGING_SATURATION`      | pieces that count as "maximum danger" | top-1 match |
 * | `FORCING_SATURATION`      | forcing moves that count as "maximum" | top-1 match |
 * | `BRANCHING_*`             | the move-count knee/ceiling | top-1 match vs move count |
 * | `VOLATILITY_*`            | spread/flip blend      | top-1 match rate across |
 * |                           |                        | iterative-deepening depths   |
 *
 * The features are exported raw alongside the score so a fitting script can
 * regress whatever it wants without touching this file.
 */

const PIECE_VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

export interface ComplexityFeatures {
  /** Pieces of either side attacked while undefended, or attacked by something cheaper. */
  hangingPieces: number;
  /** Checks, captures and promotions available to the side to move. */
  forcingMoves: number;
  /** Enemy attacks into + missing pawn shield around the more exposed king. */
  kingExposure: number;
  /** 1 when the side to move is in check. */
  inCheck: number;
  /** Mutually attacked piece pairs (trade opportunities). */
  materialTension: number;
  /** Legal move count, normalised. */
  branching: number;
  /** Absolute pins and skewers against either side. */
  pinsAndSkewers: number;
  /** Only present when a search history was supplied. */
  evalVolatility: number | null;
}

export interface ComplexityWeights {
  hangingPieces: number;
  forcingMoves: number;
  kingExposure: number;
  inCheck: number;
  materialTension: number;
  branching: number;
  pinsAndSkewers: number;
  evalVolatility: number;
}

/** Starting weights; they sum to 1 when `evalVolatility` is available. */
export const DEFAULT_COMPLEXITY_WEIGHTS: ComplexityWeights = {
  hangingPieces: 0.2,
  forcingMoves: 0.15,
  kingExposure: 0.2,
  inCheck: 0.1,
  materialTension: 0.1,
  branching: 0.05,
  pinsAndSkewers: 0.1,
  evalVolatility: 0.1,
};

/** `1 - exp(-GAIN * x)`: x is the weighted feature sum, so complexity saturates. */
export const COMPLEXITY_SQUASH_GAIN = 2.2;

/** Hanging pieces at which the feature reads 1.0. */
export const HANGING_SATURATION = 4;
/** Forcing moves at which the feature reads 1.0. */
export const FORCING_SATURATION = 10;
/** Move count that reads 0.3 — typical quiet middlegame branching. */
export const BRANCHING_KNEE = 20;
/** Move count that reads 1.0. */
export const BRANCHING_CEILING = 40;
/** King-zone danger at which the feature reads 1.0. */
export const KING_ZONE_SATURATION = 16;
/** Mutually attacked pairs at which tension reads 1.0. */
export const TENSION_SATURATION = 8;
/** Pins + skewers at which the feature reads 1.0. */
export const PIN_SATURATION = 6;
/** Centipawn spread across depths that reads as fully volatile. */
export const VOLATILITY_SPREAD_CP = 400;
/** Share of the volatility score taken from the spread, rest from best-move flips. */
export const VOLATILITY_SPREAD_SHARE = 0.6;

/** One entry per depth of one move's iterative-deepening history. */
export interface DepthSample {
  depth: number;
  cp: number;
}

/** `uci → depth-by-depth scores` for one searched position. */
export type MoveHistoryLike = ReadonlyMap<string, readonly DepthSample[]>;

export interface ComplexityOptions {
  /** Iterative-deepening history of the current position, if the caller has it. */
  history?: MoveHistoryLike | null;
}

export interface ComplexityResult {
  complexity: number;
  features: ComplexityFeatures;
}

/**
 * Weights actually used for a given call: dropping `evalVolatility` (no search
 * history) renormalises the remaining seven back to a sum of 1, so the squash
 * input keeps the same scale whether or not the caller has a history.
 */
export function effectiveComplexityWeights(useVolatility: boolean): ComplexityWeights {
  if (useVolatility) return { ...DEFAULT_COMPLEXITY_WEIGHTS };
  const weights = { ...DEFAULT_COMPLEXITY_WEIGHTS, evalVolatility: 0 };
  const total =
    weights.hangingPieces +
    weights.forcingMoves +
    weights.kingExposure +
    weights.inCheck +
    weights.materialTension +
    weights.branching +
    weights.pinsAndSkewers;
  if (total <= 0) return weights;
  return {
    hangingPieces: weights.hangingPieces / total,
    forcingMoves: weights.forcingMoves / total,
    kingExposure: weights.kingExposure / total,
    inCheck: weights.inCheck / total,
    materialTension: weights.materialTension / total,
    branching: weights.branching / total,
    pinsAndSkewers: weights.pinsAndSkewers / total,
    evalVolatility: 0,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function valueOf(type: string): number {
  return PIECE_VALUE[type] ?? 0;
}

function squareOf(fileIndex: number, rank: number): Square | null {
  if (fileIndex < 0 || fileIndex > 7 || rank < 1 || rank > 8) return null;
  return `${String.fromCharCode(97 + fileIndex)}${rank}` as Square;
}

function kingZone(kingSquare: string): Square[] {
  const file = kingSquare.charCodeAt(0) - 97;
  const rank = Number(kingSquare[1]);
  const squares: Square[] = [];
  for (let df = -1; df <= 1; df += 1) {
    for (let dr = -1; dr <= 1; dr += 1) {
      const square = squareOf(file + df, rank + dr);
      if (square) squares.push(square);
    }
  }
  return squares;
}

const SLIDER_DIRECTIONS: Record<string, ReadonlyArray<readonly [number, number]>> = {
  b: [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ],
  r: [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ],
  q: [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ],
};

interface BoardPiece {
  square: Square;
  type: string;
  color: 'w' | 'b';
}

/** One `attackers()` per square/colour per call: the features overlap heavily. */
type AttackerLookup = (square: Square, color: 'w' | 'b') => Square[];

function makeAttackerLookup(game: Chess): AttackerLookup {
  const cache = new Map<string, Square[]>();
  return (square, color) => {
    const key = `${square}:${color}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = game.attackers(square, color);
      cache.set(key, hit);
    }
    return hit;
  };
}

function piecesOf(game: Chess): BoardPiece[] {
  const out: BoardPiece[] = [];
  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece) continue;
      out.push({ square: piece.square as Square, type: piece.type, color: piece.color });
    }
  }
  return out;
}

/** Pieces attacked while undefended, or attacked by something cheaper. */
function hangingCount(
  game: Chess,
  pieces: BoardPiece[],
  attackersOf: AttackerLookup,
): number {
  let count = 0;
  for (const piece of pieces) {
    if (piece.type === 'k') continue;
    const opponent = piece.color === 'w' ? 'b' : 'w';
    const attackers = attackersOf(piece.square, opponent);
    if (attackers.length === 0) continue;
    const defenders = attackersOf(piece.square, piece.color);
    const cheapest = Math.min(
      ...attackers.map((square) => valueOf(game.get(square)?.type ?? 'p')),
    );
    if (defenders.length === 0 || cheapest < valueOf(piece.type)) count += 1;
  }
  return count;
}

/** Checks, captures and promotions available to the side to move. */
function forcingCount(game: Chess): { forcing: number; legal: number } {
  const moves = game.moves({ verbose: true });
  let forcing = 0;
  for (const move of moves) {
    const gives = move.san.endsWith('+') || move.san.endsWith('#');
    const takes = move.flags.includes('c') || move.flags.includes('e');
    const promotes = move.flags.includes('p');
    if (gives || takes || promotes) forcing += 1;
  }
  return { forcing, legal: moves.length };
}

/** Enemy pressure into the king zone, missing pawn shield and open files. */
function kingDanger(
  game: Chess,
  color: 'w' | 'b',
  kingSquare: string,
  attackersOf: AttackerLookup,
): number {
  const opponent = color === 'w' ? 'b' : 'w';
  const zone = kingZone(kingSquare);
  let attacked = 0;
  for (const square of zone) {
    if (attackersOf(square, opponent).length > 0) attacked += 1;
  }

  const fileIndex = kingSquare.charCodeAt(0) - 97;
  const rank = Number(kingSquare[1]);
  const shieldStep = color === 'w' ? 1 : -1;
  const homeHalf = color === 'w' ? rank <= 2 : rank >= 7;

  let missingShield = 0;
  let openFiles = 0;
  if (homeHalf) {
    for (let df = -1; df <= 1; df += 1) {
      const near = squareOf(fileIndex + df, rank);
      if (!near) continue;
      /* Two shield pawns in front of the king: one rank ahead, then two. */
      let hasPawn = false;
      for (let step = 1; step <= 2; step += 1) {
        const square = squareOf(fileIndex + df, rank + step * shieldStep);
        const piece = square ? game.get(square) : undefined;
        if (piece && piece.color === color && piece.type === 'p') hasPawn = true;
      }
      if (!hasPawn) missingShield += 1;

      /* A file with no pawns of either colour is an open highway to the king. */
      let pawnOnFile = false;
      for (let r = 1; r <= 8; r += 1) {
        const piece = game.get(squareOf(fileIndex + df, r) as Square);
        if (piece && piece.type === 'p') {
          pawnOnFile = true;
          break;
        }
      }
      if (!pawnOnFile) openFiles += 1;
    }
  }

  return attacked + missingShield * 0.5 + openFiles;
}

/** Mutually attacked piece pairs: trade opportunities waiting to happen. */
function tensionCount(
  game: Chess,
  pieces: BoardPiece[],
  attackersOf: AttackerLookup,
): number {
  let pairs = 0;
  for (const piece of pieces) {
    if (piece.color !== 'w' || piece.type === 'k') continue;
    for (const square of attackersOf(piece.square, 'b')) {
      const enemy = game.get(square);
      if (!enemy || enemy.color !== 'b' || enemy.type === 'k') continue;
      if (attackersOf(square, 'w').includes(piece.square)) pairs += 1;
    }
  }
  return pairs;
}

/** Absolute pins and skewers, read off the rays of every enemy slider. */
function pinCount(game: Chess, pieces: BoardPiece[]): number {
  let count = 0;
  for (const piece of pieces) {
    const directions = SLIDER_DIRECTIONS[piece.type];
    if (!directions) continue;
    const fileIndex = piece.square.charCodeAt(0) - 97;
    const rank = Number(piece.square[1]);

    for (const [df, dr] of directions) {
      let first: BoardPiece | null = null;
      let second: BoardPiece | null = null;
      for (let step = 1; step <= 7; step += 1) {
        const square = squareOf(fileIndex + df * step, rank + dr * step);
        if (!square) break;
        const target = game.get(square);
        if (!target) continue;
        const found: BoardPiece = {
          square,
          type: target.type,
          color: target.color as 'w' | 'b',
        };
        if (!first) first = found;
        else {
          second = found;
          break;
        }
      }
      /* Our slider, an enemy piece, and something of the enemy's behind it. */
      if (!first || first.color === piece.color) continue;
      if (!second || second.color === piece.color) continue;
      if (second.type === 'k') count += 1;
      else if (valueOf(second.type) > valueOf(first.type)) count += 1;
    }
  }
  return count;
}

/**
 * How much the search's opinion moves between iterations: the spread of scores
 * per move plus the rate at which the best move changes. Null without a history.
 */
export function computeEvalVolatility(history: MoveHistoryLike | null | undefined): number | null {
  if (!history || history.size < 2) return null;

  const depths = new Set<number>();
  for (const entries of history.values()) {
    for (const sample of entries) depths.add(sample.depth);
  }
  if (depths.size < 2) return null;
  const ordered = [...depths].sort((a, b) => a - b);

  let spreadSum = 0;
  let spreadCount = 0;
  for (const entries of history.values()) {
    if (entries.length < 2) continue;
    let min = Infinity;
    let max = -Infinity;
    for (const sample of entries) {
      min = Math.min(min, sample.cp);
      max = Math.max(max, sample.cp);
    }
    spreadSum += max - min;
    spreadCount += 1;
  }
  const spread = spreadCount > 0 ? spreadSum / spreadCount : 0;

  let flips = 0;
  let steps = 0;
  let previousBest: string | null = null;
  for (const depth of ordered) {
    let bestUci: string | null = null;
    let bestCp = -Infinity;
    for (const [uci, entries] of history) {
      const sample = entries.find((entry) => entry.depth === depth);
      if (!sample) continue;
      if (sample.cp > bestCp) {
        bestCp = sample.cp;
        bestUci = uci;
      }
    }
    if (bestUci === null) continue;
    if (previousBest !== null) {
      steps += 1;
      if (bestUci !== previousBest) flips += 1;
    }
    previousBest = bestUci;
  }

  const spreadScore = clamp01(spread / VOLATILITY_SPREAD_CP);
  const flipScore = steps > 0 ? flips / steps : 0;
  return clamp01(VOLATILITY_SPREAD_SHARE * spreadScore + (1 - VOLATILITY_SPREAD_SHARE) * flipScore);
}

function branchingScore(legal: number): number {
  if (legal <= 0) return 0;
  if (legal <= BRANCHING_KNEE) return (legal / BRANCHING_KNEE) * 0.3;
  const span = Math.max(1, BRANCHING_CEILING - BRANCHING_KNEE);
  return clamp01(0.3 + ((legal - BRANCHING_KNEE) / span) * 0.7);
}

/**
 * Complexity of a position, 0 (dead quiet) to 1 (everything is on fire).
 *
 * Pure: reads the board only, never the engine, never the clock, never random.
 * Pass `{ history }` when an iterative-deepening search of this position already
 * exists — `evalVolatility` is the single strongest difficulty proxy, and the
 * remaining weights are renormalised when it is absent.
 */
export function computeComplexity(
  position: Chess | string,
  opts: ComplexityOptions = {},
): ComplexityResult {
  const game = typeof position === 'string' ? new Chess(position) : position;
  const pieces = piecesOf(game);
  const attackersOf = makeAttackerLookup(game);
  const { forcing, legal } = forcingCount(game);

  let exposure = 0;
  let whiteKing: string | null = null;
  let blackKing: string | null = null;
  for (const piece of pieces) {
    if (piece.type !== 'k') continue;
    if (piece.color === 'w') whiteKing = piece.square;
    else blackKing = piece.square;
  }
  if (whiteKing) exposure = Math.max(exposure, kingDanger(game, 'w', whiteKing, attackersOf));
  if (blackKing) exposure = Math.max(exposure, kingDanger(game, 'b', blackKing, attackersOf));

  const volatility = computeEvalVolatility(opts.history ?? null);

  const features: ComplexityFeatures = {
    hangingPieces: clamp01(hangingCount(game, pieces, attackersOf) / HANGING_SATURATION),
    forcingMoves: clamp01(forcing / FORCING_SATURATION),
    kingExposure: clamp01(exposure / KING_ZONE_SATURATION),
    inCheck: game.isCheck() ? 1 : 0,
    materialTension: clamp01(tensionCount(game, pieces, attackersOf) / TENSION_SATURATION),
    branching: branchingScore(legal),
    pinsAndSkewers: clamp01(pinCount(game, pieces) / PIN_SATURATION),
    evalVolatility: volatility,
  };

  const weights = effectiveComplexityWeights(volatility !== null);
  const weighted =
    weights.hangingPieces * features.hangingPieces +
    weights.forcingMoves * features.forcingMoves +
    weights.kingExposure * features.kingExposure +
    weights.inCheck * features.inCheck +
    weights.materialTension * features.materialTension +
    weights.branching * features.branching +
    weights.pinsAndSkewers * features.pinsAndSkewers +
    (features.evalVolatility === null ? 0 : weights.evalVolatility * features.evalVolatility);

  const complexity = clamp01(1 - Math.exp(-COMPLEXITY_SQUASH_GAIN * weighted));
  return { complexity, features };
}
