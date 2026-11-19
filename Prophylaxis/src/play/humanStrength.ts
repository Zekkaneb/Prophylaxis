import { Chess, type Square } from 'chess.js';

/**
 * Continuous USCF rating calibration for the Elo-rated bots.
 *
 * Two exponential curves replace the old lookup bands:
 *
 * - the **Bad Move Index** `B(elo)` — how often the bot plays something other
 *   than its best move at all;
 * - the **Move Range Index** `R(elo)` — how that error budget is split between
 *   inaccuracies (`?!`, 5-12% win drop), mistakes (`?`, 12-22%) and blunders
 *   (`??`, 22%+).
 *
 * Both are continuous from 400 to 2800 USCF, so every rating on the slider has
 * its own personality: a 400 errs nearly half the time and blunders often, a
 * 2800 errs once in twenty moves and almost never blunders. Rates are then
 * scaled by game phase and time control, because opening moves are cleaner than
 * middlegame moves and a blitz game is worse than a classical one.
 *
 * The engine itself always calculates: every rating searches at its own depth
 * over `MultiPV 10` lines, and the choice among those lines is what changes.
 */

/* --------------------------------------------------------------------------
   Continuous curves
   -------------------------------------------------------------------------- */

export const ELO_MIN = 400;
export const ELO_MAX = 2800;

/** MultiPV width: enough candidates for every win-drop bucket to exist. */
export const HUMAN_MULTI_PV = 10;

/**
 * Below this rating the #1 engine line is damped on solid turns, so a 1100
 * drifts to the #2-#4 human choice instead of echoing Stockfish's top move.
 */
export const TOP_LINE_DRIFT_ELO = 1500;

/** An obvious recapture is taken this often, even by a beginner. */
export const RECAPTURE_CHANCE = 0.93;

/** Below this rating an obvious recapture is fumbled more often. */
export const RECAPTURE_SOFTEN_ELO = 1300;

/** Recapture rate under `RECAPTURE_SOFTEN_ELO`: a 1100 misses one in five. */
export const RECAPTURE_CHANCE_LOW = 0.8;

/** Below this rating the recapture rule is off: a 500 does drop a queen trade. */
export const RECAPTURE_MIN_ELO = 550;

/** From here the bot refuses moves that walk into mate in one. */
export const SELF_MATE_GUARD_ELO = 1000;

/** Depth of the reference pass that re-scores the candidate moves. */
export const REFERENCE_DEPTH = 9;

/** Depth of the off-list probe used to find a real blunder. */
export const PROBE_DEPTH = 8;

/**
 * Shallow width used to collect probe candidates.
 *
 * Ranks 11-32 of a wide shallow search are exactly the "plausible but worse"
 * moves a club player picks: the same search that ranked the top ten, one step
 * further down. Thirty-two covers virtually every legal move in a standard
 * position, so a piece-hanging move the engine ranks 21st-32nd is still
 * available to the probe instead of being closed off by the search width. Only
 * fetched when a probe is actually needed.
 */
export const PROBE_MULTI_PV = 32;

/** From this rating up no off-list blunder probe is run. */
export const PROBE_MAX_ELO = 1500;

/** Win-drop windows a probed off-list move must fall inside to count. */
export const PROBE_WINDOWS = {
  mistake: { min: 12, max: 22 },
  blunder: { min: 22, max: 45 },
} as const;

/**
 * Temperature multiplier for picks inside an error bucket.
 *
 * A softmax tuned for "which move does this player like" pins every error to
 * the mild edge of its band (5.5% drops for a 5-12% inaccuracy), which is not
 * how errors are distributed. Inside a bucket the pick is spread across it.
 */
export const ERROR_TEMPERATURE_BOOST = 6;

/**
 * Wider spread for low-rated error turns.
 *
 * A club player who errs usually errs towards the middle of the band, not its
 * lower edge. Below `POSITIONAL_DRIFT_ELO` the bucket pick is spread harder for
 * that reason.
 */
export const ERROR_TEMPERATURE_BOOST_LOW = 9;

/**
 * Below this rating the bot is a club player, not a weakened engine: the top
 * line is damped further and "not an error" is allowed to mean a 3-5% drift.
 */
export const POSITIONAL_DRIFT_ELO = 1250;

/** Extra multiplier on the solid-turn temperature under `POSITIONAL_DRIFT_ELO`. */
export const SOLID_TEMPERATURE_BOOST_LOW = 2.2;

/** Extra multiplier on the solid-turn temperature under `SOLID_TEMPERATURE_ELO`. */
export const SOLID_TEMPERATURE_BOOST = 1.4;
export const SOLID_TEMPERATURE_ELO = 1300;

/** How much of the top-line weight the club-level drift removes at 400 USCF. */
export const DRIFT_DAMPING_LOW = 0.35;

/** Below this rating the opening phase carries more of the error budget. */
export const OPENING_ELO_SPLIT = 1400;

/** Centre of each severity bucket, used by the distance fallback. */
export const BUCKET_CENTRES = { inaccuracy: 8.5, mistake: 17, blunder: 28 } as const;

/**
 * Chance an obvious recapture is actually taken.
 *
 * A club player takes it most of the time; below 1300 one in five is fumbled,
 * which is the same order as the recapture misses in real games.
 */
export function recaptureChance(elo: number): number {
  return clampElo(elo) < RECAPTURE_SOFTEN_ELO ? RECAPTURE_CHANCE_LOW : RECAPTURE_CHANCE;
}

const LOW_CLOCK_MS = 30_000;
const LOW_INCREMENT_MS = 5_000;
const TROUBLE_DEPTH_CAP = 3;

export interface MoveShares {
  /** `?!`: 5-12% win drop. */
  inaccuracy: number;
  /** `?`: 12-22% win drop. */
  mistake: number;
  /** `??`: 22%+ win drop. */
  blunder: number;
}

export interface HumanCalibration {
  /** Target rating after clamping to the supported range. */
  elo: number;
  /** Normalized skill, 0 at 400 USCF and 1 at 2800. */
  skill: number;
  /** B(elo): probability of playing a suboptimal move. */
  badMoveIndex: number;
  /** R(elo), normalized to sum to 1. */
  shares: MoveShares;
  /** Effective search depth before the time-control offset. */
  depth: number;
  /** Softmax temperature for solid moves. */
  temperature: number;
}

function normalizeShares(blunder: number, mistake: number, inaccuracy: number): MoveShares {
  const total = blunder + mistake + inaccuracy;
  if (!(total > 0)) return { inaccuracy: 1 / 3, mistake: 1 / 3, blunder: 1 / 3 };
  return {
    inaccuracy: inaccuracy / total,
    mistake: mistake / total,
    blunder: blunder / total,
  };
}

/** Clamped target rating. */
export function clampElo(elo: number): number {
  if (!Number.isFinite(elo)) return 1500;
  return Math.min(ELO_MAX, Math.max(ELO_MIN, Math.round(elo)));
}

/**
 * Effective search depth. The curve is deliberately steep near the bottom of
 * the range: an 1100 USCF club player looks 4-5 plies ahead, not 7-8, so the
 * bot stops finding the tactical refutations that made it play like a 1600.
 * The time-control offset is applied before the two-ply floor.
 */
export function humanSearchDepth(elo: number, depthOffset = 0): number {
  const target = clampElo(elo);
  const s = (target - ELO_MIN) / (ELO_MAX - ELO_MIN);
  return Math.max(2, Math.round(2 + Math.pow(s, 1.3) * 12) + depthOffset);
}

/** The continuous calibration for a target rating. */
export function humanCalibration(elo: number): HumanCalibration {
  const target = clampElo(elo);
  const s = (target - ELO_MIN) / (ELO_MAX - ELO_MIN);

  const badMoveIndex = 0.04 + 0.78 * Math.exp(-2.2 * s);
  const rawBlunderShare = 0.005 + 0.55 * Math.exp(-4.2 * s);
  const rawMistakeShare = 0.12 + 0.38 * Math.exp(-1.9 * s);
  const rawInaccuracyShare = Math.max(0.05, 1 - rawBlunderShare - rawMistakeShare);

  return {
    elo: target,
    skill: s,
    badMoveIndex,
    shares: normalizeShares(rawBlunderShare, rawMistakeShare, rawInaccuracyShare),
    depth: humanSearchDepth(target),
    temperature: Math.max(0.2, 1.35 * Math.exp(-1.7 * s)),
  };
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
  /** Multiplies the Bad Move Index. */
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
  /** Effective probability of a suboptimal move this turn. */
  badMoveProb: number;
  /** Severity split after the time-trouble blunder boost, normalized. */
  shares: MoveShares;
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

  const badMoveProb = Math.min(
    0.85,
    calibration.badMoveIndex * phaseMult * timeControl.tcMult * (timeTrouble ? 1.5 : 1),
  );

  /* Time trouble makes the existing errors bigger, not new ones: the blunder
     share is boosted and the three shares are re-normalized. */
  const rawShares = calibration.shares;
  const shares = timeTrouble
    ? normalizeShares(
        rawShares.blunder * 1.6,
        rawShares.mistake,
        rawShares.inaccuracy,
      )
    : rawShares;

  return {
    calibration,
    phase,
    timeControl,
    timeTrouble,
    positionKind: kind,
    depth,
    thinkTimeMs,
    badMoveProb,
    shares,
  };
}

/* --------------------------------------------------------------------------
   Selection
   -------------------------------------------------------------------------- */

export type HumanMoveKind =
  | 'forced'
  | 'recapture'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'solid'
  /** The caller must probe off-list moves for a blunder and then re-select. */
  | 'probe';

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
   * White-POV reference scores by UCI move (the depth-9 second pass). When
   * present, severity — `cpLoss`, `winDrop`, bucket — is judged on these, while
   * the shallow `scoreCp` still decides what the move *looks* like.
   */
  reference?: ReadonlyMap<string, number>;
  /** Allows the selector to ask the caller for an off-list blunder probe. */
  allowProbe?: boolean;
  /** A bucket the caller already rolled, so a retry does not re-roll. */
  forcedBucket?: Exclude<Bucket, 'solid'>;
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
 * Multiplier on the softmax weight of the #1 engine move: 0.36 at 400 USCF,
 * 0.67 at 1100, and no damping at all from 1500 up.
 *
 * The extra damping under `POSITIONAL_DRIFT_ELO` fades to nothing at the
 * boundary — the `gap / (gap + 0.1)` shape has no cusp, so the curve stays
 * smooth and continuous: a club player's quiet move is a shade worse than
 * Stockfish's, not a copy of it.
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

export type Bucket = 'inaccuracy' | 'mistake' | 'blunder' | 'solid';

/** Splits one Move Range Index roll into a severity bucket. */
export function pickCategory(roll: number, shares: MoveShares): Bucket {
  if (roll < shares.inaccuracy) return 'inaccuracy';
  if (roll < shares.inaccuracy + shares.mistake) return 'mistake';
  return 'blunder';
}

/** Win-drop classification used by the Move Range Index. */
export function bucketFor(winDrop: number): Bucket {
  if (winDrop >= 22) return 'blunder';
  if (winDrop >= 12) return 'mistake';
  if (winDrop >= 5) return 'inaccuracy';
  return 'solid';
}

/**
 * Chooses the bot's move from the engine's MultiPV list.
 *
 * One roll decides whether this turn is suboptimal at all (`badMoveProb`); if
 * it is, a second roll against the Move Range Index picks how bad. A solid turn
 * draws from the moves under 5% win drop with softmax weighting, so the #1
 * move dominates for a 2800 and merely leads for a 400.
 */
export function selectHumanBotMove(input: HumanMoveInput): HumanMoveChoice {
  const random = input.random ?? Math.random;
  const plan = input.plan ?? planHumanSearch(input);
  const game = new Chess(input.fen);
  const legal = game.moves({ verbose: true });
  const sign = game.turn() === 'w' ? 1 : -1;
  const temperature = plan.calibration.temperature;

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
      const referenceCp=
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

  /* `best` is the shallow top line (what the human is drawn to); `bestRef` is
     the move the reference search says is actually best. */
  const best = candidates[0];
  const bestRef = candidates.reduce((a, b) => (b.refBotPov > a.refBotPov ? b : a));
  const bestRefWin = winProbability(bestRef.refBotPov);
  const entries = candidates.map((candidate) => ({
    uci: candidate.uci,
    cpLoss: Math.max(0, Math.round(bestRef.refBotPov - candidate.refBotPov)),
    shallowLoss: Math.max(0, Math.round(best.botPov - candidate.botPov)),
    winDrop: Math.max(0, Math.round((bestRefWin - winProbability(candidate.refBotPov)) * 10) / 10),
    mated: candidate.mate !== null && candidate.mate < 0,
  }));
  const playable = entries.filter((entry) => !entry.mated);
  const pool = playable.length > 0 ? playable : entries;

  /* 2. Obvious recapture. */
  const lastCapture = input.lastMove;
  if (
    lastCapture?.captured &&
    input.elo >= RECAPTURE_MIN_ELO &&
    bestRef.uci.slice(2, 4) === lastCapture.to
  ) {
    if (random() < recaptureChance(input.elo)) {
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

  /* 3. A suboptimal turn: pick the severity bucket from the Move Range Index
     (inaccuracy -> mistake -> blunder), then fall back down the chain when this
     position has nothing that bad to offer. */
  const rolled = input.forcedBucket !== undefined || random() < plan.badMoveProb;
  if (rolled) {
    const category: Bucket =
      input.forcedBucket ?? pickCategory(random(), plan.shares);

    const safeForElo = (entry: (typeof entries)[number]) =>
      input.elo < SELF_MATE_GUARD_ELO || !allowsMateInOne(input.fen, entry.uci);

    const chain: Bucket[] =
      category === 'blunder'
        ? ['blunder', 'mistake', 'inaccuracy']
        : category === 'mistake'
          ? ['mistake', 'inaccuracy']
          : ['inaccuracy'];

    for (const step of chain) {
      let matches = pool.filter((entry) => bucketFor(entry.winDrop) === step);
      /* A mate-in-one blunder is not a human blunder once past club level: it
         is only allowed when nothing else in the bucket exists. */
      if (step === 'blunder') {
        const safe = matches.filter(safeForElo);
        if (safe.length > 0) matches = safe;
      }
      /* Inside a bucket the spread is what makes the error human-sized: a 5-12%
         inaccuracy should average around 8.5%, not hug its lower edge. */
      if (matches.length > 0) return finishedAt(step, matches, errorTemperatureBoost(input.elo));

      /* The engine's own lines are all reasonable here. A sub-1500 player who
         should err this badly really does hang something, so ask the caller to
         probe off-list moves instead of settling for a milder error. */
      if (
        (step === 'blunder' || step === 'mistake') &&
        input.allowProbe &&
        plan.calibration.elo < PROBE_MAX_ELO
      ) {
        return { ...finish(null, 'probe', 0, 0, []), probeTarget: step };
      }
    }

    /* Nothing in the chain fits the board: take the candidate whose reference
       win drop sits closest to the bucket the roll asked for, so an attempted
       mistake is still mistake-sized instead of whatever the list ends with. */
    const centre = BUCKET_CENTRES[category as Exclude<Bucket, 'solid'>];
    const closest = pool.reduce((a, b) =>
      Math.abs(b.winDrop - centre) < Math.abs(a.winDrop - centre) ? b : a,
    );
    return finishedAt(bucketFor(closest.winDrop), [closest]);
  }

  /* 4. Solid turn: only moves under a 5% win drop, softmax weighted. Below
     1500 USCF the #1 line is damped, so the bot drifts to a playable #2-#4
     human move instead of playing Stockfish's first choice every time. Under
     1300 the whole pool is flatter still: "not an error" is not the same as
     "the engine's move", and a club player's quiet move is usually a shade
     worse than the best one. */
  const solid = pool.filter((entry) => bucketFor(entry.winDrop) === 'solid');
  const solidBoost =
    plan.calibration.elo < POSITIONAL_DRIFT_ELO
      ? SOLID_TEMPERATURE_BOOST_LOW
      : plan.calibration.elo < SOLID_TEMPERATURE_ELO
        ? SOLID_TEMPERATURE_BOOST
        : 1;
  const solidTemperature = temperature * solidBoost;
  const weights = dampTopLine(
    softmaxWeights(solid.length > 0 ? solid : pool.slice(0, 1), solidTemperature),
    plan.calibration.elo,
  );
  const chosen = pick(weights, random) ?? weights[0];
  return finish(chosen.uci, 'solid', chosen.cpLoss, chosen.winDrop, weights);
}

/** The opponent's last move when it was a capture. */
export function lastCaptureOf(game: Chess): LastCapture | null {
  const history = game.history({ verbose: true });
  const last = history[history.length - 1];
  if (!last?.captured) return null;
  return { to: last.to, captured: last.captured };
}

/* --------------------------------------------------------------------------
   Second pass: reference truth and the off-list blunder probe
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
 * all look nearly equal and the severity buckets stay empty. Evaluating the
 * resulting positions at a fixed deeper depth restores the real spread.
 * Returns White-POV scores by UCI move, matching `EngineCandidate.scoreCp`.
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
 * Moves a human might actually play while missing the point.
 *
 * In order: a capture that loses material, a piece stepped onto an attacked
 * square, a pawn push, then any natural-looking quiet move (checks first, then
 * central squares). The last group matters because a club player's blunder is
 * often a perfectly normal-looking developing move that drops a piece to a
 * tactic — those are not "exposed" at the moment they are played.
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
 * The probe only scores a bounded number of moves, so taking the first N of a
 * 32-line search would only ever look at ranks 11-20 — the shallow end that
 * rarely holds the piece-hanging move. Sampling evenly keeps the deep tail
 * (ranks 21-32) in play.
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
 * lands in the requested window. This is the piece a club player forgets is
 * hanging, or the natural move that walks into the tactic.
 *
 * When nothing lands inside the window, the largest error seen is returned as
 * long as it is at least inaccuracy-sized — a probe never hands back a good
 * move just because the window was missed.
 */
export async function probeErrorMove(
  engine: ReferenceEngine,
  fen: string,
  options: {
    referenceScores: ReadonlyMap<string, number>;
    target: 'mistake' | 'blunder';
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

  const exclude = options.exclude ?? [...options.referenceScores.keys()];
  const known = new Set(exclude);
  const pool = (options.pool ?? []).filter((uci) => !known.has(uci));
  const limit = options.count ?? (pool.length > 0 ? 10 : 6);
  const moves = [
    ...spreadPool(pool, limit),
    ...probeMoveCandidates(fen, [...exclude, ...pool], 6),
  ].slice(0, limit + 6);

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
