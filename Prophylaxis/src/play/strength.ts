import {
  guardsAgainstPieceBlunders,
  isBlatantMaterialBlunder,
} from './blunders.ts';

/**
 * Maps a target rating to how well a bot plays.
 *
 * Every opponent gets a genuinely calculated move: the same deep search, on the
 * same clock budget. Rating is expressed as the chance of a deliberate, visible
 * mistake instead of a shallow search — an unpriced random move was the thing
 * that used to hang pieces and miss mates.
 */

/**
 * Depth ceiling handed to Stockfish for a live move.
 *
 * The clock's `movetime` is the real limit: most searches stop on time around
 * depth 12–16, which is deep enough to see the tactics in the position.
 */
export const SEARCH_DEPTH = 16;

/**
 * Search depth for a target rating.
 *
 * Depth no longer separates the ratings: a 1250 and a 2350 both calculate the
 * move properly. The blunder curve is the strength dial, so a weak move is a
 * decision the bot makes, not an artefact of a search that stopped too early.
 */
export function depthForElo(_elo: number): number {
  return SEARCH_DEPTH;
}

/* --------------------------------------------------------------------------
   Blunder curve
   -------------------------------------------------------------------------- */

/** Rating where the curve is anchored at `BLUNDER_ANCHOR_RATE`. */
const BLUNDER_ANCHOR_ELO = 800;
/** Chance of a deliberate mistake at the anchor rating. */
const BLUNDER_ANCHOR_RATE = 0.45;
/** Every 400 Elo divides the mistake rate by about three (e-folding). */
const BLUNDER_TAU_ELO = 400;
const BLUNDER_MAX_RATE = 0.55;

/**
 * Per-move chance that the bot plays a move it can see is worse.
 *
 * Exponential by design, but the ladder errs on the generous side: about 45% at
 * 800 Elo, 15% at 1250, 7% at 1550, 2% at 2050 and 0.9% at 2200 — roughly one
 * mistake every 110 moves at the top, so the strongest bots still give you a
 * way back into the game.
 */
export function blunderChance(elo: number): number {
  const distance = Math.max(0, elo - BLUNDER_ANCHOR_ELO);
  return Math.min(
    BLUNDER_MAX_RATE,
    BLUNDER_ANCHOR_RATE * Math.exp(-distance / BLUNDER_TAU_ELO),
  );
}

/**
 * How bad a deliberate mistake may be at a rating. A beginner can drop a piece;
 * a 2200 slips into a small inaccuracy and nothing more.
 */
function blunderSeverityCp(elo: number): number {
  if (elo < 1100) return 700;
  if (elo < 1400) return 550;
  if (elo < 1750) return 400;
  if (elo < 2100) return 280;
  return 200;
}

/** Below this gap a choice is not a mistake worth the name. */
const BLUNDER_MIN_GAP_CP = 80;

/** One engine line, scored from White's point of view. */
export interface ScoredCandidate {
  uci: string;
  scoreCp: number;
  /** White's point of view: +N White mates, -N Black mates. */
  mate?: number | null;
}

/**
 * Chooses the mistake for a turn where the blunder roll fired.
 *
 * The move still comes from Stockfish's own MultiPV list, with its score, so it
 * is a plausible human error at the board rather than a random legal move. A
 * line that walks into a forced mate is never chosen, and the permitted loss is
 * capped by rating (see `blunderSeverityCp`). Returns null when no candidate is
 * bad enough, in which case the bot simply plays well.
 */
export function chooseBlunder(
  candidates: readonly ScoredCandidate[],
  sideToMove: 'w' | 'b',
  elo: number,
  random: () => number = Math.random,
  /** The rolled severity band, in centipawns. Omitted by the shared curve. */
  band?: { minGap: number; maxGap: number },
): string | null {
  if (candidates.length === 0) return null;

  const sign = sideToMove === 'w' ? 1 : -1;

  /* A forced mate is not a strength question. No rating throws a mate away on
     purpose, and slipping around one is how a "40-120 cp inaccuracy" turned
     into a 9000 cp trace: the best line was mate and the band pick was anything
     else. Skipping the slip here keeps the error model about chess, not about
     throwing won games. */
  const hasMate =
    candidates.some(
      (candidate) => candidate.mate !== undefined && candidate.mate !== null && sign * candidate.mate > 0,
    ) || candidates.some((candidate) => sign * candidate.scoreCp > 5000);
  if (hasMate) return null;

  const scored = candidates.map((candidate) => ({
    uci: candidate.uci,
    botPov: sign * candidate.scoreCp,
    mated: candidate.mate !== undefined && candidate.mate !== null && sign * candidate.mate < 0,
  }));
  const best = Math.max(...scored.map((entry) => entry.botPov));

  const mistaken = scored
    .filter((entry) => !entry.mated)
    .map((entry) => ({ uci: entry.uci, gap: best - entry.botPov }))
    .filter((entry) => entry.gap >= BLUNDER_MIN_GAP_CP);
  if (mistaken.length === 0) return null;

  /* Prefer a slip inside this rating's severity; if every candidate is worse
     than that, take the mildest one rather than the worst line on the list.
     A caller that rolled a specific bucket passes its band, so the move really
     is the class the roll asked for. */
  const severity = blunderSeverityCp(elo);
  const minGap = band?.minGap ?? BLUNDER_MIN_GAP_CP;
  const maxGap = Math.min(band?.maxGap ?? severity, severity);
  const within = mistaken.filter((entry) => entry.gap >= minGap && entry.gap <= maxGap);
  const pool =
    within.length > 0
      ? within
      : [mistaken.reduce((a, b) => (a.gap <= b.gap ? a : b))];

  return pool[Math.floor(random() * pool.length)]?.uci ?? null;
}

/** One entry of the engine's candidate list; `scoreCp` is White's point of view. */
export type CandidateEntry = string | { uci: string; scoreCp?: number };

/**
 * How much evaluation a deliberately weaker choice may give up. A beginner may
 * drift further than a master, but never into a fresh lost piece.
 */
function lapseGapCp(elo: number): number {
  if (elo < 1200) return 180;
  if (elo < 1600) return 140;
  if (elo < 2000) return 110;
  return 80;
}

/**
 * Picks among the engine's MultiPV candidates. Weaker opponents take the
 * runner-up more often, which creates human-looking inaccuracies without
 * throwing away material at random.
 *
 * When the candidates carry scores, a weaker choice is only allowed while it
 * stays inside `lapseGapCp`, so a "mistake" is a slightly inferior move rather
 * than a lost piece.
 */
export function chooseCandidate(
  candidates: readonly CandidateEntry[],
  elo: number,
  random: () => number = Math.random,
  fen?: string,
): string | null {
  if (candidates.length === 0) return null;

  const entries = candidates.map((candidate) =>
    typeof candidate === 'string' ? { uci: candidate } : candidate,
  );

  /* The General Bot's lower ratings also use this path. Keep the runner-up
     weakness but never deliberately choose a free-piece move when a safe
     candidate is on the list. */
  const pool =
    fen && guardsAgainstPieceBlunders(elo)
      ? entries.filter((entry) => !isBlatantMaterialBlunder(fen, entry.uci))
      : entries;
  const sound = pool.length > 0 ? pool : entries;

  const scored = sound.filter((entry) => typeof entry.scoreCp === 'number');
  const choices =
    scored.length > 0
      ? (() => {
          const best = Math.max(...scored.map((entry) => entry.scoreCp as number));
          const gap = lapseGapCp(elo);
          return sound.filter(
            (entry) =>
              typeof entry.scoreCp !== 'number' || best - entry.scoreCp <= gap,
          );
        })()
      : sound;

  const secondChance = elo < 1200 ? 0.4 : elo < 1700 ? 0.28 : 0.15;
  if (choices.length > 1 && random() < secondChance) return (choices[1] ?? choices[0]).uci;
  return choices[0]?.uci ?? null;
}
