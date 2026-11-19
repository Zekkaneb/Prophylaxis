import { isBlatantMaterialBlunder } from '../blunders.ts';
import { chooseBookMove } from './engine.ts';
import type { BookMove } from './repertoires/book.ts';
import type { PersonalityStyle } from './styles.ts';

/**
 * Edward Chen's character mechanics.
 *
 * Two things live here, both separate from his 800 rating:
 *
 * 1. Low opening familiarity. His repertoire is short by design, and even
 *    inside it he only half-remembers: every prepared move carries a sizeable
 *    chance that he cannot recall the line and simply plays a natural move from
 *    his own reading of the position. Forgetting costs knowledge, never
 *    material — the ordinary engine/personality selection takes the turn, so
 *    the result is an improvised but legal move, not a random one. Unlike Nina's
 *    book, a forgotten ply does not end his book for the game: the next familiar
 *    position is still recognised, which is what a beginner's patchy memory
 *    actually looks like.
 * 2. Beginner-safe mistakes. His error roll is the rating's own curve (about
 *    45% at 800), but a deliberate slip never hands over a piece that is
 *    hanging in plain sight. He overlooks ideas and threats; he does not play
 *    absurd moves.
 */

/** How well Edward recalls his prepared moves. */
export const EDWARD_FAMILIARITY = {
  /** Chance of losing the line on the first move of the game. */
  base: 0.18,
  /** Extra chance per ply beyond `deepAfter`. */
  perPly: 0.03,
  /** Plies he remembers as "the opening" before recall starts to slip. */
  deepAfter: 6,
  /** Recall never falls below this, or the repertoire would be pointless. */
  cap: 0.5,
  /** An offshoot he has not rehearsed is a little harder to remember. */
  branchPenalty: 0.06,
} as const;

/**
 * Chance of forgetting the prepared move in this position.
 *
 * High from the first move on purpose: this is the property that makes him a
 * beginner who has learned a few principles rather than someone with a book.
 */
export function edwardForgetChance(move: BookMove, ply: number): number {
  const depth = Math.max(0, ply - EDWARD_FAMILIARITY.deepAfter) * EDWARD_FAMILIARITY.perPly;
  const branch = move.weight >= 2 ? 0 : EDWARD_FAMILIARITY.branchPenalty;
  return Math.min(
    EDWARD_FAMILIARITY.cap,
    EDWARD_FAMILIARITY.base + depth + branch,
  );
}

export interface EdwardBookChoice {
  move: BookMove | null;
  /** True on the ply where he could not recall the prepared move. */
  forgotten: boolean;
}

/**
 * Chooses a prepared move, or admits he has lost the line.
 *
 * `move: null, forgotten: true` means "play this turn normally". The caller
 * already understands that signal, and no illegal move can come out of here:
 * `chooseBookMove` only ever returns an entry from the validated book.
 */
export function chooseEdwardBookMove(input: {
  moves: readonly BookMove[];
  style: PersonalityStyle;
  /** Plies played so far, used for the recall curve. */
  ply: number;
  random: () => number;
}): EdwardBookChoice {
  if (input.moves.length === 0) return { move: null, forgotten: false };
  const intended = chooseBookMove(input.moves, input.style, input.random);
  if (!intended) return { move: null, forgotten: false };
  if (input.random() < edwardForgetChance(intended, input.ply)) {
    return { move: null, forgotten: true };
  }
  return { move: intended, forgotten: false };
}

/**
 * Whether a rolled mistake is allowed for this character on this turn.
 *
 * Edward only: a slip that leaves a piece hanging in plain sight is dropped and
 * his ordinary (still imperfect) selection takes the turn instead. His
 * beginner-level errors are oversights — a missed threat, a natural-looking
 * move that is not good — not free material. Every other character keeps its
 * unchanged behaviour.
 */
export function edwardAllowsMistake(
  fen: string,
  uci: string,
  style: PersonalityStyle | null | undefined,
): boolean {
  if (style?.id !== 'edward') return true;
  return !isBlatantMaterialBlunder(fen, uci);
}
