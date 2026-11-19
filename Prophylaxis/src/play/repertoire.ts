import type { PgnCourseRecord } from '../courses/types.ts';
import type { PlayColor } from './types.ts';

/**
 * Opening book built from the user's imported courses.
 *
 * The General Bot follows the repertoire it finds in the library: every course
 * ply played by the bot's colour becomes a candidate for the position before
 * it. Walking those positions is exactly "play the chosen line until it ends" —
 * once a position is not in the book, the bot falls back to the engine.
 *
 * Keying by FEN (rather than by chapter) also makes transpositions work and lets
 * lines coexist without picking a "chapter" up front.
 */

export type RepertoireBook = Map<string, string[]>;

/** FEN without the half-move/full-move counters, so equivalent positions match. */
export function normalizeFen(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(' ');
}

export function buildRepertoireBook(
  courses: readonly PgnCourseRecord[],
  color: PlayColor,
): RepertoireBook {
  const book: RepertoireBook = new Map();

  for (const course of courses) {
    for (const chapter of course.chapters) {
      for (const ply of chapter.plies) {
        if (ply.color !== color || !ply.uci) continue;
        const key = normalizeFen(ply.fen_before);
        const moves = book.get(key);
        if (!moves) {
          book.set(key, [ply.uci]);
        } else if (!moves.includes(ply.uci)) {
          moves.push(ply.uci);
        }
      }
    }
  }

  return book;
}

/** A random eligible repertoire move for this position, or null when out of book. */
export function pickRepertoireMove(
  book: RepertoireBook,
  fen: string,
  random: () => number = Math.random,
): string | null {
  const moves = book.get(normalizeFen(fen));
  if (!moves || moves.length === 0) return null;
  const index = Math.min(moves.length - 1, Math.floor(random() * moves.length));
  return moves[index] ?? moves[0];
}
