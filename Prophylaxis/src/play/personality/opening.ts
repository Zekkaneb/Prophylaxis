/**
 * Opening priority.
 *
 * A character's opening is decided in this order, and only this order:
 *
 * 1. `repertoire` — a prepared move exists for this exact position (the
 *    personality book, or the General Bot's imported course book);
 * 2. `nina-principles` — Nina's Jobava setup or ...d5, whose first moves were
 *    never supplied as PGNs (the rest still passes through engine candidates);
 * 3. `kids-indian` — a principle-based system applies (Sophomore/Junior against
 *    1.d4, whose answer was never supplied as a PGN);
 * 4. `hippo-system` — Monkey's Hippo setup continues after the supplied study
 *    line ends or the opponent deviates from it;
 * 5. `engine` — nothing prepared covers the position, so Stockfish takes over
 *    for the rest of the game.
 *
 * Two things must never happen: an engine search replacing a prepared move, and
 * the rating's blunder roll firing while a prepared plan exists. The roll is a
 * strength handicap for ordinary play, not an opening choice.
 */

import { blunderChance } from '../strength.ts';

export type OpeningSource =
  | 'repertoire'
  | 'nina-principles'
  | 'kids-indian'
  | 'hippo-system'
  | 'engine';

export interface OpeningInput {
  /** A legal prepared move was found for this position. */
  bookMove: boolean;
  /** Nina's Jobava/...d5 principle skeleton applies. */
  ninaPlan?: boolean;
  /** The character's principle-based system applies to this position. */
  kidPlan: boolean;
  /** Monkey's Hippo setup applies to this position. */
  hippoPlan?: boolean;
}

export function openingSource(input: OpeningInput): OpeningSource {
  if (input.bookMove) return 'repertoire';
  if (input.ninaPlan) return 'nina-principles';
  if (input.kidPlan) return 'kids-indian';
  if (input.hippoPlan) return 'hippo-system';
  return 'engine';
}

/** True while the opening is still being played from a prepared plan. */
export function hasPreparedOpening(source: OpeningSource): boolean {
  return source !== 'engine';
}

/**
 * Whether this turn is the bot's deliberate mistake.
 *
 * The rate is the exponential blunder curve in `strength.ts`; the move itself
 * still comes from the engine's candidate list, so the error costs evaluation
 * rather than being an unpriceable random move. Never while theory is
 * available: the repertoire (or the King's Indian preference) is the priority
 * until it runs out.
 */
export function shouldTakeBlunder(
  elo: number,
  random: () => number,
  theoryAvailable: boolean,
  /**
   * A character's own slip rate, for a profile the rating curve cannot express
   * (it floors out at 45%). Omitted by every other caller, so the curve stands.
   */
  chance: number = blunderChance(elo),
): boolean {
  if (theoryAvailable) return false;
  return random() < chance;
}
