import { Chess } from 'chess.js';
import { isBlatantMaterialBlunder } from '../blunders.ts';
import {
  candidateGapForElo,
  chooseBookMove,
  describeMove,
  type MoveFeatures,
  type PersonalityCandidate,
  type SelectionResult,
} from './engine.ts';
import type { BookMove } from './repertoires/book.ts';
import type { PersonalityStyle } from './styles.ts';

/**
 * Brandon Tran (Freshman), 1600 — the funky attacker.
 *
 * Three behaviours live here, deliberately separate from his strength:
 *
 * 1. Opening recall that is not Prime's. He shares Prime's Vienna and French
 *    chapters, but he has only *studied* them rather than rehearsed them: the
 *    chance of losing a prepared move is its own scale (Vienna best known,
 *    French moderate, the hand-written mainlines basic) and, like Faadi and
 *    Edward, forgetting costs that one ply, never the whole game.
 * 2. A funk bonus on candidate moves. He likes checks, pieces landing next to
 *    the enemy king, pawns crossing the middle and speculative sacrifices, and
 *    he is cold on trades and on tucking his own king away. The bonus is a
 *    handful of centipawns — enough to reorder moves the rating already
 *    considers playable, never enough to rescue a lost position.
 * 3. Occasional speculation. Every so often he takes the most ambitious idea
 *    in the list instead of the best one, which is how a 1600 overestimates his
 *    own attack: the move is still legal, still from the engine's MultiPV list,
 *    and still bounded by his Elo gap plus one pawn of optimism.
 *
 * Nothing here invents moves: no random-legal generator, and a candidate that
 * simply hands over material without attacking anything is refused outright.
 */

export type BrandonFreshmanFamily = 'vienna' | 'french' | 'mainline';

/**
 * Recall by chapter family. Opening familiarity is *not* the rating: the same
 * numbers apply whatever Elo he is given, and they say which chapters he has
 * looked at rather than how strong he is.
 */
export const BRANDON_FRESHMAN_FAMILIARITY = {
  /** Prime's Vienna chapters, studied and played a lot: rarely forgotten. */
  vienna: { base: 0.015, perPly: 0.008, cap: 0.09 },
  /** The French: recognisable structures, remembered well but not perfectly. */
  french: { base: 0.04, perPly: 0.012, cap: 0.18 },
  /** Hand-written mainlines: a basic knowledge of the ideas, not the moves. */
  mainline: { base: 0.1, perPly: 0.02, cap: 0.3 },
  /** Offshoots inside a chapter are remembered less well than its trunk. */
  branchPenalty: 0.03,
  /** Recall fades once the line runs past the part he actually studies. */
  deepAfter: 6,
} as const;

export function brandonFreshmanFamily(move: BookMove): BrandonFreshmanFamily {
  if (move.lineIds.some((id) => id.startsWith('brandon-vienna-'))) return 'vienna';
  if (move.lineIds.some((id) => id.startsWith('brandon-french-'))) return 'french';
  return 'mainline';
}

/** Chance of losing the prepared move in this position. */
export function brandonFreshmanForgetChance(move: BookMove, ply: number): number {
  const family = BRANDON_FRESHMAN_FAMILIARITY[brandonFreshmanFamily(move)];
  const depth = Math.max(0, ply - BRANDON_FRESHMAN_FAMILIARITY.deepAfter);
  const branch = move.weight >= 2 ? 0 : BRANDON_FRESHMAN_FAMILIARITY.branchPenalty;
  /* A move that appears in several study chapters is stickier, but the credit
     is capped: one trunk move can carry hundreds of chapter ids. */
  const rehearsal = Math.min(0.02, Math.max(0, move.lineIds.length - 1) * 0.002);
  return Math.min(
    family.cap,
    Math.max(0.005, family.base + depth * family.perPly + branch - rehearsal),
  );
}

export interface BrandonFreshmanBookChoice {
  move: BookMove | null;
  /** True only on the ply where he could not recall the prepared move. */
  forgotten: boolean;
}

export function chooseBrandonFreshmanBookMove(input: {
  moves: readonly BookMove[];
  style: PersonalityStyle;
  ply: number;
  random: () => number;
}): BrandonFreshmanBookChoice {
  if (input.moves.length === 0) return { move: null, forgotten: false };
  const intended = chooseBookMove(input.moves, input.style, input.random);
  if (!intended) return { move: null, forgotten: false };
  if (input.random() < brandonFreshmanForgetChance(intended, input.ply)) {
    return { move: null, forgotten: true };
  }
  return { move: intended, forgotten: false };
}

/* --------------------------------- funk ----------------------------------- */

/**
 * The taste that makes him funky rather than merely weak.
 *
 * These are centipawns added to a candidate's score, so they only matter where
 * the engine already rates two moves as close. `accuracyRelief` scales how much
 * of the evaluation gap he actually feels: at 1600 the rating's accuracy is
 * already lower than Prime's, and this lets that gap weigh even less when a
 * move looks like an attack.
 */
export const BRANDON_FRESHMAN_FUNK = {
  speculationChance: 0.16,
  sacrificeBonus: 14,
  checkBonus: 9,
  kingBonus: 11,
  advanceBonus: 5,
  developBonus: 2,
  tradePenalty: 8,
  castlePenalty: 5,
  quietPenalty: 3,
  accuracyRelief: 0.55,
  speculativeAllowance: 70,
  tieMargin: 6,
} as const;

/** How much he likes the look of one move, in centipawns. */
export function brandonFreshmanFunkScore(features: MoveFeatures): number {
  let score = 0;
  if (features.sacrifices) score += BRANDON_FRESHMAN_FUNK.sacrificeBonus;
  if (features.check) score += BRANDON_FRESHMAN_FUNK.checkBonus;
  if (features.attacksKing) score += BRANDON_FRESHMAN_FUNK.kingBonus;
  if (features.toEnemyHalf && !features.capture) score += BRANDON_FRESHMAN_FUNK.advanceBonus;
  if (features.develops) score += BRANDON_FRESHMAN_FUNK.developBonus;
  if (features.trades) score -= BRANDON_FRESHMAN_FUNK.tradePenalty;
  if (features.castle) score -= BRANDON_FRESHMAN_FUNK.castlePenalty;
  if (!features.check && !features.capture && !features.sacrifices && !features.toEnemyHalf) {
    score -= BRANDON_FRESHMAN_FUNK.quietPenalty;
  }
  return score;
}

/**
 * Whether an ambitious candidate is allowed.
 *
 * A speculative sacrifice that lands a check or reaches the enemy king is a
 * plausible attacking idea, so it may be played even when the static guard sees
 * free material. Anything else that obviously hangs a piece is refused: his
 * overreach is a failed attack, not a handed-over queen.
 */
export function brandonFreshmanAllowsMove(
  fen: string,
  uci: string,
  features: MoveFeatures | null,
): boolean {
  if (!isBlatantMaterialBlunder(fen, uci)) return true;
  return Boolean(features && features.sacrifices && (features.check || features.attacksKing));
}

interface Evaluated {
  uci: string;
  botPov: number;
  botMate: number | null;
  features: MoveFeatures;
  gap: number;
  funk: number;
}

/**
 * Style-aware pick among the engine's candidates.
 *
 * Returns null for every other character (and whenever the position is already
 * decided by a mate), so the shared scorer keeps full control of everyone else.
 */
export function chooseBrandonFreshmanMove(input: {
  fen: string;
  candidates: readonly PersonalityCandidate[];
  style: PersonalityStyle;
  elo: number;
  random?: () => number;
}): SelectionResult | null {
  const { fen, candidates, style, elo } = input;
  if (style.id !== 'brandon-freshman') return null;
  const random = input.random ?? Math.random;

  const game = new Chess(fen);
  const sign = game.turn() === 'w' ? 1 : -1;

  const legal: Evaluated[] = [];
  for (const candidate of candidates) {
    const features = describeMove(fen, candidate.uci);
    if (!features) continue;
    legal.push({
      uci: candidate.uci,
      botPov: sign * candidate.scoreCp,
      botMate: candidate.mate === null ? null : sign * candidate.mate,
      features,
      gap: 0,
      funk: brandonFreshmanFunkScore(features),
    });
  }
  if (legal.length === 0) return null;

  /* A forced mate is not a style question; the shared scorer takes it. */
  if (legal.some((entry) => entry.botMate !== null && entry.botMate > 0)) return null;

  const bestPov = Math.max(...legal.map((entry) => entry.botPov));
  const allowance = candidateGapForElo(elo) + BRANDON_FRESHMAN_FUNK.speculativeAllowance;
  const playable = legal
    .map((entry) => ({ ...entry, gap: bestPov - entry.botPov }))
    .filter(
      (entry) =>
        entry.gap <= allowance &&
        entry.botMate === null &&
        brandonFreshmanAllowsMove(fen, entry.uci, entry.features),
    );
  if (playable.length === 0) return null;

  const score = (entry: Evaluated) =>
    -entry.gap * style.accuracy * BRANDON_FRESHMAN_FUNK.accuracyRelief + entry.funk;

  const finish = (entry: Evaluated): SelectionResult => ({
    uci: entry.uci,
    gap: Math.max(0, Math.round(entry.gap)),
    features: entry.features,
    best: entry.gap <= 1,
  });

  /* The speculative turn: the boldest idea the position can just about carry,
     instead of the one the engine likes most. */
  if (random() < BRANDON_FRESHMAN_FUNK.speculationChance) {
    const ambitious = playable
      .filter(
        (entry) =>
          entry.funk >= BRANDON_FRESHMAN_FUNK.checkBonus &&
          (entry.features.sacrifices || entry.features.check || entry.features.attacksKing),
      )
      .sort((a, b) => b.funk - a.funk || a.gap - b.gap);
    const pick = ambitious[0];
    /* Never a losing move: only a plausible one he has talked himself into. */
    if (pick && pick.gap <= candidateGapForElo(elo)) return finish(pick);
  }

  const ranked = [...playable].sort((a, b) => score(b) - score(a));
  const top = ranked[0];
  const rivals = ranked.filter(
    (entry) => score(top) - score(entry) <= BRANDON_FRESHMAN_FUNK.tieMargin,
  );
  const chosen =
    rivals.length > 1 && random() < 0.5
      ? rivals[Math.min(rivals.length - 1, Math.floor(random() * rivals.length))]
      : top;

  return finish(chosen);
}

/**
 * Whether a rolled mistake is allowed for this character.
 *
 * Prime Brandon keeps the unchanged rating curve. Freshman Brandon's slip is an
 * oversight inside his own attack, so a move that simply hands over material
 * with nothing to show for it is dropped and his ordinary selection plays
 * instead — his overambition already comes from the funk roll.
 */
export function brandonFreshmanAllowsMistake(
  fen: string,
  uci: string,
  style: PersonalityStyle | null | undefined,
): boolean {
  if (style?.id !== 'brandon-freshman') return true;
  return brandonFreshmanAllowsMove(fen, uci, describeMove(fen, uci));
}
