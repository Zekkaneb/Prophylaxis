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
 * The same six names describe the **vision window** a rating can see. The depth-9
 * reference pass scores every candidate, and each one is bucketed by its win
 * drop with `classifyCandidate`: only the engine's #1 move is *best*, and every
 * other move lands in `excellent` (<2), `good` (2-5), `inaccuracy` (5-10),
 * `mistake` (10-20) or `blunder` (20+). `getBucketWeights` decides how often
 * each bucket is asked for; blunders leave the distribution entirely at 2100
 * USCF and mistakes at 2400, so a strong bot never has to be talked out of one.
 * The beginner band is carried by those curves alone (46% blunders and 34%
 * mistakes at the 100 floor) and by the node cap (`beginnerNodeCap`, 45 nodes at
 * 700), because an error model that assumes blindness is pointless if the engine
 * still sees the tactic.
 *
 * Three more rules keep the errors human:
 *
 * - `recaptureChance` separates the beginner band from the club band sharply.
 *   Below 900 USCF an **equal trade** is taken back only 32% of the time at 400
 *   and 46% at 700 — that is board blindness, the piece that just took
 *   something simply not being noticed. From 900 up the club curve takes it
 *   back ~93% of the time and ~94% at 1000. A **costly** recapture — winning
 *   back less than was lost — keeps a much lower share, because that is the
 *   exchange a weaker player miscalculates;
 * - `freeHangAfter` is a hard floor above 400 USCF: a quiet move that leaves a
 *   major piece attacked with no defender is never rolled as an error. The
 *   bot's misses come from over-ambition — a capture into a trap, a queen
 *   sortie, a pawn push — not from a piece dropped in the middle of nowhere;
 * - the severity buckets are filled by **intent** — a greedy capture, a check or
 *   forward attack, central tension, or a shallow-search favourite — from 1000
 *   USCF up, never by sampling ranks 21-32 of a wide search. Below 1000 the bot
 *   has beginner board blindness instead (any candidate in the band is fair),
 *   and an error band the engine's list cannot fill is probed off-list before
 *   the roll is allowed to settle for a milder move.
 *
 * The engine itself always calculates: every rating searches at its own depth
 * over `MultiPV 10` lines, and the choice among those lines is what changes.
 */

/* --------------------------------------------------------------------------
   Continuous curves
   -------------------------------------------------------------------------- */

export const ELO_MIN = 100;
export const ELO_MAX = 2800;

/**
 * The extreme bottom tier: 100-200 USCF.
 *
 * Below this rating the model stops interpolating between curves and plays the
 * profile it can defend: the piece is simply gone, the pawn push is simply
 * chaotic, and the recapture is simply not noticed. It is a step rather than a
 * slope on purpose - 100-200 USCF is one kind of player, and no card above the
 * tier is asked to play this way.
 */
export const BOTTOM_TIER_ELO = 200;

/**
 * What a sub-200 player rolls, per move.
 *
 * 65% blunder, 25% mistake, and under 10% left for anything that survives - the
 * distribution of someone who has not yet learned what a threat is. The error
 * buckets are not scaled again on top of this: this *is* the bottom tier.
 */
export const BOTTOM_TIER_SHARES = {
  blunder: 0.65,
  mistake: 0.25,
  inaccuracy: 0.04,
  good: 0.04,
  excellent: 0.015,
  best: 0.005,
} as const;

/** MultiPV width of the main search: enough lines for every band to exist. */
export const HUMAN_MULTI_PV = 10;

/** Width and depth of the shallow "what does this look like" search. */
export const SHALLOW_MULTI_PV = 6;
export const SHALLOW_DEPTH = 3;

/** Below this rating the bot has no idea what it is doing yet. */
export const BEGINNER_ELO = 600;

/** Under this rating the beginner curves add error mass and suppress the top line. */
export const BEGINNER_VULNERABILITY_ELO = 1000;

/** Under this rating the recapture curve is the beginner's, not the club player's. */
export const BEGINNER_RECAPTURE_ELO = 900;

/** Nodes the shakiest beginner search may spend (100 USCF). */
export const BEGINNER_NODE_FLOOR = 12;

/** Extra nodes per rating point: 45 nodes at 700 USCF, ~61 at 1000. */
export const BEGINNER_NODE_PER_ELO = 0.055;

/** From here down the analysis is only one or two plies deep. */
export const BEGINNER_DEPTH_ELO = 1000;

/** Softmax weight of the #1 and #2 engine moves below 1000 USCF. */
export const BEGINNER_TOP_WEIGHT = 0.08;
export const BEGINNER_SECOND_WEIGHT = 0.25;

/**
 * From here up an error needs a tactical purpose.
 *
 * Below 1000 USCF the bot has beginner board blindness: it may leave a piece
 * where it can simply be taken, step onto an attacked square or push a pawn
 * for no reason. Above it, an error has to look intended — a greedy capture, a
 * check or forward attack, a central push, a queen sortie, or a shallow-search
 * favourite.
 */
export const TUNNEL_VISION_ELO = 1000;

/**
 * Under this rating an empty error bucket is filled by an off-list probe.
 *
 * The engine's MultiPV list holds only a handful of playable moves in a quiet
 * position, so `mistake` and `blunder` are often empty: a 700-1400 player still
 * errs, so the caller probes a few plausible legal moves and keeps the first
 * whose depth-9 reference score lands in the rolled band. From 1500 up the slip
 * has to be a line the bot actually considered, and the probe is off.
 */
export const PROBE_ELO = 1500;

/** From here a slip must survive a deep calculation, not just a shallow look. */
export const DEEP_SLIP_ELO = 1500;

/**
 * From here a free hang of a major piece is never an error.
 *
 * Below the intent floor leaving a knight on a square nobody defends really is
 * the mistake — beginner board blindness. From 1000 up the model insists on a
 * move with a human point, so an undefended piece is no longer a legal slip.
 */
export const HANG_GUARD_ELO = 1000;

/**
 * Discount on a "recapture" that wins back less than it costs.
 *
 * Taking back an equal trade is close to automatic from 400 USCF up; taking
 * back with a queen to win a pawn is the tempting miscalculation the curve is
 * meant to leave open, so it keeps only this share of the chance.
 */
export const COSTLY_RECAPTURE_SHARE = 0.45;

/** Weight multipliers that make an error look tempting rather than accidental. */
export const TEMPTATION_BOOST = 2.4;
export const TEMPTATION_BOOST_MILD = 1.5;
export const TEMPTATION_DAMPING = 0.35;

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
 * Only reachable below `PROBE_ELO`: the wide tail of a shallow search is where
 * the moves a player would never pick deliberately live — a piece left where it
 * can simply be taken, a loose pawn push — so that is what gets scored.
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

/**
 * The centipawn band a rolled bucket covers, for callers that fill it from the
 * engine's own MultiPV list instead of the depth-9 reference pass.
 *
 * The calibrated selector scores every candidate against a reference search and
 * fills the bucket by win drop. A character bot has no reference pass, so the
 * same roll has to be expressed in centipawns. The band is rated, not fixed: an
 * inaccuracy is 40-120 cp at 800 and roughly a third of that at 2400, because a
 * strong player's `?!` is a loose move, not a piece. A fixed band was why every
 * card rating between 1400 and 2350 measured the same mean loss: the top of the
 * ladder made fewer mistakes, each one as large as a beginner's. `null` means
 * the roll asked for a best/excellent/good move, where personality chooses
 * freely.
 */
export function slipBand(
  kind: Bucket,
  elo = 1400,
): { minGap: number; maxGap: number } | null {
  const base = (() => {
    switch (kind) {
      case 'inaccuracy':
        return { minGap: 40, maxGap: 120 };
      case 'mistake':
        return { minGap: 120, maxGap: 280 };
      case 'blunder':
        return { minGap: 280, maxGap: 900 };
      default:
        return null;
    }
  })();
  if (!base) return null;

  const t = Math.min(1, Math.max(0, (clampElo(elo) - 800) / 1600));
  const scale = 1 - 0.68 * t; // 1.0 at 800 → 0.32 at 2400
  return {
    minGap: Math.max(8, Math.round(base.minGap * scale)),
    maxGap: Math.max(20, Math.round(base.maxGap * scale)),
  };
}

/**
 * Ratings at which a bucket leaves the distribution entirely.
 *
 * A 2100 does not blunder by choice: the error mass that the smooth curve would
 * still assign it is re-normalized into the other buckets, so `best` keeps
 * growing at the top instead of the curve leaving a 0.2% tail it can no longer
 * justify.
 */
export const BUCKET_GATES = { blunder: 2100, mistake: 2400 } as const;

/** Win-drop percentages that separate one bucket from the next. */
export const SELECTION_BANDS = {
  excellent: 2.0,
  good: 5.0,
  inaccuracy: 10.0,
  mistake: 20.0,
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
  /** `?!`: 5-10% (`SELECTION_BANDS.inaccuracy`). */
  inaccuracy: number;
  /** `✓`: 2-5% (`SELECTION_BANDS.good`). */
  good: number;
  /** `⦿`: 0-2% (`SELECTION_BANDS.excellent`). */
  excellent: number;
  /** `*`: the #1 reference move, i.e. win drop 0. */
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
 * The six-bucket move-quality distribution: how often each class is rolled.
 *
 * Each curve has its own shape on purpose: blunders collapse fastest (46% at the
 * floor, ~16% at 700, ~7% at 1100) and are switched off at `BUCKET_GATES`;
 * mistakes decay smoothly and stop at 2400; inaccuracies peak through the club
 * band; good absorbs the main body of club and intermediate play; excellent
 * rises with rating; and best takes whatever the other five leave. The beginner
 * band is carried by these curves alone, with no separate scaling on top.
 */
export function getBucketWeights(elo: number): QualityShares {
  const target = clampElo(elo);
  if (target <= BOTTOM_TIER_ELO) return normalizeQuality({ ...BOTTOM_TIER_SHARES });
  const s = skillOf(target);

  const blunder =
    target >= BUCKET_GATES.blunder ? 0 : 0.46 * Math.exp(-5.8 * Math.pow(s, 1.15));
  const mistake = target >= BUCKET_GATES.mistake ? 0 : 0.34 * Math.exp(-3.4 * s);
  const inaccuracy =
    0.02 + 0.25 * Math.sin(Math.PI * Math.pow(s, 0.72)) * Math.exp(-0.45 * s);
  const good = 0.05 + 0.33 * Math.sin(Math.PI * Math.pow(s, 0.85));
  const excellent = 0.02 + 0.34 * Math.pow(s, 1.05);
  const best = Math.max(0.01, 1 - (blunder + mistake + inaccuracy + good + excellent));

  return normalizeQuality({ blunder, mistake, inaccuracy, good, excellent, best });
}

/** The rating's weights with the active phase, time control and trouble offset. */
export function qualityShares(elo: number, errorMultiplier = 1): QualityShares {
  return scaleErrors(getBucketWeights(elo), errorMultiplier);
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** How the recapture compares with what was just lost. */
export type TradeKind = 'equal' | 'favourable' | 'costly';

/**
 * Classifies the recapture on the square the opponent just captured on.
 *
 * `taken` is the piece now standing there (the opponent's capturing piece) and
 * `lost` is the piece it took from us: a 400 USCF player takes a queen back
 * without thinking and miscalculates taking a pawn back with a queen.
 */
export function recaptureTrade(
  fen: string,
  lastCapture: LastCapture,
  uci?: string,
): TradeKind {
  const lost = PIECE_VALUE[lastCapture.captured ?? 'p'] ?? 0;
  if (!uci) return 'equal';

  const taken = new Chess(fen).get(uci.slice(2, 4) as Square);
  if (!taken) return 'equal';

  const takenValue = PIECE_VALUE[taken.type] ?? 0;
  if (takenValue > lost) return 'favourable';
  if (takenValue === lost) return 'equal';
  return 'costly';
}

/**
 * Chance an obvious recapture is actually taken.
 *
 * Below 900 USCF the board is not read properly, so the curve is the beginner's:
 *
 * - an equal trade `0.12 + 0.70 * (1 - exp(-3.0 * s))` — 12% at the floor, 32%
 *   at 400 and 46% at 700. Half the time a 700 bot does not notice the piece
 *   that just took something, which is exactly the free recapture a beginner
 *   leaves on the board;
 * - from 900 up the club curve `0.50 + 0.49 * (1 - exp(-4.2 * s^0.55))` takes
 *   over: ~93% at 900, ~94% at 1000 and ~98% at the top. The boundary is steep
 *   on purpose — it is the model's beginner/club line;
 * - a `costly` recapture keeps `COSTLY_RECAPTURE_SHARE` of either chance, so a
 *   queen taking back a pawn stays a real beginner error;
 * - a `favourable` recapture (their queen took our pawn) is automatic.
 */
export function recaptureChance(elo: number, trade: TradeKind = 'equal'): number {
  const s = skillOf(elo);
  const base =
    clampElo(elo) < BEGINNER_RECAPTURE_ELO
      ? 0.12 + 0.7 * (1 - Math.exp(-3.0 * s))
      : 0.5 + 0.49 * (1 - Math.exp(-4.2 * Math.pow(s, 0.55)));
  return trade === 'costly' ? base * COSTLY_RECAPTURE_SHARE : base;
}

/**
 * Effective search depth. Deliberately steep near the bottom of the range: a
 * 1100 USCF club player looks 4-5 plies ahead, not 7-8. The time-control offset
 * is applied before the two-ply floor.
 */
export function humanSearchDepth(elo: number, depthOffset = 0): number {
  const s = skillOf(elo);
  const depth = Math.max(2, Math.round(2 + Math.pow(s, 1.3) * 12) + depthOffset);

  /* The analogue of a node cap for this engine path: a sub-1000 player simply
     does not look far enough to see a two-move tactic. Two plies at the very
     bottom (own move + one reply), three through the rest of the beginner
     band. Applied after the time-control offset. */
  if (clampElo(elo) >= BEGINNER_DEPTH_ELO) return depth;
  return Math.min(depth, clampElo(elo) < 500 ? 2 : 3);
}

/**
 * Node budget for a beginner search, or null once the bot is out of the band.
 *
 * A beginner does not calculate: it looks at a handful of moves and stops. At
 * 700 USCF 45 nodes is depth 1-2 for Stockfish over a MultiPV list, so the
 * two-ply tactic, the fork and the discovered attack are routinely missed — the
 * whole point of capping nodes rather than only depth. The budget grows with
 * rating and disappears at 1000, where depth does the work again.
 */
export function beginnerNodeCap(elo: number): number | null {
  const target = clampElo(elo);
  if (target >= BEGINNER_DEPTH_ELO) return null;
  /* The extreme bottom tier gets a single-ply budget: 8 nodes at 100 USCF and
     12 at 200, which is less than one full look at the board. The bot cannot
     see the reply, so a one-move threat and the recapture are both invisible -
     which is the whole point, not a side effect. */
  if (target <= BOTTOM_TIER_ELO) {
    return Math.min(12, Math.round(8 + (target - ELO_MIN) * 0.04));
  }
  return Math.round(BEGINNER_NODE_FLOOR + (target - ELO_MIN) * BEGINNER_NODE_PER_ELO);
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

/**
 * Win-drop -> quality label for a move that is not the #1 engine choice.
 *
 * The probe results and the distance fallback are labelled with this; the six
 * bands are the ones the review uses, so a move the bot played as an Excellent
 * is still an Excellent when the game is analysed. `best` is never returned:
 * it is an identity test on the #1 move (`classifyCandidate`).
 */
export function bucketFor(winDrop: number): Bucket {
  return classifyCandidate(winDrop, false);
}

/**
 * The bucket a reference-scored candidate belongs to.
 *
 * `best` is not a win-drop band: it is the single #1 move the reference pass
 * agreed with, so a position where two moves are equally good still has one
 * best move and one excellent one.
 */
export function classifyCandidate(winDrop: number, top: boolean): Bucket {
  if (top) return 'best';
  const drop = Math.max(0, winDrop);
  if (drop < SELECTION_BANDS.excellent) return 'excellent';
  if (drop < SELECTION_BANDS.good) return 'good';
  if (drop < SELECTION_BANDS.inaccuracy) return 'inaccuracy';
  if (drop < SELECTION_BANDS.mistake) return 'mistake';
  return 'blunder';
}

export type BucketGroups<T> = Record<Bucket, T[]>;

/** Splits the reference-scored candidates into the six selection buckets. */
export function bucketCandidates<T extends { winDrop: number }>(
  candidates: readonly T[],
): BucketGroups<T> {
  const groups: BucketGroups<T> = {
    best: [],
    excellent: [],
    good: [],
    inaccuracy: [],
    mistake: [],
    blunder: [],
  };
  if (candidates.length === 0) return groups;

  let top = candidates[0];
  for (const candidate of candidates) {
    if (candidate.winDrop < top.winDrop) top = candidate;
  }
  for (const candidate of candidates) {
    groups[classifyCandidate(candidate.winDrop, candidate === top)].push(candidate);
  }
  return groups;
}

/** The bucket where the rating's probability mass is centred. */
export function medianBucket(quality: QualityShares): Bucket {
  let cursor = 0;
  for (const bucket of BUCKET_ORDER) {
    cursor += quality[bucket];
    if (cursor >= 0.5) return bucket;
  }
  return 'good';
}

/**
 * Where an empty roll goes: step inward toward the rating's median bucket, then
 * on past it toward `best`.
 *
 * An 1800's empty `excellent` roll becomes `good` before `best`, because `good`
 * is where that rating's mass sits; a 700's empty `blunder` roll walks
 * `mistake -> inaccuracy -> good` before it reaches a quality move. Nothing is
 * ever forced outward into a worse bucket, which is what stops an empty band
 * becoming an alien rank-30 move.
 */
export function bucketFallbackChain(rolled: Bucket, median: Bucket): readonly Bucket[] {
  const start = BUCKET_ORDER.indexOf(rolled);
  const centre = BUCKET_ORDER.indexOf(median);
  const step = start <= centre ? 1 : -1;
  const chain: Bucket[] = [];

  for (let index = start; ; index += step) {
    chain.push(BUCKET_ORDER[index]);
    if (index === centre) break;
  }
  for (let index = centre - 1; index >= 0; index -= 1) {
    if (!chain.includes(BUCKET_ORDER[index])) chain.push(BUCKET_ORDER[index]);
  }
  return chain;
}

/* --------------------------------------------------------------------------
   Per-game phase proficiency
   -------------------------------------------------------------------------- */

export type PhaseProficiencyLevel = 1 | 2 | 3 | 4 | 5;

export interface PhaseProfile {
  opening: PhaseProficiencyLevel;
  middlegame: PhaseProficiencyLevel;
  endgame: PhaseProficiencyLevel;
}

export interface PhaseLevelMeta {
  level: PhaseProficiencyLevel;
  /** Debug/UI label. */
  label: string;
  /** Rating offset the level asks for, before the beginner ceiling. */
  eloOffset: number;
  /** Multiplier on the three error buckets for that phase. */
  errorMult: number;
}

export const PHASE_LEVELS: readonly PhaseProficiencyLevel[] = [1, 2, 3, 4, 5];

export const PHASE_LEVELS_META: Record<PhaseProficiencyLevel, PhaseLevelMeta> = {
  1: { level: 1, label: 'Weak / Sloppy', eloOffset: -200, errorMult: 1.35 },
  2: { level: 2, label: 'Below Par', eloOffset: -100, errorMult: 1.15 },
  3: { level: 3, label: 'On-Rating', eloOffset: 0, errorMult: 1 },
  4: { level: 4, label: 'Strong', eloOffset: 100, errorMult: 0.82 },
  5: { level: 5, label: 'Peak / Sharp', eloOffset: 175, errorMult: 0.68 },
};

/** Below this rating the three phases must be three different levels. */
export const PHASE_DISTINCT_ELO = 1600;

/** At or below this rating at most one phase may be Level 1. */
export const PHASE_ONE_BAD_ELO = 1400;

/** Replacement level used when the one-bad-phase rule is violated. */
export const PHASE_FALLBACK_LEVEL: PhaseProficiencyLevel = 3;

/** Ceiling on any positive phase boost, and its share of the base rating. */
export const PHASE_MAX_BOOST = 180;
export const PHASE_MAX_BOOST_SHARE = 0.25;

/** Sampling weights from 1600 Elo up: strong phases are common, Level 1 rare. */
export const PHASE_LEVEL_WEIGHTS: Record<PhaseProficiencyLevel, number> = {
  1: 0.05,
  2: 0.15,
  3: 0.3,
  4: 0.3,
  5: 0.2,
};

export function phaseErrorMultiplier(level: PhaseProficiencyLevel): number {
  return PHASE_LEVELS_META[level].errorMult;
}

/**
 * The rating a phase actually plays at.
 *
 * Positive boosts are capped at 25% of the base rating (at most 180), so a 700
 * bot's best phase is 875, never a 1500-level phase. Negative offsets are taken
 * in full and the result is clamped to the supported range.
 */
export function getEffectivePhaseElo(baseElo: number, level: PhaseProficiencyLevel): number {
  const target = clampElo(baseElo);
  const offset = PHASE_LEVELS_META[level].eloOffset;
  const maxBoost = Math.min(PHASE_MAX_BOOST, Math.round(target * PHASE_MAX_BOOST_SHARE));
  const applied = offset > 0 ? Math.min(offset, maxBoost) : offset;
  return clampElo(target + applied);
}

/** Uniform pick without replacement from the five levels. */
function distinctLevels(random: () => number): PhaseProfile {
  const pool = [...PHASE_LEVELS];
  const picked: PhaseProficiencyLevel[] = [];
  while (picked.length < 3 && pool.length > 0) {
    const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    picked.push(pool.splice(index, 1)[0]);
  }
  return { opening: picked[0], middlegame: picked[1], endgame: picked[2] };
}

/** One weighted draw, replacement allowed. */
function weightedLevel(random: () => number): PhaseProficiencyLevel {
  const total = PHASE_LEVELS.reduce((sum, level) => sum + PHASE_LEVEL_WEIGHTS[level], 0);
  let roll = random() * total;
  for (const level of PHASE_LEVELS) {
    roll -= PHASE_LEVEL_WEIGHTS[level];
    if (roll < 0) return level;
  }
  return 3;
}

/**
 * Rolls the strength profile for one game.
 *
 * Under 1600 Elo the three phases are three different levels, so a beginner is
 * always lopsided somewhere instead of uniformly weak. From 1600 up matching
 * phases are allowed and the draw is weighted toward 3-5 with Level 1 at 5%.
 * At or below 1400 a second Level 1 is replaced by Level 3, so a bot never
 * collapses in more than one phase per game.
 */
export function rollPhaseProfile(
  baseElo: number,
  random: () => number = Math.random,
): PhaseProfile {
  const target = clampElo(baseElo);
  const profile =
    target < PHASE_DISTINCT_ELO
      ? distinctLevels(random)
      : {
          opening: weightedLevel(random),
          middlegame: weightedLevel(random),
          endgame: weightedLevel(random),
        };

  if (target > PHASE_ONE_BAD_ELO) return profile;

  const levels: Array<'opening' | 'middlegame' | 'endgame'> = [
    'opening',
    'middlegame',
    'endgame',
  ];
  let badSeen = false;
  for (const phase of levels) {
    if (profile[phase] !== 1) continue;
    if (!badSeen) {
      badSeen = true;
      continue;
    }
    profile[phase] = PHASE_FALLBACK_LEVEL;
  }
  return profile;
}

/** `O: L4 (800) | M: L1 (500) | E: L5 (875)` — dev/debug summary. */
export function describePhaseProfile(baseElo: number, profile: PhaseProfile): string {
  const part = (label: string, level: PhaseProficiencyLevel) =>
    `${label}: L${level} (${getEffectivePhaseElo(baseElo, level)})`;
  return [
    part('O', profile.opening),
    part('M', profile.middlegame),
    part('E', profile.endgame),
  ].join(' | ');
}

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
  /** Rolled once per game; steps the phase's rating up or down. */
  phaseProfile?: PhaseProfile;
}

export interface HumanSearchPlan {
  calibration: HumanCalibration;
  phase: GamePhase;
  timeControl: TimeControlScaling;
  timeTrouble: boolean;
  positionKind: PositionKind;
  /** Depth handed to the engine. */
  depth: number;
  /** Stockfish node cap for a beginner search; null above 1000 USCF. */
  nodeCap: number | null;
  /** Wall-clock budget for the search; the engine really uses this. */
  thinkTimeMs: number;
  /** The six probabilities after phase, time control and time trouble. */
  quality: QualityShares;
  /** `quality.blunder + quality.mistake + quality.inaccuracy`. */
  errorRate: number;
  /** The proficiency level this game rolled for the active phase. */
  phaseLevel: PhaseProficiencyLevel;
  /** The phase's rating after the proficiency offset and ceiling. */
  effectiveElo: number;
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
  const moveNumber = input.moveNumber ?? fullMoveNumber(input.fen);
  const phase = phaseForMoveNumber(moveNumber);

  /* The rolled phase profile is what the bot really plays at this turn: its
     rating, its error mass, its depth and its recapture curve all read from the
     effective rating, not the card rating. Without a profile this is a no-op. */
  const phaseLevel = input.phaseProfile?.[phase] ?? 3;
  const baseElo = clampElo(input.elo);
  const effectiveElo = input.phaseProfile ? getEffectivePhaseElo(baseElo, phaseLevel) : baseElo;

  const calibration = humanCalibration(effectiveElo);
  const phaseMult = phaseMultiplier(phase, baseElo);
  const category = input.timeControlCategory ?? 'classical';
  const timeControl = timeControlScaling(category);
  const incrementMs = Math.max(0, input.incrementMs ?? 0);
  const remaining = input.remainingTimeMs ?? null;

  const timeTrouble =
    remaining !== null && remaining < LOW_CLOCK_MS && incrementMs < LOW_INCREMENT_MS;

  const kind = positionKind(input.fen, input.lastMove);
  const thinkTimeMs = thinkTimeFor(kind, timeControl.timeScale, timeTrouble, remaining, random);

  const scaledDepth = humanSearchDepth(effectiveElo, timeControl.depthOffset);
  const depth = timeTrouble ? Math.min(scaledDepth, TROUBLE_DEPTH_CAP) : scaledDepth;

  /* Phase, time control and time trouble make the same player worse: they scale
     the three error buckets and hand the displaced mass to good/excellent/best. */
  const quality = scaleErrors(
    calibration.quality,
    phaseMult * timeControl.tcMult * (timeTrouble ? 1.4 : 1) * phaseErrorMultiplier(phaseLevel),
  );

  return {
    calibration,
    phase,
    timeControl,
    timeTrouble,
    positionKind: kind,
    depth,
    nodeCap: beginnerNodeCap(effectiveElo),
    thinkTimeMs,
    quality,
    errorRate: quality.blunder + quality.mistake + quality.inaccuracy,
    phaseLevel,
    effectiveElo,
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
  /** The move lands on a contested central square. */
  centralTension: boolean;
  /** An ambitious queen move into the enemy half, onto an attacked square. */
  queenSortie: boolean;
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

/** The d4-e5 box: where pieces come into contact. */
const CENTRAL_BOX = /^[c-f][3-6]$/;

/**
 * True when a move lands on a central square that either side already controls.
 *
 * This is "direct central tension" in the model's terms: the kind of move a
 * club player makes because the point looks important, and then loses material
 * on. Landing on an empty, unopposed centre square is development, not tension.
 */
function contestedCentre(
  game: Chess,
  to: string,
  mover: 'w' | 'b',
  opponent: 'w' | 'b',
): boolean {
  if (!CENTRAL_BOX.test(to)) return false;
  return (
    game.attackers(to as Square, opponent).length > 0 ||
    game.attackers(to as Square, mover).length > 0
  );
}

/** Pieces whose unprovoked loss reads as a blunder rather than a slip. */
const MAJOR_PIECES = new Set(['n', 'b', 'r', 'q']);

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
  const centralTension = contestedCentre(game, move.to, mover, opponent);
  const queenSortie =
    move.piece === 'q' &&
    enemyHalf &&
    game.attackers(move.to, opponent).length > 0;

  return {
    capture: Boolean(move.captured),
    check: game.inCheck(),
    attacksHeavy,
    pawnTowardKing,
    centralTension,
    queenSortie,
  };
}

/**
 * True when the error is one a person could actually commit: a capture that
 * fails tactically, a check or a forward attack, a pawn pushed at the king, an
 * ambitious queen sortie, or a move into central tension that loses material.
 */
export function hasHumanIntent(intent: MoveIntent, winDrop: number): boolean {
  if (intent.capture && winDrop >= 18) return true;
  if (intent.centralTension && winDrop >= 18) return true;
  if (intent.queenSortie && winDrop >= 18) return true;
  return intent.check || intent.attacksHeavy || intent.pawnTowardKing;
}

/** Major pieces the given side has left attacked with no defender at all. */
export function looseMajorSquares(game: Chess, color: 'w' | 'b'): string[] {
  const opponent = color === 'w' ? 'b' : 'w';
  const squares: string[] = [];
  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece || piece.color !== color || !MAJOR_PIECES.has(piece.type)) continue;
      if (game.attackers(piece.square as Square, opponent).length === 0) continue;
      if (game.attackers(piece.square as Square, color).length > 0) continue;
      squares.push(piece.square);
    }
  }
  return squares;
}

/**
 * True when the move leaves a major piece hanging where nobody defends it.
 *
 * This is the line the model refuses above `HANG_GUARD_ELO`: a rated player's
 * mistake is an idea that fails, not a piece dropped in the middle of nowhere.
 * The escapes are the ones a person really has:
 *
 * - the bot is in check, so it has to answer the check before anything else;
 * - the move gives check, which is a forcing sacrifice rather than a passive
 *   hang;
 * - the piece was already loose before the move, so this move did not create it.
 *
 * A piece something defends is not a free hang either: that is an exchange,
 * which is exactly how the 800-1200 errors are supposed to happen — taking a
 * pawn or piece while walking into a pin, a fork or a trap.
 */
export function freeHangAfter(fen: string, uci: string): boolean {
  const before = new Chess(fen);
  if (before.inCheck()) return false;

  const mover = before.turn();
  const alreadyLoose = new Set(looseMajorSquares(before, mover));
  const after = applyUci(fen, uci);
  if (!after || after.inCheck()) return false;

  return looseMajorSquares(after, mover).some((square) => !alreadyLoose.has(square));
}

/* --------------------------------------------------------------------------
   Selection
   -------------------------------------------------------------------------- */

export type HumanMoveKind = 'forced' | 'recapture' | 'probe' | Bucket;

/** From here down a bot may abandon the model and play a random legal move. */
export const RANDOM_FLOOR_ELO = 400;

/**
 * Chance a sub-400 bot ignores the position entirely.
 *
 * `((400 - elo) / 300) ^ 1.8`: 1.0 at 100 USCF (pure random play), ~0.48 at
 * 200, ~0.14 at 300 and 0 at 400, where the six-bucket model takes over with no
 * random turns at all. The exponent makes the collapse steep at the bottom: a
 * 100 has no model left to fall back on, a 350 almost always plays the model.
 */
export function randomMoveChance(elo: number): number {
  const target = clampElo(elo);
  if (target >= RANDOM_FLOOR_ELO) return 0;
  return Math.pow((RANDOM_FLOOR_ELO - target) / (RANDOM_FLOOR_ELO - ELO_MIN), 1.8);
}

/**
 * The sub-400 random turn, as a roll a caller can take before doing any work.
 *
 * Returns a UCI move when the rating's random roll succeeds, or `null` when this
 * turn belongs to the model. Every entry point that can move a bot —
 * `selectHumanBotMove` and the personality chooser — asks this first, so a 150
 * plays the same way whether or not the bot has a character sheet, and the roll
 * lands before the opening book, the search and the buckets rather than after
 * them.
 *
 * chess.js has no `legalMoves()`; every legal move comes from
 * `moves({ verbose: true })`.
 */
export function rollSub400RandomFloor(
  game: Chess,
  elo: number,
  rng: () => number = Math.random,
): string | null {
  const chance = randomMoveChance(elo);
  if (chance <= 0) return null;
  if (rng() >= chance) return null;

  const legal = game.moves({ verbose: true });
  if (legal.length === 0) return null;
  const index = Math.min(legal.length - 1, Math.floor(rng() * legal.length));
  return uciOf(legal[index]);
}

/**
 * Whether a bot at this rating still reads an opening book.
 *
 * Sub-400 play is the floor of the scale: there is no book and no positional
 * structure, only the random roll above and then whatever the buckets think.
 * A 100 with a clean book would stop behaving like a beginner on move one, so
 * the book is switched off entirely below the floor rather than thinned out.
 */
export function usesOpeningBook(elo: number): boolean {
  return randomMoveChance(elo) === 0;
}

/**
 * Nominal severity booked for a random move.
 *
 * The move is deliberately unjudged — no reference pass runs — so it is booked
 * at the blunder floor rather than at 0, which would let accuracy accounting
 * read a random legal move as if it were the engine's first choice.
 */
export const RANDOM_MOVE_WIN_DROP = 20;

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

/**
 * Beginner top-line suppression: below 1000 USCF the engine's first choice is
 * multiplied by 0.08 and the second by 0.25 on normal turns, so the bot picks a
 * plausible, slightly loose human move instead of echoing Stockfish. Error
 * turns never reach here — they are already band-picked.
 */
export function suppressTopLines(
  weights: readonly WeightedMove[],
  elo: number,
): WeightedMove[] {
  if (clampElo(elo) >= BEGINNER_VULNERABILITY_ELO || weights.length === 0) {
    return weights.map((entry) => ({ ...entry }));
  }

  const copy = weights.map((entry) => ({ ...entry }));
  copy[0] = { ...copy[0], weight: copy[0].weight * BEGINNER_TOP_WEIGHT };
  if (copy.length > 1) {
    copy[1] = { ...copy[1], weight: copy[1].weight * BEGINNER_SECOND_WEIGHT };
  }

  const total = copy.reduce((sum, entry) => sum + entry.weight, 0);
  if (!(total > 0)) return weights.map((entry) => ({ ...entry }));
  return copy.map((entry) => ({ ...entry, weight: entry.weight / total }));
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

  /* 1b. The pure-random floor. Below 400 USCF the bot may ignore the position
     completely and play any legal move, uniformly: no reference pass, no
     bucket, no intent filter. This is the behavioural floor of the scale — a
     100 hangs a piece, walks into a check or pushes a pawn at random, because
     that is what a player who does not yet see the board actually does. */
  const floorMove = rollSub400RandomFloor(game, elo, random);
  if (floorMove !== null) {
    return finish(floorMove, 'blunder', 0, RANDOM_MOVE_WIN_DROP, []);
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

  /* 2. Obvious recapture, at the rating's own rate. An equal trade is taken
     back almost always from 400 USCF up, and the ~1-in-10 the curve leaves
     open is the hidden defender or the intermediate move. A *costly*
     recapture — winning back less than was lost — is the exchange a weaker
     player miscalculates, so it keeps only a share of that chance. */
  const lastCapture = input.lastMove;
  if (lastCapture?.captured && bestRef.uci.slice(2, 4) === lastCapture.to) {
    const trade = recaptureTrade(input.fen, lastCapture, bestRef.uci);
    if (random() < recaptureChance(elo, trade)) {
      return finish(bestRef.uci, 'recapture', 0, 0, [
        { uci: bestRef.uci, weight: 1, cpLoss: 0, winDrop: 0 },
      ]);
    }
  }

  /* From 1000 USCF up a free hang is never rolled: dropping a queen, rook,
     bishop or knight on a square nobody defends is not a mistake a rated player
     makes at random. Errors have to be *tempting* instead — a capture into a trap, a
     queen sortie, central tension. Check replies and checking sacrifices stay
     legal; see `freeHangAfter`. */
  const hangGuarded = elo >= HANG_GUARD_ELO;
  const hangs = new Map<string, boolean>();
  const isFreeHang = (uci: string): boolean => {
    if (!hangGuarded) return false;
    if (!hangs.has(uci)) hangs.set(uci, freeHangAfter(input.fen, uci));
    return hangs.get(uci) === true;
  };

  const safeForElo = (entry: (typeof entries)[number]) =>
    elo < SELF_MATE_GUARD_ELO || !allowsMateInOne(input.fen, entry.uci);
  const guarded = pool.filter(safeForElo);
  const usable = guarded.length > 0 ? guarded : pool;

  /* From 1000 up an error has to look intended. Below 1000 anything goes: that
     is beginner blindness — dropping a piece for no reason, stepping into an
     attacked square, forgetting the recapture. The free-hang floor is the same
     1000, so both rules lift together. */
  const requiresIntent = elo >= TUNNEL_VISION_ELO;
  const deepOnly = elo >= DEEP_SLIP_ELO;
  const intents = new Map<string, MoveIntent | null>();

  const intentFor = (uci: string): MoveIntent | null => {
    if (!intents.has(uci)) intents.set(uci, moveIntent(input.fen, uci));
    return intents.get(uci) ?? null;
  };

  /**
   * How much a candidate looks like a move a human would actually try.
   *
   * Inside an error band this is what stops the model spending a 700's blunder
   * budget on a quiet `Kh1`: a capture or a check is the move that tempts, a
   * queen sortie or a central push is the move that looks active, and a quiet
   * unforced move is the one nobody plays on purpose.
   */
  const temptation = (uci: string): number => {
    const intent = intentFor(uci);
    if (!intent) return 1;
    if (intent.capture || intent.check) return TEMPTATION_BOOST;
    if (intent.attacksHeavy || intent.centralTension || intent.queenSortie) {
      return TEMPTATION_BOOST_MILD;
    }
    return intent.pawnTowardKing ? 1 : TEMPTATION_DAMPING;
  };

  const temptingWeights = (weights: readonly WeightedMove[]): WeightedMove[] => {
    const boosted = weights.map((entry) => ({
      ...entry,
      weight: entry.weight * temptation(entry.uci),
    }));
    const total = boosted.reduce((sum, entry) => sum + entry.weight, 0);
    if (!(total > 0)) return weights.map((entry) => ({ ...entry }));
    return boosted.map((entry) => ({ ...entry, weight: entry.weight / total }));
  };

  const finishedAt = (
    kind: HumanMoveKind,
    from: readonly (typeof entries)[number][],
    boost = 1,
  ) => {
    const raw = softmaxWeights(from, temperature * boost);
    const weights =
      kind === 'good' || kind === 'excellent' || kind === 'best'
        ? raw
        : temptingWeights(raw);
    const chosen = pick(weights, random) ?? weights[0];
    return finish(chosen.uci, kind, chosen.cpLoss, chosen.winDrop, weights);
  };

  const errorAllowed = (entry: (typeof entries)[number]): boolean => {
    if (isFreeHang(entry.uci)) return false;
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

  /* 3. One roll against the six-bucket distribution, then the bucket it names
     is filled from the depth-9 reference pass. */
  const buckets = bucketCandidates(entries);
  const category: Bucket = input.forcedBucket ?? pickCategory(random(), plan.quality);
  const chain = bucketFallbackChain(category, medianBucket(plan.quality));
  const usableUcis = new Set(usable.map((entry) => entry.uci));

  for (const step of chain) {
    const matches = buckets[step].filter(
      (entry) =>
        usableUcis.has(entry.uci) &&
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
          suppressTopLines(softmaxWeights(matches, temperature * boost), elo),
          elo,
        );
        const chosen = pick(weights, random) ?? weights[0];
        return finish(chosen.uci, step, chosen.cpLoss, chosen.winDrop, weights);
      }
      return finishedAt(step, matches, boost);
    }

    /* The engine's list is often too narrow to hold a real error — a quiet
       position has only a few safe moves in it — so a player who should err
       this badly asks the caller to probe off-list candidates instead of
       settling for a milder bucket. The trigger is *no usable member*: an empty
       band, or a band whose every move this rating is not allowed to play.
       Falling through in that case would quietly turn a blunder roll into a
       merely good move, which is the calibration gap this probe exists for. */
    if (
      (step === 'blunder' || step === 'mistake') &&
      input.allowProbe &&
      elo < PROBE_ELO &&
      matches.length === 0
    ) {
      return { ...finish(null, 'probe', 0, 0, []), probeTarget: step };
    }
  }

  /* Nothing in the chain fits the board: take the candidate whose reference win
     drop sits closest to the bucket the roll asked for, but never a free hang. */
  const centre = BUCKET_CENTRES[category];
  const fallbackPool = usable.filter((entry) => !isFreeHang(entry.uci));
  const from = fallbackPool.length > 0 ? fallbackPool : usable;
  const closest = from.reduce((a, b) =>
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

/** Pawn moves from the a-, b-, g- and h-file: the least motivated errors. */
const EDGE_FILES = new Set(['a', 'b', 'g', 'h']);

/**
 * 0 = a capture or a check, 1 = central tension or a heavy attack, 2 = other.
 *
 * Used to order the probe: an error that looks tempting is tried before a move
 * nobody would seriously consider.
 */
export function temptationRank(fen: string, uci: string): number {
  const intent = moveIntent(fen, uci);
  if (!intent) return 3;
  if (intent.capture || intent.check) return 0;
  if (intent.centralTension || intent.attacksHeavy || intent.queenSortie) return 1;
  return 2;
}

/**
 * Moves a human might actually play while missing the point.
 *
 * Groups are offered in the order a tempting move is worth trying: a capture
 * (the greedy grab that fails tactically), a check, a move into central
 * tension, a piece stepped onto an attacked square, a pawn push, then any
 * natural-looking quiet move. Edge pawns sit at the back of the pawn group,
 * because an unmotivated `a2a3` is the least human error on the board.
 *
 * Below 600 USCF this is the beginner's blindness — the error is not a misread
 * idea but a piece left hanging. Above it, `probeErrorMove` filters the free
 * hangs out and orders what is left by `temptationRank`.
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
  const checking = (move: (typeof legal)[number]) => /[+#]/.test(move.san);
  const edgePawn = (move: (typeof legal)[number]) =>
    move.piece === 'p' && EDGE_FILES.has(move.to[0]) ? 1 : 0;
  const byNaturalness = (a: (typeof legal)[number], b: (typeof legal)[number]) =>
    Number(checking(b)) - Number(checking(a)) ||
    edgePawn(a) - edgePawn(b) ||
    centreDistance(a.to) - centreDistance(b.to) ||
    weight(b) - weight(a);

  const groups = [
    /* A capture is the move a player at any level wants to play, and a
       miscalculated trade is what an error is supposed to look like. */
    legal.filter((move) => Boolean(move.captured)).sort(byWeight),
    legal.filter((move) => !move.captured && checking(move)).sort(byNaturalness),
    legal
      .filter(
        (move) =>
          !move.captured &&
          !checking(move) &&
          contestedCentre(game, move.to, mover, opponent),
      )
      .sort(byNaturalness),
    legal.filter((move) => !move.captured && exposed(move)).sort(byWeight),
    legal.filter((move) => !move.captured && move.piece === 'p').sort(byNaturalness),
    legal.filter((move) => !move.captured && !exposed(move)).sort(byNaturalness),
  ];

  /* Round-robin across the groups: taking one group at a time lets six pawn
     pushes fill the list and hides the piece move that actually loses. The
     groups themselves are already in temptation order. */
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
 * Below 600 USCF the pool is spread across ranks 21-32, where a beginner's
 * unprovoked piece drop lives. From 1000 up a free hang is skipped outright,
 * and the remaining candidates are ordered by `temptationRank` — captures and
 * checks first, quiet edge pushes last — so the miss is over-ambition or a
 * miscalculated trade rather than a move nobody would consider.
 *
 * `requireIntent` keeps that filter strict for the club and intermediate bands:
 * only a move with a human point (a capture, a check, a forward push, a heavy
 * attack, central tension or a queen sortie) is probed at all. Below 1000 USCF
 * the caller leaves it off, because beginner blindness is exactly the ability
 * to drop a piece for no reason.
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
    /** Probe only moves with a human point, never a quiet unforced move. */
    requireIntent?: boolean;
  },
): Promise<ProbeErrorResult | null> {
  const scores = [...options.referenceScores.values()];
  if (scores.length === 0) return null;

  const sign = new Chess(fen).turn() === 'w' ? 1 : -1;
  const bestBotPov = Math.max(...scores.map((cp) => sign * cp));
  const bestWin = winProbability(bestBotPov);
  const window = PROBE_WINDOWS[options.target];
  const elo = options.elo ?? ELO_MIN;
  const beginner = elo < BEGINNER_ELO;
  const guarded = elo >= HANG_GUARD_ELO;

  const exclude = options.exclude ?? [...options.referenceScores.keys()];
  const known = new Set(exclude);
  const pool = (options.pool ?? []).filter((uci) => !known.has(uci));
  const limit = options.count ?? (pool.length > 0 ? 10 : 6);
  const ranked = beginner ? spreadPool(pool, limit) : pool.slice(0, limit);
  /* The bottom tier needs a wider net: at 8-12 nodes its own search sees almost
     nothing, so the probe is the only place a genuinely bad move comes from. */
  const extras = elo <= BOTTOM_TIER_ELO ? 12 : 6;
  const moves = [
    ...ranked,
    ...probeMoveCandidates(fen, [...exclude, ...pool], extras),
  ].slice(0, limit + extras);

  /* Above 400 the order is temptation, not rank: try the grab, the check and
     the central push before the quiet moves. Below 600 (but above 400) that
     is the whole difference between a plausible miss and a random pawn push. */
  const ordered = beginner
    ? moves
    : moves
        .map((uci, index) => ({ uci, index, rank: temptationRank(fen, uci) }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map((entry) => entry.uci);

  /* The intent gates inside `hasHumanIntent` ask for a *drop* as well as a
     point, and here the engine decides the drop. Pass the blunder threshold so
     the filter only answers "did this move want to do something", and a greedy
     capture that loses 12% survives instead of being read as unmotivated. */
  const plausible = options.requireIntent
    ? ordered.filter((uci) => {
        const intent = moveIntent(fen, uci);
        return Boolean(intent && hasHumanIntent(intent, PROBE_WINDOWS.blunder.min));
      })
    : ordered;

  let worst: ProbeErrorResult | null = null;
  for (const uci of plausible) {
    if (guarded && freeHangAfter(fen, uci)) continue;
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

  if (!worst) return null;
  /* Below 200 the probe never comes back empty-handed: the worst legal move it
     scored is the move, even when the reference calls it only slightly worse.
     On a quiet board that is exactly the chaotic pawn push "the worst of the
     worst" plays. */
  if (elo <= BOTTOM_TIER_ELO) return worst;
  return worst.winDrop >= PROBE_WINDOWS.mistake.min ? worst : null;
}
