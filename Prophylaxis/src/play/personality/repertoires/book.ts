import { Chess } from 'chess.js';
import type { PlayColor } from '../../types.ts';
import type { OpeningTag } from '../styles.ts';
import type { OpeningLine, PersonalityRepertoire } from './types.ts';

/**
 * Opening book for one personality.
 *
 * The declarations are written as whole SAN lines; this builder replays each
 * line and registers every move the character itself makes under the FEN it
 * was made from. Three useful properties fall out of that:
 *
 * - Shared stems and branches merge automatically: the first move of a Ruy
 *   Lopez and its Berlin offshoot are the same book entry.
 * - Transpositions work: two move orders that reach the same position key the
 *   same entry, so the character recognises the position rather than the line.
 * - Deviations end the book: a position that never appears has no entry, and
 *   the caller falls straight through to the engine.
 */

export interface BookMove {
  uci: string;
  san: string;
  /** Lines this move belongs to (kept for tests and debugging). */
  lineIds: string[];
  tags: OpeningTag[];
  weight: number;
}

export type PersonalityBook = Map<string, BookMove[]>;

/**
 * Book key: board, side to move and castling rights.
 *
 * En passant is deliberately dropped. It changes between move orders that
 * reach the same position (after 1.d4 d5 2.c4 vs 1.c4 d5 2.d4), which would
 * otherwise defeat the transposition matching the book exists to provide. Any
 * move taken from the book is still validated against the live position, so a
 * merged key can never produce an illegal move.
 */
export function bookKey(fen: string): string {
  const [board, turn, castling] = fen.trim().split(/\s+/);
  return `${board} ${turn} ${castling}`;
}

export interface BookIssue {
  lineId: string;
  ply: number;
  san: string;
  message: string;
}

export interface BuiltBook {
  book: PersonalityBook;
  issues: BookIssue[];
}

function mergeMove(target: BookMove, source: BookMove): void {
  target.weight = Math.max(target.weight, source.weight);
  for (const id of source.lineIds) {
    if (!target.lineIds.includes(id)) target.lineIds.push(id);
  }
  for (const tag of source.tags) {
    if (!target.tags.includes(tag)) target.tags.push(tag);
  }
}

export function buildPersonalityBook(
  lines: readonly OpeningLine[],
  color: PlayColor,
): BuiltBook {
  const book: PersonalityBook = new Map();
  const issues: BookIssue[] = [];

  for (const line of lines) {
    const game = new Chess();
    for (let index = 0; index < line.san.length; index += 1) {
      const san = line.san[index];
      const fenBefore = game.fen();
      let applied;
      try {
        applied = game.move(san);
      } catch {
        issues.push({
          lineId: line.id,
          ply: index,
          san,
          message: 'Illegal SAN in repertoire declaration.',
        });
        break;
      }
      if (!applied) {
        issues.push({
          lineId: line.id,
          ply: index,
          san,
          message: 'Repertoire move was rejected by chess.js.',
        });
        break;
      }

      if (applied.color !== color) continue;

      const key = bookKey(fenBefore);
      const uci = `${applied.from}${applied.to}${applied.promotion ?? ''}`;
      const entry: BookMove = {
        uci,
        san: applied.san,
        lineIds: [line.id],
        tags: line.tags ? [...line.tags] : [],
        weight: line.weight ?? 1,
      };

      const list = book.get(key);
      if (!list) {
        book.set(key, [entry]);
        continue;
      }
      const existing = list.find((move) => move.uci === uci);
      if (existing) mergeMove(existing, entry);
      else list.push(entry);
    }
  }

  return { book, issues };
}

/** Book moves for a position, without checking legality. */
export function findBookMoves(book: PersonalityBook, fen: string): BookMove[] {
  return book.get(bookKey(fen)) ?? [];
}

/**
 * Book moves filtered against the actual position.
 *
 * The declaration is static and tested, but this guard means a future edit can
 * never make the bot attempt an illegal move: if it is not in `game.moves()`,
 * it is not offered.
 */
export function legalBookMoves(
  book: PersonalityBook,
  game: Chess,
): BookMove[] {
  const legal = new Set(
    game.moves({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion ?? ''}`),
  );
  return findBookMoves(book, game.fen()).filter((move) => legal.has(move.uci));
}

export function booksForRepertoire(
  repertoire: PersonalityRepertoire,
): Record<PlayColor, BuiltBook> {
  return {
    w: buildPersonalityBook(repertoire.asWhite, 'w'),
    b: buildPersonalityBook(repertoire.asBlack, 'b'),
  };
}
