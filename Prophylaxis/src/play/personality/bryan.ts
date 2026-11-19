import { Chess } from 'chess.js';
import type { PersonalityStyle } from './styles.ts';

/**
 * Bryan Martinez-Hernandez's stated opening preferences.
 *
 * Only one thing about his openings is a preference of his own rather than
 * shared, immutable book data: against the Sicilian he plays the Alapin, 2.c3.
 * All three strength profiles share it, because it is his repertoire, not a
 * strength setting.
 * His Vienna chapters (as White) come from Brandon's compiled study, his Pirc
 * lines (as Black) from Johnfer's repertoire, and his answer to 1.d4 is the
 * principle-based King's Indian setup in `repertoires/kid.ts`.
 *
 * The Alapin is checked before the book on purpose: Brandon's White book
 * answers 1...c5 with 2.Ne2, and that is Brandon's taste, not Bryan's.
 */

/** The Alapin move, UCI. */
export const BRYAN_ALAPIN_UCI = 'c2c3';

/**
 * Returns the Alapin move when the position is exactly 1.e4 c5 with White to
 * move and 2.c3 is legal.
 *
 * Anything else — a different move order, a position where c2 is empty or the
 * pawn is pinned out of legality — returns null, so the shared book and then
 * the engine decide. A preference must never become an illegal move.
 */
export function bryanAlapinPreference(
  fen: string,
  history: readonly string[],
  style: PersonalityStyle,
): string | null {
  if (
    style.id !== 'bryan' &&
    style.id !== 'bryan-prime' &&
    style.id !== 'bryan-sophomore'
  ) {
    return null;
  }
  if (history.length !== 2 || history[0] !== 'e4' || history[1] !== 'c5') return null;

  const game = new Chess(fen);
  if (game.turn() !== 'w') return null;

  try {
    game.move({ from: 'c2', to: 'c3' });
  } catch {
    return null;
  }

  return BRYAN_ALAPIN_UCI;
}
