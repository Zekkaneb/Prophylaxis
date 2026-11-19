/**
 * Lesson ⇄ PGN bridge.
 *
 * Lessons are linear by design (a repertoire line, chunked for practice), while
 * PGN is a tree. These two functions are the boundary:
 *
 *   parseLessonPgn  tree → linear mainline (with per-move coaching comments)
 *   lessonToPgn     linear lesson → a valid, re-importable PGN
 *
 * Both go through `src/pgn`, so comments, NAGs and tags survive the trip and
 * the legacy `pgn.parser` export format is preserved.
 */

import { Chess } from 'chess.js';
import { createNode, gameToPgn, mainline, parseSingleGame } from '../pgn/index.ts';
import type { Lesson, LessonMove } from './sampleLessons';

/** Local copy so the lesson layer does not import from a component. */
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface ParsedLessonPgn {
  /** Present only when the PGN starts from a non-standard position. */
  startingFen?: string;
  moves: LessonMove[];
}

/**
 * Parses a PGN into lesson plies.
 *
 * The main line becomes the lesson; variations are counted but not imported —
 * a lesson player steps through one ordered line, and silently flattening a
 * branch would teach the wrong move. (The full tree is still available via
 * `parsePgn` if a future "study" view wants it.)
 *
 * Comments follow PGN semantics: `{ … }` belongs to the move *before* it, which
 * is exactly where the old chess.js `getComments()` attached them. Using our own
 * tree instead means comments written *before* a move land in the right place
 * too, and `[%clk …]` noise is already stripped.
 */
export function parseLessonPgn(pgn: string): ParsedLessonPgn {
  const trimmed = pgn.trim();
  if (!trimmed) throw new Error('Paste a PGN line first.');

  const game = parseSingleGame(trimmed);
  const nodes = mainline(game);
  if (nodes.length === 0) throw new Error('That PGN contains no moves.');

  const headerFen = game.headers.FEN?.trim();
  const startingFen = headerFen && headerFen !== START_FEN ? headerFen : undefined;

  let board: Chess;
  try {
    board = new Chess(startingFen ?? START_FEN);
  } catch {
    throw new Error('That PGN starts from an unreadable FEN position.');
  }

  const moves: LessonMove[] = nodes.map((node) => {
    try {
      const move = board.move(node.san);
      return {
        uci: `${move.from}${move.to}${move.promotion ?? ''}`,
        san: move.san,
        explanation: node.comment,
      };
    } catch {
      // Naming the offending move is far more useful than "invalid PGN".
      throw new Error(`The move "${node.san}" is not legal in this line.`);
    }
  });

  return { startingFen, moves };
}

/**
 * Serialises a lesson to a PGN string.
 *
 * This is the legacy `chapterToPgn` behaviour: Seven Tag Roster, a
 * `[ChapterName]` tag carrying the lesson title, `[SetUp]`/`[FEN]` for custom
 * starts, comments as `{ … }`, and `*` as the result because a repertoire line
 * is not a finished game.
 */
export function lessonToPgn(lesson: Lesson): string {
  const root = createNode();

  // A lesson is a single chain: each move is the only child of the previous.
  let cursor = root;
  for (const move of lesson.moves) {
    const node = createNode(move.san, move.explanation);
    cursor.children.push(node);
    cursor = node;
  }

  return gameToPgn(
    {
      index: 0,
      headers: {
        Event: lesson.title,
        White: lesson.repertoireColor === 'white' ? 'Repertoire' : '?',
        Black: lesson.repertoireColor === 'black' ? 'Repertoire' : '?',
      },
      root,
      result: '*',
      warnings: [],
    },
    {
      startFen: lesson.startingFen ?? null,
      extraTags: { ChapterName: lesson.title },
      // Symbols read better for a human downloading their repertoire.
      annotations: 'symbol',
    },
  );
}

/** Browser download of a lesson as `.pgn` (matches the backup download pattern). */
export function downloadLessonPgn(lesson: Lesson): void {
  const blob = new Blob([lessonToPgn(lesson)], { type: 'application/x-chess-pgn' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${lesson.title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'lesson'}.pgn`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
