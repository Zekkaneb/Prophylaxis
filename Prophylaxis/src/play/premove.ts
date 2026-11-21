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

/* --------------------------------------------------------------------------
   Geometry

   A premove is queued from the piece's *movement pattern*, not from the
   position: chess.com lets you slide a rook through a blocker, capture onto one
   of your own pieces, push a pawn diagonally onto an empty square in hope of an
   en-passant, or castle as long as the rook is still on its corner. Legality
   is decided later, when the opponent's move lands.
   -------------------------------------------------------------------------- */

/** grid[0] is rank 8, grid[row][col] a piece letter or null. */
type Grid = Array<Array<string | null>>;

const FILES = 'abcdefgh';
const KNIGHT_STEPS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING_STEPS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];
const RAYS: Record<string, ReadonlyArray<readonly [number, number]>> = {
  r: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  b: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  q: [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]],
};

function gridFromFen(fen: string): Grid | null {
  const placement = fen.trim().split(/\s+/)[0];
  if (!placement) return null;
  const rows = placement.split('/');
  if (rows.length !== 8) return null;
  const grid: Grid = [];
  for (const row of rows) {
    const line: Array<string | null> = [];
    for (const char of row) {
      if (/\d/.test(char)) {
        for (let i = 0; i < Number(char); i += 1) line.push(null);
      } else {
        line.push(char);
      }
    }
    if (line.length !== 8) return null;
    grid.push(line);
  }
  return grid;
}

function gridToFen(grid: Grid, fen: string): string {
  const parts = fen.trim().split(/\s+/);
  parts[0] = grid
    .map((row) => {
      let out = '';
      let empty = 0;
      for (const cell of row) {
        if (!cell) {
          empty += 1;
          continue;
        }
        if (empty) {
          out += empty;
          empty = 0;
        }
        out += cell;
      }
      return empty ? out + empty : out;
    })
    .join('/');
  return parts.join(' ');
}

function cellOf(square: string): { row: number; col: number } | null {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  return { row: 8 - Number(square[1]), col: square.charCodeAt(0) - 97 };
}

function squareOf(row: number, col: number): string | null {
  if (row < 0 || row > 7 || col < 0 || col > 7) return null;
  return `${FILES[col]}${8 - row}`;
}

function isOwn(piece: string, color: PlayColor): boolean {
  return color === 'w' ? piece === piece.toUpperCase() : piece === piece.toLowerCase();
}

/**
 * Destination squares for a piece, from its movement pattern alone.
 *
 * Nothing in the position is consulted: rays run to the edge of the board, a
 * knight's jumps are all offered, and a pawn gets its pushes plus both forward
 * diagonals whether or not anything stands there. Own and enemy pieces are all
 * legal destinations, because the premove is stored as from→to and judged
 * against the real board when it fires.
 */
export function geometricTargets(piece: string, from: string): string[] {
  const start = cellOf(from);
  if (!start) return [];
  const type = piece.toLowerCase();
  const out: string[] = [];

  if (type === 'n') {
    for (const [dr, dc] of KNIGHT_STEPS) {
      const square = squareOf(start.row + dr, start.col + dc);
      if (square) out.push(square);
    }
    return out;
  }

  if (type === 'k') {
    for (const [dr, dc] of KING_STEPS) {
      const square = squareOf(start.row + dr, start.col + dc);
      if (square) out.push(square);
    }
    return out;
  }

  if (type === 'p') {
    const forward = piece === piece.toUpperCase() ? -1 : 1;
    const one = squareOf(start.row + forward, start.col);
    if (one) out.push(one);
    const home = piece === piece.toUpperCase() ? 6 : 1;
    const two = squareOf(start.row + forward * 2, start.col);
    if (two && start.row === home) out.push(two);
    for (const dc of [-1, 1]) {
      const capture = squareOf(start.row + forward, start.col + dc);
      if (capture) out.push(capture);
    }
    return out;
  }

  for (const [dr, dc] of RAYS[type] ?? []) {
    let row = start.row + dr;
    let col = start.col + dc;
    for (;;) {
      const square = squareOf(row, col);
      if (!square) break;
      out.push(square);
      row += dr;
      col += dc;
    }
  }
  return out;
}

/**
 * Destination squares a piece may premove to. Used for the selection highlight;
 * legality against the real position is checked when the move executes.
 */
export function premoveTargets(fen: string, from: string, color: PlayColor): string[] {
  const grid = gridFromFen(fen);
  const start = cellOf(from);
  if (!grid || !start) return [];
  const piece = grid[start.row]?.[start.col];
  if (!piece || !isOwn(piece, color)) return [];

  const targets = new Set(geometricTargets(piece, from));

  /* Castling is geometry too: the king moves two squares toward a rook of
     ours that is still standing on its corner. */
  if (piece.toLowerCase() === 'k') {
    const home = color === 'w' ? 7 : 0;
    const rookLetter = color === 'w' ? 'R' : 'r';
    if (start.row === home) {
      for (const [rookCol, kingCol] of [[0, 2], [7, 6]] as const) {
        if (grid[home]?.[rookCol] !== rookLetter) continue;
        const square = squareOf(home, kingCol);
        if (square) targets.add(square);
      }
    }
  }

  return [...targets];
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

/** What one executed premove costs on the clock: a tenth of a second. */
export const PREMOVE_CLOCK_COST_MS = 100;

/**
 * The position the queue *looks* like, piece by piece.
 *
 * This is presentation only: every queued move is applied as a piece sliding
 * from its square to its target, removing whatever stood there (a friendly
 * piece included: chess.com shows the premoving piece on top of it), promoting
 * to a queen, and taking the pawn beside a diagonally-premoved pawn (en
 * passant). Nothing is validated here — that is the point. The real position is
 * untouched and `resolvePremoveQueue` still judges the move when it fires.
 */
export function premoveDisplayFen(
  fen: string,
  queue: PremoveQueue,
  color: PlayColor,
): string {
  if (queue.length === 0) return fen;
  const grid = gridFromFen(fen);
  if (!grid) return fen;

  for (const move of queue) {
    const from = cellOf(move.from);
    const to = cellOf(move.to);
    if (!from || !to) continue;
    const piece = grid[from.row]?.[from.col];
    if (!piece) continue;

    /* A pawn landing diagonally on an empty square takes the pawn beside it:
       that is the en-passant premove, drawn before the target exists. */
    if (piece.toLowerCase() === 'p' && from.col !== to.col && !grid[to.row][to.col]) {
      const victim = grid[from.row]?.[to.col];
      if (victim && victim.toLowerCase() === 'p' && !isOwn(victim, color)) {
        grid[from.row][to.col] = null;
      }
    }

    /* Castling moves the rook as well, so the projected board is complete. */
    if (piece.toLowerCase() === 'k' && Math.abs(to.col - from.col) === 2) {
      const rookCol = to.col > from.col ? 7 : 0;
      const rookTo = to.col > from.col ? to.col - 1 : to.col + 1;
      const rook = grid[from.row][rookCol];
      if (rook && rook.toLowerCase() === 'r' && isOwn(rook, color)) {
        grid[from.row][rookTo] = rook;
        grid[from.row][rookCol] = null;
      }
    }

    const promoting = piece.toLowerCase() === 'p' && to.row === (color === 'w' ? 0 : 7);
    grid[to.row][to.col] = promoting ? (color === 'w' ? 'Q' : 'q') : piece;
    grid[from.row][from.col] = null;
  }

  /* The side to move is left alone on purpose: it is still the opponent's
     turn, and the board routes clicks to the premove path only while that is
     true. Only the placement is projected. */
  return gridToFen(grid, fen);
}

/** Every square a queued premove touches: its origin and its destination. */
export function premoveTintSquares(queue: PremoveQueue): string[] {
  const squares = new Set<string>();
  for (const move of queue) {
    squares.add(move.from);
    squares.add(move.to);
  }
  return [...squares];
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
