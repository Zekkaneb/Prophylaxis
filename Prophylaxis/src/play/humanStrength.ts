import { Chess, type Square } from 'chess.js';

/**
 * Continuous USCF rating calibration for the Elo-rated bots.
 *
 * The model is a **six-bucket move-quality distribution** over `[100, 2800]`
 * USCF. Normalized skill is
 *
 *     s = (clamp(elo, 100, 2800) - 100) / 2700
 *
 * and every turn rolls once against six probabilities — blunder (`??`), mistake
 * (`?`), inaccuracy (`?!`), good (`✓`), excellent (`⦿`) and best (`*`) — that
 * always sum to 1. Phase and time-control multipliers only scale the three
 * error buckets; the displaced mass moves proportionally into good, excellent
 * and best, so a fast game makes a player worse rather than differently rated.
 *
 * Two more rating curves keep the errors human:
 *
 * - `recaptureChance` rises from 18% at 100 USCF to ~95% at 2800, replacing the
 *   old two-step switch;
 * - the severity buckets are filled by **intent** — a greedy capture, a check or
 *   forward attack, or a shallow-search favourite — never by sampling ranks
 *   21-32 of a wide search. A bot that errs plays a move a person would play
 *   and miss the point, not a move no one would consider.
 *
 * The engine itself always calculates: every rating searches at its own depth
 * over `MultiPV 10` lines, and the choice among those lines is what changes.
 */

/* --------------------------------------------------------------------------
   Continuous curves
   -------------------------------------------------------------------------- */

export const ELO_MIN = 100;
export const ELO_MAX = 2800;

/** MultiPV width of the main search: enough lines for every band to exist. */
export const HUMAN_MULTI_PV = 10;

/** Width and depth of the shallow "what does this look like" search. */
export const SHALLOW_MULTI_PV = 6;
export const SHALLOW_DEPTH = 3;

/** Below this rating the bot has no idea what it is doing yet. */
export const BEGINNER_ELO = 600;

/** From here up the bot is expected to see a counter-attack coming. */
export const TUNNEL_VISION_ELO = 600;

/** From here a slip must survive a deep calculation, not just a shallow look. */
export const DEEP_SLIP_ELO = 1500;

/** How many shallow lines count as "attractive" per tier. */
export const SHALLOW_TOP_RANKS_TUNNEL = 6;
export const SHALLOW_TOP_RANKS_DEEP = 4;

/** Below this rating the #1 engine line is damped on solid turns. */
export const TOP_LINE_DRIFT_ELO = 1500;

/** From here the bot refuses moves that walk into mate in one. */
export const SELF_MATE_GUARD_ELO = 1000;

/** Depth of the reference pass that re-scores the candidate moves. */
export const REFERENCE_DEPTH = 9;

/** Depth of the off-list probe used to find a beginner's real blunder. */
export const PROBE_DEPTH = 8;

/**
 * Shallow width used to collect beginner probe candidates.
 *
 * Only reachable below `BEGINNER_ELO`: a player who does not see the board yet
 * really does leave a piece where it can simply be taken, so the wide tail of a
 * shallow search is where those moves live.
 */
export const PROBE_MULTI_PV = 32;

/** Win-drop windows a probed off-list move must fall inside to count. */
export const PROBE_WINDOWS = {
  mistake: { min: 10, max: 20 },
  blunder: { min: 20, max: 45 },
} as const;

/** Temperature multiplier for picks inside a bucket. */
export const ERROR_TEMPERATURE_BOOST = 6;

/** Wider spread for low-rated picks inside a bucket. */
export const ERROR_TEMPERATURE_BOOST_LOW = 9;

/** Below this rating a positional drift is allowed to look like an error. */
export const POSITIONAL_DRIFT_ELO = 1250;

/** Extra multiplier on the quality-band temperature under the club band. */
export const SOLID_TEMPERATURE_BOOST_LOW = 2.2;
export const SOLID_TEMPERATURE_BOOST = 1.4;
export const SOLID_TEMPERATURE_ELO = 1300;

/** How much of the top-line weight the club-level drift removes at the floor. */
export const DRIFT_DAMPING_LOW = 0.35;

/** Below this rating the opening phase carries more of the error budget. */
export const OPENING_ELO_SPLIT = 1400;

/** Centre of each severity band, used by the distance fallback. */
export const BUCKET_CENTRES = {
  blunder: 30,
  mistake: 15,
  inaccuracy: 7.25,
  good: 3.15,
  excellent: 1.1,
  best: 0.2,
} as const;

/** Percentages at which one quality band ends and the next begins. */
export const QUALITY_BANDS = {
  best: 0.4,
  excellent: 1.8,
  good: 4.5,
  inaccuracy: 10,
  mistake: 20,
  blunder: 20,
} as const;

export type Bucket = 'blunder' | 'mistake' | 'inaccuracy' | 'good' | 'excellent' | 'best';

/** Best -> worst, the order a quality roll is consumed in. */
export const BUCKET_ORDER: readonly Bucket[] = [
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'blunder',
];

export interface QualityShares {
  /** `??`: win drop 20%+. */
  blunder: number;
  /** `?`: 10-20%. */
  mistake: number;
  /** `?!`: 4.5-10%. */
  inaccuracy: number;
  /** `✓`: 1.8-4.5%. */
  good: number;
  /** `⦿`: 0.4-1.8%. */
  excellent: number;
  /** `*`: under 0.4%. */
  best: number;
}

const ERROR_KEYS = ['blunder', 'mistake', 'inaccuracy'] as const;
const QUALITY_KEYS = ['good', 'excellent', 'best'] as const;

function normalizeQuality(shares: QualityShares): QualityShares {
  const total =
    shares.blunder +
    shares.mistake +
    shares.inaccuracy +
    shares.good +
    shares.excellent +
    shares.best;
  if (!(total > 0)) {
    return { blunder: 0, mistake: 0, inaccuracy: 0, good: 0, excellent: 0, best: 1 };
  }
  return {
    blunder: shares.blunder / total,
    mistake: shares.mistake / total,
    inaccuracy: shares.inaccuracy / total,
    good: shares.good / total,
    excellent: shares.excellent / total,
    best: shares.best / total,
  };
}

/**
 * Scales the three error buckets and moves the displaced mass into the quality
 * buckets, then normalizes all six.
 *
 * Growing the errors takes the extra probability proportionally from good,
 * excellent and best (so a blitz game is a worse version of the same player);
 * shrinking them hands it back the same way.
 */
export function scaleErrors(base: QualityShares, multiplier = 1): QualityShares {
  const factor = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  const errorSum = base.blunder + base.mistake + base.inaccuracy;
  const restSum = Math.max(1e-9, 1 - errorSum);
  const next: QualityShares = { ...base };

  for (const key of ERROR_KEYS) next[key] = base[key] * factor;

  const grown = errorSum * factor - errorSum;
  if (grown >= 0) {
    /* Cap the shrink so the quality buckets stay positive; normalization fixes
       the ratio afterwards. */
    const shrink = Math.min(0.999, grown / restSum);
    for (const key of QUALITY_KEYS) next[key] = base[key] * (1 - shrink);
  } else {
    const gained = -grown;
    for (const key of QUALITY_KEYS) next[key] = base[key] + gained * (base[key] / restSum);
  }

  return normalizeQuality(next);
}

export interface HumanCalibration {
  /** Target rating after clamping to the supported range. */
  elo: number;
  /** Normalized skill, 0 at 100 USCF and 1 at 2800. */
  skill: number;
  /** The six per-move probabilities, summing to 1. */
  quality: QualityShares;
  /** `pBlunder + pMistake + pInaccuracy`. */
  errorRate: number;
  /** Effective search depth before the time-control offset. */
  depth: number;
  /** Softmax temperature for quality moves. */
  temperature: number;
}

/** Clamped target rating. */
export function clampElo(elo: number): number {
  if (!Number.isFinite(elo)) return 1500;
  return Math.min(ELO_MAX, Math.max(ELO_MIN, Math.round(elo)));
}

/** Normalized skill, 0 at the floor and 1 at the ceiling. */
export function skillOf(elo: number): number {
  return (clampElo(elo) - ELO_MIN) / (ELO_MAX - ELO_MIN);
}

/**
 * The six-bucket move-quality distribution.
 *
 * Each curve has its own shape on purpose: blunders collapse fastest, mistakes
 * decay smoothly, good moves peak through the middle of the range (a 1400 plays
 * plenty of merely-sound moves), excellent rises with rating, and best takes
 * whatever the other five do not.
 */
export function qualityShares(elo: number, errorMultiplier = 1): QualityShares {
  const s = skillOf(elo);

  const blunder = 0.0005 + 0.56 * Math.exp(-5.4 * Math.pow(s, 1.15));
  const mistake = 0.008 + 0.28 * Math.exp(-3.1 * s);
  const inaccuracy =
    0.035 + 0.21 * Math.sin(Math.PI * Math.pow(s, 0.75)) * Math.exp(-0.6 * s);
  const good = 0.06 + 0.34 * Math.sin(Math.PI * Math.pow(s, 0.85));
  const excellent = 0.03 + 0.3 * Math.pow(s, 0.9);
  const best = Math.max(0.01, 1 - (blunder + mistake + inaccuracy + good + excellent));

  return scaleErrors({ blunder, mistake, inaccuracy, good, excellent, best }, errorMultiplier);
}

/**
 * Chance an obvious recapture is actually taken.
 *
 * 18% at 100 USCF (the piece is simply not taken back), ~45% at 400, ~75% at
 * 1000 and ~95% at the top — one continuous curve instead of a two-step gate.
 */
export function recaptureChance(elo: number): number {
  return 0.18 + 0.79 * (1 - Math.exp(-3.8 * skillOf(elo)));
}

/**
 * Effective search depth. Deliberately steep near the bottom of the range: a
 * 1100 USCF club player looks 4-5 plies ahead, not 7-8. The time-control offset
 * is applied before the two-ply floor.
 */
export function humanSearchDepth(elo: number, depthOffset = 0): number {
  const s = skillOf(elo);
  return Math.max(2, Math.round(2 + Math.pow(s, 1.3) * 12) + depthOffset);
}

/** The continuous calibration for a target rating. */
export function humanCalibration(elo: number): HumanCalibration {
  const target = clampElo(elo);
  const quality = qualityShares(target);

  return {
    elo: target,
    skill: skillOf(target),
    quality,
    errorRate: quality.blunder + quality.mistake + quality.inaccuracy,
    depth: humanSearchDepth(target),
    temperature: Math.max(0.2, 1.35 * Math.exp(-1.7 * skillOf(target))),
  };
}

/** Splits one quality roll into a bucket; the six probabilities sum to 1. */
export function pickCategory(roll: number, quality: QualityShares): Bucket {
  let cursor = 0;
  for (const key of BUCKET_ORDER) {
    cursor += quality[key];
    if (roll < cursor) return key;
  }
  return 'blunder';
}

/** Win-drop -> quality label, the six-tier model both play and review share. */
export function bucketFor(winDrop: number): Bucket {
  if (winDrop >= QUALITY_BANDS.blunder) return 'blunder';
  if (winDrop >= QUALITY_BANDS.inaccuracy) return 'mistake';
  if (winDrop >= QUALITY_BANDS.good) return 'inaccuracy';
  if (winDrop >= QUALITY_BANDS.excellent) return 'good';
  if (winDrop >= QUALITY_BANDS.best) return 'excellent';
  return 'best';
}

/** The milder buckets an empty roll falls through to. */
const BUCKET_CHAIN: Record<Bucket, readonly Bucket[]> = {
  blunder: ['blunder', 'mistake', 'inaccuracy', 'good', 'excellent', 'best'],
  mistake: ['mistake', 'inaccuracy', 'good', 'excellent', 'best'],
  inaccuracy: ['inaccuracy', 'good', 'excellent', 'best'],
  good: ['good', 'excellent', 'best'],
  excellent: ['excellent', 'best'],
  best: ['best'],
};

/* --------------------------------------------------------------------------
   Game phase, time control and clock
   -------------------------------------------------------------------------- */

export type GamePhase = 'opening' | 'middlegame' | 'endgame';
export type TimeControlCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';

export function phaseForMoveNumber(moveNumber: number): GamePhase {
  if (moveNumber <= 8) return 'opening';
  if (moveNumber <= 32) return 'middlegame';
  return 'endgame';
}

export function phaseMultiplier(phase: GamePhase, elo = OPENING_ELO_SPLIT): number {
  /* Opening moves are cleaner than middlegame moves, but a sub-1400 player still
     errs there: 0.70 keeps the first eight moves from looking like Stockfish. */
  if (phase === 'opening') return clampElo(elo) < OPENING_ELO_SPLIT ? 0.7 : 0.4;
  if (phase === 'middlegame') return 1.2;
  return 0.95;
}

/** Time-control band from the game's base time per side. */
export function timeControlCategory(initialMs: number | null | undefined): TimeControlCategory {
  const minutes = (initialMs ?? 0) / 60_000;
  if (minutes <= 0) return 'classical';
  if (minutes < 3) return 'bullet';
  if (minutes < 10) return 'blitz';
  if (minutes < 30) return 'rapid';
  return 'classical';
}

export interface TimeControlScaling {
  category: TimeControlCategory;
  /** Multiplies the three error buckets. */
  tcMult: number;
  /** Added to the rating's search depth. */
  depthOffset: number;
  /** Multiplies the human thinking time. */
  timeScale: number;
}

export function timeControlScaling(category: TimeControlCategory): TimeControlScaling {
  switch (category) {
    case 'bullet':
      return { category, tcMult: 1.8, depthOffset: -3, timeScale: 0.12 };
    case 'blitz':
      return { category, tcMult: 1.45, depthOffset: -2, timeScale: 0.25 };
    case 'rapid':
      return { category, tcMult: 1.18, depthOffset: -1, timeScale: 0.55 };
    default:
      return { category, tcMult: 1, depthOffset: 0, timeScale: 1 };
  }
}

/* --------------------------------------------------------------------------
   Planning: depth, error budget, thinking time
   -------------------------------------------------------------------------- */

export type PositionKind = 'forced' | 'recapture' | 'quiet' | 'sharp';

export interface LastCapture {
  to: string;
  captured?: string | null;
}

export interface HumanSearchInput {
  fen: string;
  elo: number;
  /** Full move number; defaults to the FEN's counter. */
  moveNumber?: number;
  timeControlCategory?: TimeControlCategory;
  /** Clock left for the bot, ms; null/undefined in an untimed game. */
  remainingTimeMs?: number | null;
  incrementMs?: number;
  lastMove?: LastCapture | null;
  random?: () => number;
}

export interface HumanSearchPlan {
  calibration: HumanCalibration;
  phase: GamePhase;
  timeControl: TimeControlScaling;
  timeTrouble: boolean;
  positionKind: PositionKind;
  /** Depth handed to the engine. */
  depth: number;
  /** Wall-clock budget for the search; the engine really uses this. */
  thinkTimeMs: number;
  /** The six probabilities after phase, time control and time trouble. */
  quality: QualityShares;
  /** `quality.blunder + quality.mistake + quality.inaccuracy`. */
  errorRate: number;
}

function uciOf(move: { from: string; to: string; promotion?: string }): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

function randomBetween(min: number, max: number, random: () => number): number {
  return min + random() * (max - min);
}

function fullMoveNumber(fen: string): number {
  const value = Number(fen.split(' ')[5]);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** Board-only classification, before any search runs. */
export function positionKind(fen: string, lastMove?: LastCapture | null): PositionKind {
  const legal = new Chess(fen).moves({ verbose: true });
  if (legal.length <= 1) return 'forced';

  if (lastMove?.captured) {
    const recaptures = legal.filter((move) => move.to === lastMove.to && Boolean(move.captured));
    if (recaptures.length > 0) return 'recapture';
  }

  const forcing = legal.filter((move) => Boolean(move.captured) || move.san.includes('+'));
  return forcing.length >= 2 ? 'sharp' : 'quiet';
}

function thinkTimeFor(
  kind: PositionKind,
  timeScale: number,
  timeTrouble: boolean,
  remainingTimeMs: number | null | undefined,
  random: () => number,
): number {
  if (timeTrouble) return Math.round(randomBetween(250, 850, random));

  if (kind === 'forced' || kind === 'recapture') {
    return Math.round(Math.max(250, randomBetween(350, 850, random) * timeScale));
  }

  if (kind === 'sharp') {
    const base = randomBetween(4500, 10500, random) * timeScale;
    const capped =
      remainingTimeMs && remainingTimeMs > 0 ? Math.min(base, remainingTimeMs * 0.12) : base;
    return Math.round(capped);
  }

  const base = randomBetween(1500, 3800, random);
  /* One turn in seven takes a visibly longer think than the rest. */
  const longThink = random() < 0.15 ? base * 1.5 : base;
  return Math.round(Math.max(400, longThink * timeScale));
}

/** Everything the bot decides before touching the engine. */
export function planHumanSearch(input: HumanSearchInput): HumanSearchPlan {
  const random = input.random ?? Math.random;
  const calibration = humanCalibration(input.elo);
  const moveNumber = input.moveNumber ?? fullMoveNumber(input.fen);
  const phase = phaseForMoveNumber(moveNumber);
  const phaseMult = phaseMultiplier(phase, input.elo);
  const category = input.timeControlCategory ?? 'classical';
  const timeControl = timeControlScaling(category);
  const incrementMs = Math.max(0, input.incrementMs ?? 0);
  const remaining = input.remainingTimeMs ?? null;

  const timeTrouble =
    remaining !== null && remaining < LOW_CLOCK_MS && incrementMs < LOW_INCREMENT_MS;

  const kind = positionKind(input.fen, input.lastMove);
  const thinkTimeMs = thinkTimeFor(kind, timeControl.timeScale, timeTrouble, remaining, random);

  const scaledDepth = humanSearchDepth(input.elo, timeControl.depthOffset);
  const depth = timeTrouble ? Math.min(scaledDepth, TROUBLE_DEPTH_CAP) : scaledDepth;

  /* Phase, time control and time trouble make the same player worse: they scale
     the three error buckets and hand the displaced mass to good/excellent/best. */
  const quality = scaleErrors(
    calibration.quality,
    phaseMult * timeControl.tcMult * (timeTrouble ? 1.4 : 1),
  );

  return {
    calibration,
    phase,
    timeControl,
    timeTrouble,
    positionKind: kind,
    depth,
    thinkTimeMs,
    quality,
    errorRate: quality.blunder + quality.mistake + quality.inaccuracy,
  };
}

const LOW_CLOCK_MS = 30_000;
const LOW_INCREMENT_MS = 5_000;
const TROUBLE_DEPTH_CAP = 3;

/* --------------------------------------------------------------------------
   Move intent
   -------------------------------------------------------------------------- */

const HEAVY_PIECES = new Set(['q', 'r']);

export interface MoveIntent {
  /** The move takes a pawn or piece. */
  capture: boolean;
  /** The move gives check. */
  check: boolean;
  /** The move attacks a queen or rook that was not attacked before. */
  attacksHeavy: boolean;
  /** A pawn steps closer to the enemy king. */
  pawnTowardKing: boolean;
}

function heavySquaresOf(game: Chess, color: 'w' | 'b'): Set<string> {
  const squares = new Set<string>();
  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece || piece.color !== color) continue;
      if (!HEAVY_PIECES.has(piece.type)) continue;
      squares.add(piece.square);
    }
  }
  return squares;
}

function attackedSquares(
  game: Chess,
  color: 'w' | 'b',
  targets: ReadonlySet<string>,
): Set<string> {
  const hit = new Set<string>();
  for (const square of targets) {
    if (game.attackers(square as Square, color).length > 0) hit.add(square);
  }
  return hit;
}

function kingSquareOf(game: Chess, color: 'w' | 'b'): string | null {
  for (const row of game.board()) {
    for (const piece of row) {
      if (piece && piece.color === color && piece.type === 'k') return piece.square;
    }
  }
  return null;
}

function squareDistance(from: string, to: string): number {
  return Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) + Math.abs(Number(from[1]) - Number(to[1]));
}

/**
 * What a move is *trying* to do, read off the board.
 *
 * This is the filter that keeps a mid-rated bot's errors plausible: it may only
 * err while grabbing material, checking, attacking a heavy piece or pushing a
 * pawn at the king. Quiet moves that happen to lose a piece are not offered.
 */
export function moveIntent(fen: string, uci: string): MoveIntent | null {
  const game = new Chess(fen);
  const mover = game.turn();
  const opponent = mover === 'w' ? 'b' : 'w';
  const heavy = heavySquaresOf(game, opponent);
  const before = attackedSquares(game, mover, heavy);
  const kingBefore = kingSquareOf(game, opponent);

  let move: ReturnType<Chess['move']> | null;
  try {
    move = game.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci.length > 4 ? (uci.slice(4, 5) as 'q' | 'r' | 'b' | 'n') : undefined,
    });
  } catch {
    return null;
  }
  if (!move) return null;

  const after = attackedSquares(game, mover, heavy);
  let attacksHeavy = false;
  for (const square of after) {
    if (!before.has(square)) {
      attacksHeavy = true;
      break;
    }
  }

  const kingAfter = kingSquareOf(game, opponent) ?? kingBefore;
  /* A forward attack is a pawn push that reaches the enemy half and closes on
     the king, not any pawn move that happens to reduce the distance: e2e4 is
     development, f4/g4/g5 is an attack. */
  const destinationRank = Number(move.to[1]);
  const enemyHalf = mover === 'w' ? destinationRank >= 5 : destinationRank <= 4;
  const pawnTowardKing =
    move.piece === 'p' &&
    enemyHalf &&
    kingBefore !== null &&
    kingAfter !== null &&
    squareDistance(move.to, kingAfter) < squareDistance(move.from, kingBefore);

  return {
    capture: Boolean(move.captured),
    check: game.inCheck(),
    attacksHeavy,
    pawnTowardKing,
  };
}

/**
 * True when the error is one a person could actually commit: a capture that
 * fails tactically, a check or a forward attack, or a pawn pushed at the king.
 */
export function hasHumanIntent(intent: MoveIntent, winDrop: number): boolean {
  if (intent.capture && winDrop >= 18) return true;
  return intent.check || intent.attacksHeavy || intent.pawnTowardKing;
}

/* --------------------------------------------------------------------------
   Selection
   -------------------------------------------------------------------------- */

export type HumanMoveKind = 'forced' | 'recapture' | 'probe' | Bucket;

export interface HumanCandidate {
  uci: string;
  /** White's point of view, as the engine reports it. */
  scoreCp: number;
  mate?: number | null;
  /** White-POV reference score, when the caller already has one. */
  referenceScoreCp?: number;
}

export interface HumanMoveInput extends HumanSearchInput {
  candidates: readonly HumanCandidate[];
  plan?: HumanSearchPlan;
  /**
   * White-POV reference scores by UCI move (the depth-9 second pass). Severity
   * — `cpLoss`, `winDrop`, bucket — is judged on these, while the shallow score
   * still decides what the move *looks* like.
   */
  reference?: ReadonlyMap<string, number>;
  /**
   * UCIs from the shallow (`depth 2-3`) search, best first. A mid-rated bot may
   * only blunder on one of the first six of these; a 1500+ bot on the first four.
   */
  shallowRank?: readonly string[];
  /** Allows the selector to ask the caller for an off-list beginner probe. */
  allowProbe?: boolean;
  /** A bucket the caller already rolled, so a retry does not re-roll. */
  forcedBucket?: Bucket;
}

export interface WeightedMove {
  uci: string;
  weight: number;
  cpLoss: number;
  winDrop: number;
}

export interface HumanMoveChoice {
  uci: string | null;
  kind: HumanMoveKind;
  plan: HumanSearchPlan;
  cpLoss: number;
  winDrop: number;
  weights: readonly WeightedMove[];
  /** Set when `kind` is `probe`: which bucket the caller must fill off-list. */
  probeTarget?: 'mistake' | 'blunder';
}

/** Win probability (0-100, bot's point of view) from a centipawn score. */
export function winProbability(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function applyUci(fen: string, uci: string): Chess | null {
  const game = new Chess(fen);
  try {
    const move = game.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci.length > 4 ? (uci.slice(4, 5) as 'q' | 'r' | 'b' | 'n') : undefined,
    });
    return move ? game : null;
  } catch {
    return null;
  }
}

/** True when the move hands the opponent a mate in one. */
export function allowsMateInOne(fen: string, uci: string): boolean {
  const after = applyUci(fen, uci);
  if (!after || after.isGameOver()) return false;

  for (const reply of after.moves({ verbose: true })) {
    const next = new Chess(after.fen());
    try {
      next.move({ from: reply.from, to: reply.to, promotion: reply.promotion });
    } catch {
      continue;
    }
    if (next.isCheckmate()) return true;
  }
  return false;
}

interface WeightedEntry {
  uci: string;
  cpLoss: number;
  winDrop: number;
  /** Loss the human model perceives; falls back to the reference loss. */
  shallowLoss?: number;
}

/** Softmax over candidate losses: exp(-loss / (temperature * 120)). */
function softmaxWeights(entries: readonly WeightedEntry[], temperature: number): WeightedMove[] {
  if (entries.length === 0) return [];
  const scale = Math.max(0.05, temperature) * 120;
  const raw = entries.map((entry) => ({
    ...entry,
    value: Math.exp(-(entry.shallowLoss ?? entry.cpLoss) / scale),
  }));
  const total = raw.reduce((sum, entry) => sum + entry.value, 0);
  if (total <= 0) {
    return raw.map((entry, index) => ({ ...entry, weight: index === 0 ? 1 : 0 }));
  }
  return raw.map((entry) => ({
    uci: entry.uci,
    cpLoss: entry.cpLoss,
    winDrop: entry.winDrop,
    weight: entry.value / total,
  }));
}

/**
 * Multiplier on the softmax weight of the #1 engine move: 0.36 at the floor,
 * 0.67 at 1100, and no damping at all from 1500 up.
 */
export function topLineDamping(elo: number): number {
  const target = clampElo(elo);
  if (target >= TOP_LINE_DRIFT_ELO) return 1;
  const base = 0.35 + 0.65 * (target / TOP_LINE_DRIFT_ELO);
  if (target >= POSITIONAL_DRIFT_ELO) return base;
  const gap = 1 - target / POSITIONAL_DRIFT_ELO;
  return base * (1 - DRIFT_DAMPING_LOW * (gap / (gap + 0.1)));
}

/** Temperature boost for an error-bucket pick at this rating. */
export function errorTemperatureBoost(elo: number): number {
  return clampElo(elo) < POSITIONAL_DRIFT_ELO
    ? ERROR_TEMPERATURE_BOOST_LOW
    : ERROR_TEMPERATURE_BOOST;
}

/** Damps the top line and re-normalizes the weights so they still sum to 1. */
function dampTopLine(weights: readonly WeightedMove[], elo: number): WeightedMove[] {
  const factor = topLineDamping(elo);
  const copy = weights.map((entry) => ({ ...entry }));
  if (factor >= 1 || copy.length < 2) return copy;

  copy[0] = { ...copy[0], weight: copy[0].weight * factor };
  const total = copy.reduce((sum, entry) => sum + entry.weight, 0);
  if (!(total > 0)) return weights.map((entry) => ({ ...entry }));
  return copy.map((entry) => ({ ...entry, weight: entry.weight / total }));
}

function pick(weights: readonly WeightedMove[], random: () => number): WeightedMove | null {
  if (weights.length === 0) return null;
  let roll = random();
  for (const entry of weights) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return weights[weights.length - 1];
}

/**
 * Chooses the bot's move from the engine's MultiPV list.
 *
 * One roll against the six-bucket quality distribution decides this turn's
 * label. The candidates carrying that label are then filtered by *intent* —
 * which is what stops a 900 hanging a knight in the corner nobody looked at —
 * and the pick inside the band is softmax-weighted. An empty band falls through
 * to the milder ones, and a beginner may ask the caller to probe off-list moves
 * instead.
 */
export function selectHumanBotMove(input: HumanMoveInput): HumanMoveChoice {
  const random = input.random ?? Math.random;
  const plan = input.plan ?? planHumanSearch(input);
  const game = new Chess(input.fen);
  const legal = game.moves({ verbose: true });
  const sign = game.turn() === 'w' ? 1 : -1;
  const temperature = plan.calibration.temperature;
  const elo = plan.calibration.elo;

  const finish = (
    uci: string | null,
    kind: HumanMoveKind,
    cpLoss: number,
    winDrop: number,
    weights: readonly WeightedMove[],
  ): HumanMoveChoice => ({ uci, kind, plan, cpLoss, winDrop, weights });

  /* 1. Forced move. */
  if (legal.length <= 1) {
    return finish(legal.length === 1 ? uciOf(legal[0]) : null, 'forced', 0, 0, []);
  }

  const candidates = input.candidates
    .filter((candidate) => typeof candidate.uci === 'string' && Number.isFinite(candidate.scoreCp))
    .map((candidate) => {
      /* Truth comes from the reference pass when the caller ran one; the
         shallow score only says how attractive the move looks. */
      const referenceCp =
        input.reference?.get(candidate.uci) ?? candidate.referenceScoreCp ?? candidate.scoreCp;
      return {
        uci: candidate.uci,
        botPov: sign * candidate.scoreCp,
        refBotPov: sign * referenceCp,
        mate: candidate.mate === undefined || candidate.mate === null ? null : sign * candidate.mate,
      };
    })
    .sort((a, b) => b.botPov - a.botPov);

  if (candidates.length === 0) return finish(null, 'forced', 0, 0, []);

  const best = candidates[0];
  const bestRef = candidates.reduce((a, b) => (b.refBotPov > a.refBotPov ? b : a));
  const bestRefWin = winProbability(bestRef.refBotPov);
  const entries = candidates.map((candidate) => ({
    uci: candidate.uci,
    cpLoss: Math.max(0, Math.round(bestRef.refBotPov - candidate.refBotPov)),
    shallowLoss: Math.max(0, Math.round(best.botPov - candidate.botPov)),
    winDrop: Math.max(0, Math.round((bestRefWin - winProbability(candidate.refBotPov)) * 10) / 10),
    mated: candidate.mate !== null && candidate.mate < 0,
    shallowRank: (input.shallowRank ?? []).indexOf(candidate.uci),
  }));
  const playable = entries.filter((entry) => !entry.mated);
  const pool = playable.length > 0 ? playable : entries;

  /* 2. Obvious recapture, at the rating's own rate. */
  const lastCapture = input.lastMove;
  if (lastCapture?.captured && bestRef.uci.slice(2, 4) === lastCapture.to) {
    if (random() < recaptureChance(elo)) {
      return finish(bestRef.uci, 'recapture', 0, 0, [
        { uci: bestRef.uci, weight: 1, cpLoss: 0, winDrop: 0 },
      ]);
    }
  }

  const finishedAt = (
    kind: HumanMoveKind,
    from: readonly (typeof entries)[number][],
    boost = 1,
  ) => {
    const weights = softmaxWeights(from, temperature * boost);
    const chosen = pick(weights, random) ?? weights[0];
    return finish(chosen.uci, kind, chosen.cpLoss, chosen.winDrop, weights);
  };

  const safeForElo = (entry: (typeof entries)[number]) =>
    elo < SELF_MATE_GUARD_ELO || !allowsMateInOne(input.fen, entry.uci);
  const guarded = pool.filter(safeForElo);
  const usable = guarded.length > 0 ? guarded : pool;

  /* At 600+ an error has to look intended. Below 600 anything goes: that is
     beginner blindness — dropping a piece for no reason, stepping into an
     attacked square, forgetting the recapture. */
  const requiresIntent = elo >= TUNNEL_VISION_ELO;
  const deepOnly = elo >= DEEP_SLIP_ELO;
  const intents = new Map<string, MoveIntent | null>();

  const intentFor = (uci: string): MoveIntent | null => {
    if (!intents.has(uci)) intents.set(uci, moveIntent(input.fen, uci));
    return intents.get(uci) ?? null;
  };

  const errorAllowed = (entry: (typeof entries)[number]): boolean => {
    if (!requiresIntent) return true;
    const rank = entry.shallowRank;

    if (deepOnly) {
      /* A strong player's slip is a line they calculated and got wrong: it has
         to be one of the first four shallow choices and fail deep. */
      return rank >= 0 && rank < SHALLOW_TOP_RANKS_DEEP;
    }

    /* Club level: either the shallow search liked it enough to be a top-six
       choice, or the move has an obvious human point. */
    if (rank >= 0 && rank < SHALLOW_TOP_RANKS_TUNNEL) return true;
    const intent = intentFor(entry.uci);
    return Boolean(intent && hasHumanIntent(intent, entry.winDrop));
  };

  /* 3. One roll against the six-bucket distribution. */
  const category: Bucket = input.forcedBucket ?? pickCategory(random(), plan.quality);
  const chain = BUCKET_CHAIN[category];

  for (const step of chain) {
    const matches = usable.filter(
      (entry) =>
        bucketFor(entry.winDrop) === step &&
        (step === 'good' || step === 'excellent' || step === 'best'
          ? true
          : errorAllowed(entry)),
    );
    if (matches.length > 0) {
      const boost =
        step === 'good' || step === 'excellent' || step === 'best'
          ? elo < POSITIONAL_DRIFT_ELO
            ? SOLID_TEMPERATURE_BOOST_LOW
            : elo < SOLID_TEMPERATURE_ELO
              ? SOLID_TEMPERATURE_BOOST
              : 1
          : errorTemperatureBoost(elo);
      if (step === 'good' || step === 'excellent' || step === 'best') {
        const weights = dampTopLine(
          softmaxWeights(matches, temperature * boost),
          elo,
        );
        const chosen = pick(weights, random) ?? weights[0];
        return finish(chosen.uci, step, chosen.cpLoss, chosen.winDrop, weights);
      }
      return finishedAt(step, matches, boost);
    }

    /* A beginner who should err this badly really does hang something, so ask
       the caller for an off-list move instead of settling for a milder error. */
    if ((step === 'blunder' || step === 'mistake') && input.allowProbe && !requiresIntent) {
      return { ...finish(null, 'probe', 0, 0, []), probeTarget: step };
    }
  }

  /* Nothing in the chain fits the board: take the candidate whose reference win
     drop sits closest to the bucket the roll asked for. */
  const centre = BUCKET_CENTRES[category];
  const closest = usable.reduce((a, b) =>
    Math.abs(b.winDrop - centre) < Math.abs(a.winDrop - centre) ? b : a,
  );
  return finishedAt(bucketFor(closest.winDrop), [closest]);
}

/** The opponent's last move when it was a capture. */
export function lastCaptureOf(game: Chess): LastCapture | null {
  const history = game.history({ verbose: true });
  const last = history[history.length - 1];
  if (!last?.captured) return null;
  return { to: last.to, captured: last.captured };
}

/* --------------------------------------------------------------------------
   Second pass: reference truth and the beginner probe
   -------------------------------------------------------------------------- */

/** The slice of the engine controller these helpers need. */
export interface ReferenceEngine {
  evaluatePosition: (
    fen: string,
    depth?: number,
    multiPv?: number,
  ) => Promise<{ scoreCp: number }>;
}

/**
 * Pass 2: re-scores every candidate move at `REFERENCE_DEPTH`.
 *
 * The shallow search that generated the list also scored it, so its ten lines
 * all look nearly equal and the bands stay empty. Evaluating the resulting
 * positions at a fixed deeper depth restores the real spread. Returns White-POV
 * scores by UCI move, matching `EngineCandidate.scoreCp`.
 */
export async function referenceCandidateScores(
  engine: ReferenceEngine,
  fen: string,
  candidates: readonly HumanCandidate[],
  depth = REFERENCE_DEPTH,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  for (const candidate of candidates.slice(0, HUMAN_MULTI_PV)) {
    const child = applyUci(fen, candidate.uci);
    if (!child) continue;
    const evaluation = await engine.evaluatePosition(child.fen(), depth, 1);
    scores.set(candidate.uci, evaluation.scoreCp);
  }
  return scores;
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/**
 * Moves a beginner might actually play while missing the point.
 *
 * In order: a capture that loses material, a piece stepped onto an attacked
 * square, a pawn push, then any natural-looking quiet move (checks first, then
 * central squares). Only used below 600 USCF, where the error is not a misread
 * idea but a piece left hanging.
 *
 * A move that allows mate in one is never offered: that is a bug, not a blunder.
 */
export function probeMoveCandidates(
  fen: string,
  exclude: readonly string[],
  count = 6,
): string[] {
  const game = new Chess(fen);
  const mover = game.turn();
  const opponent = mover === 'w' ? 'b' : 'w';
  const skip = new Set(exclude);
  const legal = game.moves({ verbose: true }).filter((move) => !skip.has(uciOf(move)));

  const exposed = (move: (typeof legal)[number]) => {
    const attackers = game.attackers(move.to as Square, opponent).length;
    const defenders = game.attackers(move.to as Square, mover).length;
    return attackers > defenders;
  };
  const weight = (move: (typeof legal)[number]) =>
    (PIECE_VALUE[move.piece] ?? 0) + (move.captured ? (PIECE_VALUE[move.captured] ?? 0) : 0);
  const centreDistance = (square: string) =>
    Math.abs(square.charCodeAt(0) - 97 - 3.5) + Math.abs(Number(square[1]) - 1 - 3.5);
  const byWeight = (a: (typeof legal)[number], b: (typeof legal)[number]) => weight(b) - weight(a);
  const byNaturalness = (a: (typeof legal)[number], b: (typeof legal)[number]) =>
    Number(b.san.includes('+')) - Number(a.san.includes('+')) ||
    centreDistance(a.to) - centreDistance(b.to) ||
    weight(b) - weight(a);

  const groups = [
    legal.filter((move) => Boolean(move.captured) && exposed(move)).sort(byWeight),
    legal.filter((move) => !move.captured && exposed(move)).sort(byWeight),
    legal.filter((move) => !move.captured && move.piece === 'p').sort(byNaturalness),
    legal.filter((move) => !move.captured && !exposed(move)).sort(byNaturalness),
  ];

  /* Round-robin across the groups: taking one group at a time lets six pawn
     pushes fill the list and hides the piece move that actually loses. */
  const cursors = groups.map(() => 0);
  const picked: string[] = [];
  let progressed = true;
  while (picked.length < count && progressed) {
    progressed = false;
    for (let index = 0; index < groups.length && picked.length < count; index += 1) {
      const group = groups[index];
      while (cursors[index] < group.length) {
        const uci = uciOf(group[cursors[index]]);
        cursors[index] += 1;
        if (picked.includes(uci)) continue;
        if (allowsMateInOne(fen, uci)) continue;
        picked.push(uci);
        progressed = true;
        break;
      }
    }
  }
  return picked;
}

/**
 * Spreads a ranked pool across its whole length.
 *
 * Kept for the beginner probe only: below 600 USCF the hanging move really does
 * sit in the tail of a wide search, and sampling evenly keeps ranks 21-32 in
 * play. From 600 up this is never used — see `probeErrorMove`.
 */
function spreadPool(pool: readonly string[], take: number): string[] {
  if (pool.length <= take) return [...pool];
  if (take <= 1) return pool.length > 0 ? [pool[0]] : [];
  const picked: string[] = [];
  for (let index = 0; index < take; index += 1) {
    picked.push(pool[Math.round((index * (pool.length - 1)) / (take - 1))]);
  }
  return [...new Set(picked)];
}

export interface ProbeErrorResult {
  uci: string;
  cpLoss: number;
  winDrop: number;
}

/**
 * Scores a few off-list moves and returns the first whose reference win drop
 * lands in the requested window.
 *
 * From 600 USCF the pool is taken in rank order, head first: a rated player's
 * error is an idea they liked, so the plausible moves are tried before the
 * tail. Only below 600 is the pool spread across ranks 21-32, where a beginner's
 * unprovoked piece drop lives.
 */
export async function probeErrorMove(
  engine: ReferenceEngine,
  fen: string,
  options: {
    referenceScores: ReadonlyMap<string, number>;
    target: 'mistake' | 'blunder';
    elo?: number;
    /** Engine-ranked "plausible but worse" moves, tried before the heuristics. */
    pool?: readonly string[];
    exclude?: readonly string[];
    depth?: number;
    count?: number;
  },
): Promise<ProbeErrorResult | null> {
  const scores = [...options.referenceScores.values()];
  if (scores.length === 0) return null;

  const sign = new Chess(fen).turn() === 'w' ? 1 : -1;
  const bestBotPov = Math.max(...scores.map((cp) => sign * cp));
  const bestWin = winProbability(bestBotPov);
  const window = PROBE_WINDOWS[options.target];
  const beginner = (options.elo ?? ELO_MIN) < BEGINNER_ELO;

  const exclude = options.exclude ?? [...options.referenceScores.keys()];
  const known = new Set(exclude);
  const pool = (options.pool ?? []).filter((uci) => !known.has(uci));
  const limit = options.count ?? (pool.length > 0 ? 10 : 6);
  const ranked = beginner ? spreadPool(pool, limit) : pool.slice(0, limit);
  const moves = [...ranked, ...probeMoveCandidates(fen, [...exclude, ...pool], 6)].slice(
    0,
    limit + 6,
  );

  let worst: ProbeErrorResult | null = null;
  for (const uci of moves) {
    const child = applyUci(fen, uci);
    if (!child) continue;
    const evaluation = await engine.evaluatePosition(
      child.fen(),
      options.depth ?? PROBE_DEPTH,
      1,
    );
    const botPov = sign * evaluation.scoreCp;
    const winDrop = Math.max(0, Math.round((bestWin - winProbability(botPov)) * 10) / 10);
    const result = { uci, cpLoss: Math.max(0, Math.round(bestBotPov - botPov)), winDrop };
    if (winDrop >= window.min && winDrop <= window.max) return result;
    if (!worst || result.winDrop > worst.winDrop) worst = result;
  }

  return worst && worst.winDrop >= PROBE_WINDOWS.mistake.min ? worst : null;
}
