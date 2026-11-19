/**
 * Premove rules, kept pure.
 *
 * A premove is an intention, never a move: it is stored as from/to squares and
 * is re-validated against the real position with chess.js when the opponent's
 * move lands. The board uses `premoveTargets` only to draw plausible
 * destinations and to decide whether a queued pawn move needs a promotion
 * piece; nothing here mutates a game or a clock.
 */

import { Chess, type Square } from 'chess.js';
import type { PlayColor } from './types.ts';

export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

export interface Premove {
  from: string;
  to: string;
  /** Only present on a promotion premove; queen when omitted. */
  promotion?: PromotionPiece;
}

export const DEFAULT_PROMOTION: PromotionPiece = 'q';

const PROMOTIONS: readonly PromotionPiece[] = ['q', 'r', 'b', 'n'];

export function isPromotionPiece(value: unknown): value is PromotionPiece {
  return typeof value === 'string' && PROMOTIONS.includes(value as PromotionPiece);
}

/** A FEN with the given side to move and no en-passant target. */
function sideToMoveFen(fen: string, color: PlayColor): string | null {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 6) return null;
  parts[1] = color;
  parts[3] = '-';
  return parts.join(' ');
}

/**
 * Placement with the opponent's non-king pieces removed.
 *
 * Chess.com-style premoves depend on the piece's position and type, not on the
 * rest of the position: you may premove a recapture before the capture exists,
 * or a move that would currently walk into check. Removing the enemy material
 * gives exactly that: our own pieces still block, enemy pieces do not, and the
 * king cannot be in check from pieces that are no longer on the board.
 * `resolvePremove` still validates against the real position when it executes.
 */
function ownSideFen(fen: string, color: PlayColor): string | null {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 6) return null;
  const enemy = color === 'w' ? 'b' : 'w';

  const rows = parts[0].split('/').map((row) => {
    let out = '';
    let empties = 0;
    const flush = () => {
      if (empties > 0) {
        out += empties;
        empties = 0;
      }
    };

    for (const char of row) {
      if (/\d/.test(char)) {
        empties += Number(char);
        continue;
      }
      const pieceColor = char === char.toLowerCase() ? 'b' : 'w';
      const isEnemyKing = pieceColor === enemy && char.toLowerCase() === 'k';
      if (pieceColor === enemy && !isEnemyKing) {
        empties += 1;
        continue;
      }
      flush();
      out += char;
    }
    flush();
    return out || '8';
  });

  parts[0] = rows.join('/');
  parts[1] = color;
  parts[3] = '-';
  return parts.join(' ');
}

/** The two diagonal squares a pawn of `color` could capture towards. */
function pawnDiagonals(from: Square, color: PlayColor): string[] {
  const file = from.charCodeAt(0) - 97;
  const rank = Number(from[1]) + (color === 'w' ? 1 : -1);
  if (rank < 1 || rank > 8) return [];
  return [file - 1, file + 1]
    .filter((index) => index >= 0 && index <= 7)
    .map((index) => `${String.fromCharCode(97 + index)}${rank}`);
}

/**
 * Destination squares a piece may premove to. Used for the selection highlight;
 * legality against the real position is checked when the move executes.
 */
export function premoveTargets(fen: string, from: string, color: PlayColor): string[] {
  const pseudo = ownSideFen(fen, color);
  if (!pseudo) return [];
  try {
    const game = new Chess(pseudo);
    const piece = game.get(from as Square);
    if (!piece || piece.color !== color) return [];

    const targets = new Set<string>(
      game.moves({ square: from as Square, verbose: true }).map((move) => move.to),
    );

    /* Pawn captures are allowed onto empty squares: without them the classic
       "premove the recapture before the opponent takes" is impossible. */
    if (piece.type === 'p') {
      for (const square of pawnDiagonals(from as Square, color)) {
        const occupant = game.get(square as Square);
        if (occupant && occupant.type === 'k' && occupant.color !== color) continue;
        targets.add(square);
      }
    }

    return [...targets];
  } catch {
    return [];
  }
}

/** True when this from/to is a pawn reaching the last rank. */
export function needsPromotion(fen: string, from: string, to: string, color: PlayColor): boolean {
  const pseudo = sideToMoveFen(fen, color);
  if (!pseudo) return false;
  try {
    const game = new Chess(pseudo);
    const piece = game.get(from as Square);
    if (!piece || piece.type !== 'p' || piece.color !== color) return false;
    return to[1] === (color === 'w' ? '8' : '1');
  } catch {
    return false;
  }
}

/** True when from/to is a plausible premove for a piece of `color`. */
export function isPremovable(fen: string, from: string, to: string, color: PlayColor): boolean {
  return premoveTargets(fen, from, color).includes(to);
}

export interface PremoveResolution {
  fen: string;
  premove: Premove | null;
  playerColor: PlayColor;
  turn: PlayColor;
  status: 'playing' | 'finished' | 'idle';
}

/**
 * The premove to execute now, or null.
 *
 * Null when the game is over, it is not the player's turn, the squares no
 * longer form a legal move in the real position (piece gone, king exposed,
 * destination blocked, opponent moved a defender), or the premove was cleared.
 */
export function resolvePremove(input: PremoveResolution): Premove | null {
  const { fen, premove, playerColor, turn, status } = input;
  if (!premove || status !== 'playing' || turn !== playerColor) return null;

  const promotion = needsPromotion(fen, premove.from, premove.to, playerColor)
    ? (premove.promotion ?? DEFAULT_PROMOTION)
    : undefined;

  try {
    const game = new Chess(fen);
    game.move({
      from: premove.from as Square,
      to: premove.to as Square,
      ...(promotion ? { promotion } : {}),
    });
    return { from: premove.from, to: premove.to, ...(promotion ? { promotion } : {}) };
  } catch {
    return null;
  }
}

/** Structural equality, so re-queueing the same premove does not re-sound. */
export function samePremove(a: Premove | null, b: Premove | null): boolean {
  if (!a || !b) return a === b;
  return a.from === b.from && a.to === b.to && (a.promotion ?? null) === (b.promotion ?? null);
}

/* --------------------------------------------------------------------------
   Queues
   -------------------------------------------------------------------------- */

/** Most premoves a player may chain: enough for a forced sequence, not endless. */
export const MAX_PREMOVES = 5;

export type PremoveQueue = readonly Premove[];

function normalize(move: Premove): Premove {
  return {
    from: move.from,
    to: move.to,
    ...(move.promotion ? { promotion: move.promotion } : {}),
  };
}

/**
 * Appends a premove to the queue, or returns null when nothing changed.
 *
 * The queue is a chain of the player's own moves, one per opponent reply, so
 * repeats of the previous entry are dropped and the length is capped. The
 * caller treats null as "no cue, no republish".
 */
export function enqueuePremove(
  queue: PremoveQueue,
  move: Premove,
  max: number = MAX_PREMOVES,
): Premove[] | null {
  const next = normalize(move);
  if (samePremove(queue[queue.length - 1] ?? null, next)) return null;
  if (queue.length >= max) return null;
  return [...queue, next];
}

/**
 * The position the queued moves would reach, with the opponent passing each
 * turn. Used only to draw targets and to validate a further premove; it never
 * touches the real game.
 */
export function premoveQueueFen(
  fen: string,
  queue: PremoveQueue,
  color: PlayColor,
): string {
  let work = sideToMoveFen(fen, color);
  if (!work) return fen;

  for (const move of queue) {
    const current = work;
    try {
      const game = new Chess(current);
      const promotion = needsPromotion(current, move.from, move.to, color)
        ? (move.promotion ?? DEFAULT_PROMOTION)
        : undefined;
      game.move({
        from: move.from as Square,
        to: move.to as Square,
        ...(promotion ? { promotion } : {}),
      });
      work = sideToMoveFen(game.fen(), color) ?? game.fen();
    } catch {
      return current;
    }
  }
  return work;
}

/** SAN for each queued premove, for the queue readout. Best effort, in order. */
export function describePremoveQueue(
  fen: string,
  queue: PremoveQueue,
  color: PlayColor,
): string[] {
  const sans: string[] = [];
  let work = sideToMoveFen(fen, color);
  if (!work) return sans;

  for (const move of queue) {
    const current = work;
    try {
      const game = new Chess(current);
      const promotion = needsPromotion(current, move.from, move.to, color)
        ? (move.promotion ?? DEFAULT_PROMOTION)
        : undefined;
      const applied = game.move({
        from: move.from as Square,
        to: move.to as Square,
        ...(promotion ? { promotion } : {}),
      });
      sans.push(applied.san);
      work = sideToMoveFen(game.fen(), color) ?? game.fen();
    } catch {
      break;
    }
  }
  return sans;
}

export interface PremoveQueueResolution {
  /** The premove to play now, or null when there is nothing playable. */
  move: Premove | null;
  /** Entries still waiting for later opponent replies. */
  remaining: Premove[];
  /** Position after `move` when one was resolved, otherwise the input FEN. */
  fen: string;
}

/**
 * Resolves the head of the queue against the position the opponent just left.
 *
 * One premove executes per opponent reply, because the next one depends on that
 * reply. A head that is no longer legal cancels the whole queue: everything
 * behind it was chosen on the assumption that it would be played.
 */
export interface PremoveQueueRequest {
  fen: string;
  queue: PremoveQueue;
  playerColor: PlayColor;
  turn: PlayColor;
  status: 'playing' | 'finished' | 'idle';
}

export function resolvePremoveQueue(input: PremoveQueueRequest): PremoveQueueResolution {
  const { fen, queue, playerColor, turn, status } = input;
  if (status !== 'playing' || turn !== playerColor || queue.length === 0) {
    return { move: null, remaining: [], fen };
  }

  const head = queue[0];
  const resolved = resolvePremove({ fen, premove: head, playerColor, turn, status });
  if (!resolved) return { move: null, remaining: [], fen };

  const game = new Chess(fen);
  game.move({
    from: resolved.from as Square,
    to: resolved.to as Square,
    ...(resolved.promotion ? { promotion: resolved.promotion } : {}),
  });

  return { move: resolved, remaining: queue.slice(1), fen: game.fen() };
}
