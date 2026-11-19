import { Chess } from 'chess.js';
import { classifyMoveSound, moveSoundFacts, type SoundEvent } from './audio/soundEvents.ts';

/**
 * Replays a stored move list to positions.
 *
 * Both Game Review and resume use this: review needs every intermediate FEN,
 * resume needs the final one, and both must fail loudly rather than show a
 * half-played game when a record is corrupted.
 */

export interface ReplayPly {
  san: string;
  from: string;
  to: string;
  fenBefore: string;
  fenAfter: string;
}

export interface ReplayResult {
  /** Position the game started from (standard unless a FEN was stored). */
  startingFen: string;
  /** `ply + 1` entries: index 0 is the starting position. */
  fens: string[];
  plies: ReplayPly[];
}

function createBoard(fen?: string): Chess {
  const trimmed = fen?.trim();
  if (!trimmed) return new Chess();
  try {
    return new Chess(trimmed);
  } catch {
    throw new Error('That game starts from an unreadable position.');
  }
}

/** Throws when the start position or any move is invalid. */
export function replaySans(startingFen: string, sans: readonly string[]): ReplayResult {
  const board = createBoard(startingFen);
  const fens = [board.fen()];
  const plies: ReplayPly[] = [];

  sans.forEach((san, index) => {
    const fenBefore = board.fen();
    try {
      const move = board.move(san);
      plies.push({
        san: move.san,
        from: move.from,
        to: move.to,
        fenBefore,
        fenAfter: move.after,
      });
      fens.push(move.after);
    } catch {
      throw new Error(`Move ${index + 1} (“${san}”) does not fit this game.`);
    }
  });

  return { startingFen: fens[0] ?? board.fen(), fens, plies };
}

/**
 * The cue a replayed ply should play, classified from the position before it,
 * so reviewing a game sounds like playing it did.
 *
 * `gameEnd` is deliberately false: the completion cue belongs to the live game
 * that ended, not to every step onto the last move of a review. `playerColor`
 * decides the self/opponent voice; a null (bot-vs-bot) treats both sides as
 * the opponent. Returns null when the ply does not replay, which is the same
 * corruption `replaySans` refuses.
 */
export function replayPlySound(
  ply: ReplayPly,
  playerColor: 'w' | 'b' | null,
): SoundEvent | null {
  try {
    const board = new Chess(ply.fenBefore);
    const move = board.move(ply.san);
    return classifyMoveSound(
      moveSoundFacts(move, {
        side: move.color === playerColor ? 'self' : 'opponent',
        check: board.isCheck(),
        gameEnd: false,
      }),
    );
  } catch {
    return null;
  }
}
