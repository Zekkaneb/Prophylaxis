import { Chess, type Square } from 'chess.js';

/**
 * USCF rating classes and the 13-quality move model.
 *
 * This is the class layer the bots play at: a rating belongs to a USCF class,
 * the class owns a search depth, an opening-book depth and a probability
 * matrix over the 13 move qualities, and a classifier turns a scored move into
 * the quality it actually was. Strength is not a flat depth plus a slip band
 * any more — it is one distribution per class, with deterministic overrides
 * (`⇒` forced, `▣` book, `○` clutch) and guards that make a strong class
 * incapable of handing over a piece.
 *
 * The module is deliberately free of React, Dexie and the engine controller:
 * callers hand in scored candidates and get a move and a quality back, which
 * keeps the whole model testable in Node.
 */

/* --------------------------------------------------------------------------
   The 13 qualities
   -------------------------------------------------------------------------- */

export type MoveQuality =
  | 'clutch'
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'forced'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'
  | 'throw';

/** Display order: the best a move can be first, the worst last. */
export const MOVE_QUALITY_ORDER: readonly MoveQuality[] = [
  'clutch',
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'forced',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
  'throw',
];

export interface MoveQualityMeta {
  label: string;
  /** The glyph the review and the traces use. */
  symbol: string;
  /** One line for the UI and the docs. */
  description: string;
  /** True for the qualities that lose win probability. */
  error: boolean;
}

export const MOVE_QUALITY_META: Record<MoveQuality, MoveQualityMeta> = {
  clutch: {
    label: 'Clutch',
    symbol: '○',
    description: 'A best or great move found under severe clock pressure or in a lost position.',
    error: false,
  },
  brilliant: {
    label: 'Brilliant',
    symbol: '!!',
    description: 'The best move gives up material on purpose and the position stays winning.',
    error: false,
  },
  great: {
    label: 'Great',
    symbol: '!',
    description: 'The only move that keeps the position: every alternative loses 10+ win percent.',
    error: false,
  },
  best: {
    label: 'Best',
    symbol: '★',
    description: "The engine's first line, losing under 0.5 win percent.",
    error: false,
  },
  excellent: {
    label: 'Excellent',
    symbol: '⦿',
    description: 'Loses under 2 win percent: practically as good as the best move.',
    error: false,
  },
  good: {
    label: 'Good',
    symbol: '✓',
    description: 'Loses 2-5 win percent: sound, but not the point of the position.',
    error: false,
  },
  forced: {
    label: 'Forced',
    symbol: '⇒',
    description: 'The only legal move: nothing was chosen.',
    error: false,
  },
  book: {
    label: 'Book',
    symbol: '▣',
    description: 'Prepared theory, inside the class’s book-ply limit.',
    error: false,
  },
  inaccuracy: {
    label: 'Inaccuracy',
    symbol: '?!',
    description: 'Loses 5-10 win percent: the idea is loose.',
    error: true,
  },
  mistake: {
    label: 'Mistake',
    symbol: '?',
    description: 'Loses 10-20 win percent: a real error, but the game goes on.',
    error: true,
  },
  miss: {
    label: 'Miss',
    symbol: '×',
    description: 'A 10-35 point drop from a winning position: the win was there and went.',
    error: true,
  },
  blunder: {
    label: 'Blunder',
    symbol: '??',
    description: 'Loses 20-35 win percent: the game turns on it.',
    error: true,
  },
  throw: {
    label: 'Throw',
    symbol: '✗',
    description: 'Loses more than 35 win percent: a piece or the game, in one move.',
    error: true,
  },
};

/* --------------------------------------------------------------------------
   USCF classes
   -------------------------------------------------------------------------- */

export type UsfcClassId = 'E' | 'D' | 'C' | 'B' | 'A' | 'expert';

export interface UsfcClassTier {
  id: UsfcClassId;
  label: string;
  /** Inclusive USCF floor. */
  min: number;
  /** Inclusive USCF ceiling; `null` for the open top class. */
  max: number | null;
  /** Search depth the class plays at, before any time-control offset. */
  depth: number;
  /** Deepest ply of prepared theory the class may remember. */
  bookPlies: number;
}

/**
 * The ladder, exactly as specified.
 *
 * Class E 1000-1199 searches three plies and remembers three book plies; each
 * class above it adds depth and book, up to Expert+ at 2000+ with eleven plies
 * and fourteen book plies. Below 1000 the beginner model keeps its own depth
 * curve and node caps; the classes start where a player can be said to have a
 * class at all.
 */
export const USCF_CLASSES: readonly UsfcClassTier[] = [
  { id: 'E', label: 'Class E', min: 1000, max: 1199, depth: 3, bookPlies: 3 },
  { id: 'D', label: 'Class D', min: 1200, max: 1399, depth: 4, bookPlies: 5 },
  { id: 'C', label: 'Class C', min: 1400, max: 1599, depth: 5, bookPlies: 7 },
  { id: 'B', label: 'Class B', min: 1600, max: 1799, depth: 7, bookPlies: 9 },
  { id: 'A', label: 'Class A', min: 1800, max: 1999, depth: 9, bookPlies: 11 },
  { id: 'expert', label: 'Expert+', min: 2000, max: null, depth: 11, bookPlies: 14 },
];

/** The class a rating plays in; below 1000 it is Class E by definition. */
export function uscfClassFor(elo: number): UsfcClassTier {
  const target = Number.isFinite(elo) ? Math.max(0, elo) : 1500;
  for (const tier of USCF_CLASSES) {
    if (target < tier.min) continue;
    if (tier.max === null || target <= tier.max) return tier;
  }
  return USCF_CLASSES[0];
}

/** Depth bonus for the very top of the open class: 2000→11, 2400→12, 2600→13. */
export function expertDepthBonus(elo: number): number {
  if (elo >= 2600) return 2;
  if (elo >= 2400) return 1;
  return 0;
}

/**
 * The class's search depth, with the time-control offset applied.
 *
 * Expert+ never drops below the eleven plies the specification promises, even
 * in bullet: a strong bot that cannot see the recapture is not an Expert bot.
 * Every other class may lose the offset's plies down to a two-ply floor.
 * Returns `null` below 1000, where the beginner depth curve is still in charge.
 */
export function classSearchDepth(elo: number, depthOffset = 0): number | null {
  if (!Number.isFinite(elo) || elo < USCF_CLASSES[0].min) return null;
  const tier = uscfClassFor(elo);
  const nominal = tier.depth + expertDepthBonus(elo);
  const depth = nominal + (Number.isFinite(depthOffset) ? depthOffset : 0);
  if (tier.id === 'expert') return Math.max(tier.depth, depth);
  return Math.max(2, depth);
}

/** Deepest ply of theory a rating remembers: 400→4, Class E→3 … Expert+→14. */
export function classBookPlies(elo: number): number {
  if (elo < USCF_CLASSES[0].min) return 4;
  return uscfClassFor(elo).bookPlies;
}

/** What the class refuses outright, before any probability roll. */
export interface ClassGuards {
  /** Take an offered recapture back deterministically (Class B and above). */
  recapture: boolean;
  /** Never leave a piece hanging for no reason (Class B and above). */
  vetoUnforcedDrops: boolean;
  /** Blunders and throws are not in this class's distribution (Class A+). */
  forbidBlunders: boolean;
}

export function classGuardsFor(tier: UsfcClassTier): ClassGuards {
  const strong = tier.min >= 1600;
  return {
    recapture: strong,
    vetoUnforcedDrops: strong,
    forbidBlunders: tier.min >= 1800,
  };
}

/* --------------------------------------------------------------------------
   Probability matrices
   -------------------------------------------------------------------------- */

export type QualityWeights = Record<MoveQuality, number>;

function matrix(partial: Partial<QualityWeights>): QualityWeights {
  const full = Object.fromEntries(
    MOVE_QUALITY_ORDER.map((quality) => [quality, 0]),
  ) as QualityWeights;
  for (const quality of MOVE_QUALITY_ORDER) {
    full[quality] = Math.max(0, partial[quality] ?? 0);
  }
  return full;
}

/**
 * Per-class move-quality probabilities.
 *
 * `forced`, `book`, `clutch` and `brilliant` are deliberately zero in every
 * row: they are deterministic overrides and by-products of the position, not
 * things a class rolls for. Everything else is the class's expected move
 * distribution, and every row sums to 1. `great` is the small share of turns a
 * class recognises the only move; `miss` is the tail where a winning position
 * is let go; `throw` exists only in the two weakest classes.
 */
export const QUALITY_WEIGHTS: Record<UsfcClassId, QualityWeights> = {
  E: matrix({
    great: 0.04,
    best: 0.1,
    excellent: 0.16,
    good: 0.22,
    inaccuracy: 0.18,
    mistake: 0.16,
    miss: 0.04,
    blunder: 0.08,
    throw: 0.02,
  }),
  D: matrix({
    great: 0.05,
    best: 0.18,
    excellent: 0.2,
    good: 0.24,
    inaccuracy: 0.15,
    mistake: 0.1,
    miss: 0.03,
    blunder: 0.04,
    throw: 0.01,
  }),
  C: matrix({
    great: 0.06,
    best: 0.26,
    excellent: 0.24,
    good: 0.24,
    inaccuracy: 0.12,
    mistake: 0.06,
    miss: 0.01,
    blunder: 0.01,
  }),
  B: matrix({
    great: 0.07,
    best: 0.34,
    excellent: 0.28,
    good: 0.2,
    inaccuracy: 0.07,
    mistake: 0.03,
    miss: 0.01,
  }),
  A: matrix({
    great: 0.08,
    best: 0.44,
    excellent: 0.3,
    good: 0.15,
    inaccuracy: 0.03,
  }),
  expert: matrix({
    great: 0.1,
    best: 0.54,
    excellent: 0.31,
    good: 0.05,
  }),
};

/** Which error qualities a class may never roll, even if a curve says so. */
export const QUALITY_GATES = { blunder: 1800, mistake: 2400 } as const;

/**
 * Ratings at which an error quality leaves the distribution.
 *
 * The matrices already zero blunders and throws for Class A and Expert+; the
 * gates are the second line of defence, so a future matrix edit or a scaled
 * error curve cannot put them back for a strong class.
 */
export function gatedWeight(quality: MoveQuality, elo: number, weight: number): number {
  if ((quality === 'blunder' || quality === 'throw') && elo >= QUALITY_GATES.blunder) return 0;
  if ((quality === 'mistake' || quality === 'miss') && elo >= QUALITY_GATES.mistake) return 0;
  return weight;
}

export function totalWeight(weights: QualityWeights): number {
  return MOVE_QUALITY_ORDER.reduce((sum, quality) => sum + weights[quality], 0);
}

/** Normalizes a row to sum to 1; an empty row becomes a pure `best`. */
export function normalizeWeights(weights: QualityWeights): QualityWeights {
  const total = totalWeight(weights);
  if (!(total > 0)) return matrix({ best: 1 });
  const next = matrix({});
  for (const quality of MOVE_QUALITY_ORDER) next[quality] = weights[quality] / total;
  return next;
}

/**
 * Drops the qualities this position cannot offer and hands their mass to the
 * ones it can, proportionally.
 *
 * If the engine's MultiPV list holds no blunder — the usual case in a quiet
 * position — an 8% blunder share is not thrown away, it is redistributed
 * across the qualities that *are* present. A row with nothing available
 * collapses to `best`, which is the selection layer's job to fill; this
 * function only decides the shape of the roll.
 */
export function renormalizeWeights(
  weights: QualityWeights,
  available: (quality: MoveQuality) => boolean,
): QualityWeights {
  const next = matrix({});
  let total = 0;
  for (const quality of MOVE_QUALITY_ORDER) {
    if (!available(quality)) continue;
    next[quality] = weights[quality];
    total += weights[quality];
  }
  if (!(total > 0)) return matrix({ best: 1 });
  for (const quality of MOVE_QUALITY_ORDER) next[quality] /= total;
  return next;
}

/** The class's matrix with the phase/time-control error multiplier applied. */
export function classWeights(elo: number, errorMultiplier = 1): QualityWeights {
  const tier = uscfClassFor(elo);
  const base = QUALITY_WEIGHTS[tier.id];
  const multiplier =
    Number.isFinite(errorMultiplier) && errorMultiplier > 0 ? errorMultiplier : 1;
  const scaled = matrix({});
  for (const quality of MOVE_QUALITY_ORDER) {
    const weight =
      quality === 'inaccuracy' ||
      quality === 'mistake' ||
      quality === 'miss' ||
      quality === 'blunder' ||
      quality === 'throw'
        ? base[quality] * multiplier
        : base[quality];
    scaled[quality] = gatedWeight(quality, elo, weight);
  }
  return normalizeWeights(scaled);
}

/**
 * One roll against the class's matrix.
 *
 * The qualities a class cannot offer are re-normalized away *before* the roll,
 * so an Expert+ never consumes probability mass on a bucket that does not
 * exist. `random` defaults to `Math.random`; tests pass a fixed value.
 */
export function rollClassQuality(input: {
  elo: number;
  random?: () => number;
  errorMultiplier?: number;
}): MoveQuality {
  const random = input.random ?? Math.random;
  const weights = classWeights(input.elo, input.errorMultiplier);
  let roll = random() * totalWeight(weights);
  for (const quality of MOVE_QUALITY_ORDER) {
    roll -= weights[quality];
    if (roll < 0 && weights[quality] > 0) return quality;
  }
  return 'best';
}

/* --------------------------------------------------------------------------
   Classification
   -------------------------------------------------------------------------- */

/** Win-percent boundaries that separate the qualities. */
export const QUALITY_BANDS = {
  best: 0.5,
  excellent: 2,
  good: 5,
  inaccuracy: 10,
  mistake: 20,
  blunder: 35,
  greatOnlyMove: 10,
  winning: 80,
} as const;

export interface MoveClassificationInput {
  /** Percentage points of win probability this move gives up. */
  winPctLoss: number;
  /** Centipawn loss, used only for the description/trace. */
  cpLoss?: number;
  /** 1 = the engine's first line. Defaults to 1. */
  rank?: number | null;
  /** Legal moves in the position: one means the move was forced. */
  legalMoves?: number;
  /** The move came from prepared theory inside the book window. */
  book?: boolean;
  /** Material (cp) given up on purpose by a winning move. */
  sacrificeCp?: number;
  /** Win probability for the mover after the move, 0-100. */
  winPct?: number;
  /** Win probability of the engine's best line, 0-100. */
  bestWinPct?: number;
  /** Percentage-point gap between the first and second lines. */
  secondBestGap?: number;
  /** Clock left for the mover, ms. */
  clockMs?: number | null;
  /** The mover is defending a critical disadvantage. */
  defending?: boolean;
}

/**
 * The 13-quality classifier.
 *
 * Deterministic overrides come first: a lone legal move is Forced, a theory
 * move is Book, and a best-ish move under 15 seconds or while defending is
 * Clutch. Only then are the win-drop bands applied — 0.5 / 2 / 5 / 10 / 20 /
 * 35 points — so a `Throw` is always a 35+ point collapse and a `Blunder` is
 * always 20-35. A 10-35 point drop from a winning position is a `Miss` rather
 * than a Mistake: the win was there. Among the top moves, a deliberate
 * material sacrifice is Brilliant, and a move whose alternatives all lose 10+
 * points is Great.
 */
export function classifyMoveQuality(input: MoveClassificationInput): MoveQuality {
  if ((input.legalMoves ?? 2) <= 1) return 'forced';
  if (input.book) return 'book';

  const loss = Math.max(0, input.winPctLoss);
  /* Without the caller's win probabilities, assume a level game: a 12-point
     drop from an unknown position is a mistake, not a missed win. */
  const bestWin = input.bestWinPct ?? 50;
  const winPct = input.winPct ?? Math.max(0, bestWin - loss);

  if (loss > QUALITY_BANDS.blunder) return 'throw';
  if (loss >= QUALITY_BANDS.mistake) return 'blunder';
  if (loss >= QUALITY_BANDS.inaccuracy) {
    return bestWin >= QUALITY_BANDS.winning && winPct >= 40 ? 'miss' : 'mistake';
  }
  if (loss >= QUALITY_BANDS.good) return 'inaccuracy';
  if (loss >= QUALITY_BANDS.excellent) return 'good';
  if (loss >= QUALITY_BANDS.best) return 'excellent';
  if ((input.rank ?? 1) !== 1) return 'excellent';

  const pressure =
    (input.clockMs !== null && input.clockMs !== undefined && input.clockMs < 15_000) ||
    input.defending === true;
  if (pressure) return 'clutch';
  if ((input.sacrificeCp ?? 0) >= 200 && winPct >= 50) return 'brilliant';
  if ((input.secondBestGap ?? 0) >= QUALITY_BANDS.greatOnlyMove) return 'great';
  return 'best';
}

/** The six-bucket selection bucket a quality fills. `null` for overrides. */
export type SelectionBucket = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export function selectionBucketFor(quality: MoveQuality): SelectionBucket {
  switch (quality) {
    case 'clutch':
    case 'brilliant':
    case 'great':
    case 'best':
    case 'book':
      return 'best';
    case 'excellent':
      return 'excellent';
    case 'good':
      return 'good';
    case 'inaccuracy':
      return 'inaccuracy';
    case 'mistake':
    case 'miss':
      return 'mistake';
    case 'blunder':
    case 'throw':
      return 'blunder';
    case 'forced':
      return 'best';
  }
}

/* --------------------------------------------------------------------------
   Positional guards
   -------------------------------------------------------------------------- */

const PIECE_CP: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

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

/**
 * True when the move leaves one of the mover's pieces (knight or better) on a
 * square where only the opponent attacks it — an unforced piece drop.
 *
 * Captures and checks are exempt: those are the miscalculated trade and the
 * checking sacrifice a human actually plays, and the point of the guard is the
 * piece left in the middle of nowhere. The caller applies it from Class B up.
 */
export function isUnforcedPieceDrop(fen: string, uci: string): boolean {
  const before = new Chess(fen);
  if (before.inCheck()) return false;
  const mover = before.turn();
  const opponent = mover === 'w' ? 'b' : 'w';
  const after = applyUci(fen, uci);
  if (!after || after.inCheck()) return false;

  const move = before
    .moves({ verbose: true })
    .find((entry) => `${entry.from}${entry.to}${entry.promotion ?? ''}` === uci);
  if (move?.captured) return false;

  for (const row of after.board()) {
    for (const piece of row) {
      if (!piece || piece.color !== mover) continue;
      if ((PIECE_CP[piece.type] ?? 0) < 320) continue;
      if (after.attackers(piece.square as Square, opponent).length === 0) continue;
      if (after.attackers(piece.square as Square, mover).length > 0) continue;
      return true;
    }
  }
  return false;
}

/** Legal captures onto the square the opponent just captured on. */
export function recaptureMoves(fen: string, to: string): string[] {
  const game = new Chess(fen);
  return game
    .moves({ verbose: true })
    .filter((move) => move.to === to && Boolean(move.captured))
    .map((move) => `${move.from}${move.to}${move.promotion ?? ''}`);
}

/* --------------------------------------------------------------------------
   Selection
   -------------------------------------------------------------------------- */

/** One scored candidate, already in the mover's point of view. */
export interface ClassCandidate {
  uci: string;
  /** Percentage points of win probability lost against the best line. */
  winPctLoss: number;
  cpLoss?: number;
  /** Material (cp) the move gives away on purpose while staying winning. */
  sacrificeCp?: number;
}

export interface ClassSelection {
  uci: string;
  quality: MoveQuality;
  /** The distribution that was rolled, after gating and re-normalization. */
  weights: QualityWeights;
  /** Why this move was chosen over the matrix roll, when it was. */
  guard: 'forced' | 'book' | 'recapture' | 'matrix';
}

export interface ClassSelectionInput {
  fen: string;
  elo: number;
  candidates: readonly ClassCandidate[];
  /** The opponent's last capture, when it was one. */
  lastCapture?: { to: string } | null;
  /** Legal moves in the position; one makes the move Forced. */
  legalMoves?: number;
  /** Prepared theory supplied a move for this position. */
  bookMove?: string | null;
  clockMs?: number | null;
  /** The mover is defending a critical disadvantage. */
  defending?: boolean;
  random?: () => number;
  errorMultiplier?: number;
}

/**
 * The class selector: the move a bot of this class plays from a scored list.
 *
 * Order of business:
 * 1. `⇒` Forced — one legal move is played, no roll.
 * 2. `▣` Book — prepared theory inside the class's ply limit is played, no roll.
 * 3. Recapture guard (Class B+) — an offered recapture is taken back, because
 *    a 1600 does not forget the queen that just took a queen.
 * 4. Unforced-drop veto (Class B+) — a move that leaves a knight or better
 *    hanging with no capture or check behind it is removed from the pool.
 * 5. Matrix roll — one quality from the class's re-normalized distribution,
 *    then the least-losing candidate carrying that quality.
 * 6. `○` Clutch — a best/great pick under 15 seconds or while defending is
 *    relabelled Clutch.
 *
 * Class A and Expert+ can never return a Blunder, Throw or (for Expert+) any
 * error quality at all: the matrix has zero weight there and the vetoes run
 * before the roll.
 */
export function selectClassMove(input: ClassSelectionInput): ClassSelection | null {
  const random = input.random ?? Math.random;
  const legal = input.candidates.filter((candidate) => Number.isFinite(candidate.winPctLoss));
  const tier = uscfClassFor(input.elo);
  const guards = classGuardsFor(tier);
  const weights = classWeights(input.elo, input.errorMultiplier);
  const forced = (input.legalMoves ?? 2) <= 1;

  if (forced) {
    const only = legal[0];
    if (!only) return null;
    return { uci: only.uci, quality: 'forced', weights, guard: 'forced' };
  }

  if (input.bookMove) {
    return { uci: input.bookMove, quality: 'book', weights, guard: 'book' };
  }

  if (legal.length === 0) return null;

  if (guards.recapture && input.lastCapture) {
    const offered = new Set(recaptureMoves(input.fen, input.lastCapture.to));
    const recapture = legal
      .filter((candidate) => offered.has(candidate.uci))
      .sort((a, b) => a.winPctLoss - b.winPctLoss)[0];
    if (recapture) {
      return { uci: recapture.uci, quality: 'best', weights, guard: 'recapture' };
    }
  }

  const pool = guards.vetoUnforcedDrops
    ? legal.filter((candidate) => !isUnforcedPieceDrop(input.fen, candidate.uci))
    : [...legal];
  const usable = pool.length > 0 ? pool : [...legal];

  const ordered = [...usable].sort((a, b) => a.winPctLoss - b.winPctLoss);
  const classified = ordered.map((candidate, index) => ({
    candidate,
    quality: classifyMoveQuality({
      winPctLoss: candidate.winPctLoss,
      cpLoss: candidate.cpLoss,
      rank: index + 1,
      legalMoves: input.legalMoves,
      sacrificeCp: candidate.sacrificeCp,
      clockMs: input.clockMs,
      defending: input.defending,
    }),
  }));

  const allowed = (quality: MoveQuality) => {
    if (guards.forbidBlunders && (quality === 'blunder' || quality === 'throw')) return false;
    return gatedWeight(quality, input.elo, 1) > 0;
  };

  const present = new Set(classified.map((entry) => entry.quality));
  const rolled = renormalizeWeights(
    weights,
    (quality) => present.has(quality) && allowed(quality),
  );

  let roll = random();
  let quality: MoveQuality = 'best';
  for (const candidate of MOVE_QUALITY_ORDER) {
    roll -= rolled[candidate];
    if (roll < 0 && rolled[candidate] > 0 && present.has(candidate)) {
      quality = candidate;
      break;
    }
  }
  if (!present.has(quality)) {
    quality = [...present].find(allowed) ?? 'best';
  }

  const match = classified.find((entry) => entry.quality === quality) ?? classified[0];
  const finalQuality =
    (match.quality === 'best' || match.quality === 'great') &&
    ((input.clockMs !== null && input.clockMs !== undefined && input.clockMs < 15_000) ||
      input.defending === true)
      ? 'clutch'
      : match.quality;

  return { uci: match.candidate.uci, quality: finalQuality, weights: rolled, guard: 'matrix' };
}
