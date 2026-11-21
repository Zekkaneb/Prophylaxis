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
  /**
   * Plies already played when the source chapter began; absent means a chapter
   * that starts from the standard position. A chapter compiled from a mid-line
   * FEN keeps its knowledge for the depth it was written for and cannot answer
   * a shallower game that happens to reach the same board.
   */
  minPly?: number;
}

export type PersonalityBook = Map<string, BookMove[]>;

/**
 * Book key: board, side to move, castling rights, and en passant *when it can
 * actually be used*.
 *
 * En passant is normally dropped: it differs between move orders that reach the
 * same position (after 1.d4 d5 2.c4 vs 1.c4 d5 2.d4), which would otherwise
 * defeat the transposition matching the book exists to provide. The exception is
 * the one case where the field changes the legal moves — a pawn that may be
 * captured en passant. There the target is part of the position, so a key that
 * ignored it let a book entry requiring `dxe3` match a board where that capture
 * is impossible. Positions whose ep target exists but is not capturable (no
 * adjoining pawn, or the capture would leave the king in check) key identically
 * to the same position without the target, so nothing is split needlessly.
 */
export function bookKey(fen: string): string {
  const [board, turn, castling] = fen.trim().split(/\s+/);
  const ep = capturableEnPassant(fen);
  return ep ? `${board} ${turn} ${castling} ${ep}` : `${board} ${turn} ${castling}`;
}

/**
 * The en passant target of `fen` when a legal en passant capture exists, else
 * null.
 */
export function capturableEnPassant(fen: string): string | null {
  const target = fen.trim().split(/\s+/)[3];
  if (!target || target === '-') return null;
  let game: Chess;
  try {
    game = new Chess(fen);
  } catch {
    return null;
  }
  return game.moves({ verbose: true }).some((move) => move.flags.includes('e'))
    ? target
    : null;
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
 * it is not offered. A move compiled from a mid-line chapter is also withheld
 * until the game has reached at least the depth that chapter began at.
 */
export function legalBookMoves(
  book: PersonalityBook,
  game: Chess,
): BookMove[] {
  const legal = new Set(
    game.moves({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion ?? ''}`),
  );
  const plies = game.history().length;
  return findBookMoves(book, game.fen()).filter(
    (move) => legal.has(move.uci) && plies >= (move.minPly ?? 0),
  );
}

export function booksForRepertoire(
  repertoire: PersonalityRepertoire,
): Record<PlayColor, BuiltBook> {
  return {
    w: buildPersonalityBook(repertoire.asWhite, 'w'),
    b: buildPersonalityBook(repertoire.asBlack, 'b'),
  };
}
