/**
 * Puzzle validation.
 *
 * Everything that answers "is this a solvable puzzle?" is answered by replaying
 * the sequence with chess.js — the same rules implementation the board and the
 * quiz use. No second rules engine, and no engine evaluation: a puzzle is valid
 * when every UCI move is legal from the stated FEN.
 *
 * Lichess move convention, preserved throughout:
 *
 *   moves[0]        opponent's setup move (played automatically by the trainer)
 *   moves[1]        the player's first solution move
 *   moves[2], …     alternating opponent replies and solution moves
 *
 * Pure module: no Dexie, no DOM. Node-testable.
 */

import { Chess } from 'chess.js';
import type { LichessPuzzleRecord, StoredPuzzle } from './types.ts';
import { LICHESS_ID_PATTERN } from './lichessCsv.ts';
import { toChessComRating } from './tiers.ts';

export const UCI_MOVE_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/**
 * How many moves the solver has to find in a raw Lichess sequence.
 *
 * The first entry is the opponent's setup move, so a `oneMove` puzzle (two
 * entries) counts as 1. Cheap by design: the pool build calls this on millions
 * of rows, so it counts entries instead of replaying the position.
 */
export function solutionMoveCount(moves: readonly string[]): number {
  return moves.length < 2 ? 0 : Math.ceil((moves.length - 1) / 2);
}

/** Worst-case sanity bounds; these are not tier filters. */
export const RATING_SANITY = { min: 1, max: 4000 } as const;
export const MAX_RATING_DEVIATION = 1000;
export const POPULARITY_RANGE = { min: -100, max: 100 } as const;

export interface UciSequence {
  /** FEN after each move, starting with the supplied position. */
  fens: string[];
  /** Side that must solve the puzzle (the side to move after the setup move). */
  solverColor: 'w' | 'b';
  /** The automatically played setup move. */
  setupMove: string;
  /** The player's moves: indices 1, 3, 5, … of the sequence. */
  solutionMoves: string[];
  /** The opponent's replies: indices 2, 4, … of the sequence. */
  replyMoves: string[];
  finalFen: string;
}

/**
 * Replays a UCI sequence, throwing on the first illegal move or bad FEN.
 * This is the single legality check used by validation, selection and imports.
 */
export function replayUciSequence(fen: string, moves: string[]): UciSequence {
  if (moves.length < 2) {
    throw new Error('a puzzle needs a setup move and at least one solution move');
  }

  let game: Chess;
  try {
    game = new Chess(fen);
  } catch {
    throw new Error(`illegal FEN "${fen}"`);
  }

  /* The side to move after one legal move is always the other side, so the
     solver's colour follows from the starting position — no second FEN parse. */
  const initialTurn = game.turn();
  const fens = [game.fen()];
  moves.forEach((notation, index) => {
    if (!UCI_MOVE_PATTERN.test(notation)) {
      throw new Error(`move ${index + 1} is not UCI: "${notation}"`);
    }
    try {
      game.move({
        from: notation.slice(0, 2),
        to: notation.slice(2, 4),
        ...(notation.length === 5 ? { promotion: notation[4] } : {}),
      });
    } catch {
      throw new Error(`move ${index + 1} ("${notation}") is illegal in this position`);
    }
    fens.push(game.fen());
  });

  /* The side to move after the setup move is the one being asked to solve. */
  const solverColor = initialTurn === 'w' ? 'b' : 'w';

  return {
    fens,
    solverColor,
    setupMove: moves[0],
    solutionMoves: moves.filter((_, index) => index % 2 === 1),
    replyMoves: moves.filter((_, index) => index % 2 === 0).slice(1),
    finalFen: game.fen(),
  };
}

/** Boolean convenience wrapper, for quick position checks. */
export function isLegalUciSequence(fen: string, moves: string[]): boolean {
  try {
    replayUciSequence(fen, moves);
    return true;
  } catch {
    return false;
  }
}

export interface PuzzleValidation {
  ok: boolean;
  reason?: string;
  sequence?: UciSequence;
}

/**
 * Full validation of one Lichess record: identifiers, metadata sanity and a
 * legal move sequence under Lichess's setup/solution convention.
 */
export function validateLichessPuzzle(record: LichessPuzzleRecord): PuzzleValidation {
  const id = record.puzzle_id.trim();
  if (!id) return { ok: false, reason: 'empty PuzzleId' };
  if (!LICHESS_ID_PATTERN.test(id)) {
    return { ok: false, reason: `PuzzleId "${id}" is not five alphanumerics` };
  }

  if (!Number.isFinite(record.rating)) return { ok: false, reason: 'rating is not a number' };
  if (record.rating < RATING_SANITY.min || record.rating > RATING_SANITY.max) {
    return { ok: false, reason: `rating ${record.rating} outside ${RATING_SANITY.min}–${RATING_SANITY.max}` };
  }

  if (!Number.isFinite(record.rating_deviation)) {
    return { ok: false, reason: 'rating deviation is not a number' };
  }
  if (record.rating_deviation < 0 || record.rating_deviation > MAX_RATING_DEVIATION) {
    return { ok: false, reason: `rating deviation ${record.rating_deviation} outside 0–${MAX_RATING_DEVIATION}` };
  }

  if (!Number.isFinite(record.popularity)) {
    return { ok: false, reason: 'popularity is not a number' };
  }
  if (record.popularity < POPULARITY_RANGE.min || record.popularity > POPULARITY_RANGE.max) {
    return { ok: false, reason: `popularity ${record.popularity} outside −100–100` };
  }

  if (!Number.isFinite(record.plays) || record.plays < 0) {
    return { ok: false, reason: `nb plays ${record.plays} is not a positive count` };
  }

  if (record.themes.length === 0) return { ok: false, reason: 'no tactical themes' };

  if (record.game_url && !/^https?:\/\//i.test(record.game_url)) {
    return { ok: false, reason: `game URL "${record.game_url}" is not a URL` };
  }

  try {
    const sequence = replayUciSequence(record.fen, record.moves);
    return { ok: true, sequence };
  } catch (cause) {
    return { ok: false, reason: (cause as Error).message };
  }
}

/**
 * Normalized record → the row the `puzzles` table stores.
 *
 * The Lichess rating is converted to the chess.com scale here, the one place
 * the database enters the app, so every stored row, band and display speaks the
 * same rating language.
 */
export function toStoredPuzzle(record: LichessPuzzleRecord): StoredPuzzle {
  return {
    puzzle_id: record.puzzle_id.trim(),
    fen: record.fen.trim(),
    moves: record.moves.join(' '),
    rating: Math.round(toChessComRating(record.rating)),
    rating_deviation: record.rating_deviation,
    popularity: record.popularity,
    plays: record.plays,
    themes: [...record.themes],
    game_url: record.game_url || undefined,
    opening_tags: record.opening_tags.length > 0 ? [...record.opening_tags] : undefined,
    daily_date: record.daily_date || undefined,
    source: 'lichess',
    imported_at: Date.now(),
  };
}
