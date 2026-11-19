import { isBlatantMaterialBlunder } from '../blunders.ts';
import { chooseBookMove } from './engine.ts';
import type { BookMove } from './repertoires/book.ts';
import type { PersonalityStyle } from './styles.ts';

/**
 * Faadi Granillo Garcia's character mechanics.
 *
 * Two behaviours live here, deliberately separate from his strength:
 *
 * 1. Improvised openings. His English, Caro-Kann and Slav lines are known
 *    loosely: the deeper the line runs and the less habitual the branch, the
 *    likelier he forgets the continuation and simply plays a natural move from
 *    his own evaluation. Forgetting is not the blunder roll — the ordinary
 *    engine/personality selection takes over, so a lost line costs knowledge,
 *    not material.
 * 2. Recognisable mistakes. His error roll is the rating's, but a deliberate
 *    slip never leaves a piece hanging in plain sight: the wildcard misses
 *    ideas, he does not hand over a queen he can see.
 *
 * The chaos in his play comes from the tendency profile (high complexity and
 * risk, low positional patience, loose material), never from a random-move
 * generator.
 */

export interface FaadiBookChoice {
  move: BookMove | null;
  /** True on the ply where he could not recall the prepared move. */
  forgotten: boolean;
}

/**
 * Chance of forgetting the prepared move in this position.
 *
 * Main-line entries (weight 3) are remembered better than offshoots, recall
 * fades as the line deepens, and lines he has rehearsed through several
 * transpositions are stickier. Capped well below certainty: most games he stays
 * in book, and a forgotten ply does not end his book for the game — the next
 * familiar position is still recognised.
 */
export function faadiForgetChance(move: BookMove, ply: number): number {
  const branch = move.weight >= 3 ? 0 : 0.06;
  const depth = Math.max(0, ply - 4) * 0.012;
  const rehearsal = Math.max(0, move.lineIds.length - 1) * 0.05;
  return Math.min(0.3, Math.max(0, 0.04 + branch + depth - rehearsal));
}

/**
 * Chooses a prepared move, or admits he has lost the line.
 *
 * A `move: null, forgotten: true` answer is the signal the caller already
 * understands: play this turn normally instead. No illegal move can come out of
 * here — `chooseBookMove` only ever returns an entry from the validated book.
 */
export function chooseFaadiBookMove(input: {
  moves: readonly BookMove[];
  style: PersonalityStyle;
  /** Plies played so far, used for the recall curve. */
  ply: number;
  random: () => number;
}): FaadiBookChoice {
  if (input.moves.length === 0) return { move: null, forgotten: false };
  const intended = chooseBookMove(input.moves, input.style, input.random);
  if (!intended) return { move: null, forgotten: false };
  if (input.random() < faadiForgetChance(intended, input.ply)) {
    return { move: null, forgotten: true };
  }
  return { move: intended, forgotten: false };
}

/**
 * Whether a rolled mistake is allowed for this character on this turn.
 *
 * Faadi only: an error that walks into free material for the opponent is
 * dropped and his normal (still imperfect) selection takes the turn instead.
 * Every other personality keeps the unchanged behaviour, so their rating
 * curves are untouched.
 */
export function faadiAllowsMistake(
  fen: string,
  uci: string,
  style: PersonalityStyle | null | undefined,
): boolean {
  if (style?.id !== 'faadi') return true;
  return !isBlatantMaterialBlunder(fen, uci);
}
