import { Chess, type PieceSymbol, type Square } from 'chess.js';
import type { PlayColor } from '../../types.ts';
import type { PersonalityStyle } from '../styles.ts';
import { isUnforcedPieceDrop } from '../../uscfClasses.ts';

/**
 * The Hippopotamus system as a plan, for Monkey.
 *
 * The two supplied study chapters only cover the exact move orders in the PGN.
 * A system opening cannot depend on the opponent reproducing a line, so this
 * module states the setup itself and lets the board decide which piece is next:
 *
 *   White: g3, Bg2, d3, Nd2, b3, Bb2, a3, e3, Ne2, O-O.
 *   Black: g6, Bg7, d6, Nd7, e6, h5 (after h4), a6, b5, Ne7, Bb7, O-O.
 *
 * The plan is deliberately a list of quiet setup moves only. It never forces a
 * capture, and it refuses to play while in check or to leave a knight or better
 * hanging with no compensation, because "always the Hippo" cannot mean ignoring
 * a free piece. When no setup move is left the plan returns null and ordinary
 * full-strength engine play takes over.
 */

export interface HippoMove {
  uci: string;
}

export interface HippoPlan {
  /** Ordered preferences: the first move is the one to play. */
  moves: HippoMove[];
}

function pieceAt(
  game: Chess,
  square: string,
  type: PieceSymbol,
  color: PlayColor,
): boolean {
  const piece = game.get(square as Square);
  return Boolean(piece && piece.type === type && piece.color === color);
}

function empty(game: Chess, square: string): boolean {
  return !game.get(square as Square);
}

function canReach(game: Chess, from: string, to: string): boolean {
  return game
    .moves({ square: from as Square, verbose: true })
    .some((move) => move.to === to);
}

/** A quiet, legal move from one own piece to an empty square. */
function quietMove(
  fen: string,
  game: Chess,
  from: string,
  to: string,
  type: PieceSymbol,
  color: PlayColor,
): HippoMove | null {
  if (!pieceAt(game, from, type, color)) return null;
  if (!empty(game, to)) return null;
  if (!canReach(game, from, to)) return null;

  const uci = `${from}${to}`;
  if (isUnforcedPieceDrop(fen, uci)) return null;
  return { uci };
}

/** A legal castle that belongs to the setup. */
function castleMove(fen: string, game: Chess, color: PlayColor): HippoMove | null {
  const kingSquare = color === 'w' ? 'e1' : 'e8';
  const target = color === 'w' ? 'g1' : 'g8';
  if (!pieceAt(game, kingSquare, 'k', color)) return null;

  const castle = game
    .moves({ square: kingSquare as Square, verbose: true })
    .find((move) => move.to === target && move.flags.includes('k'));
  if (!castle) return null;

  const uci = `${kingSquare}${target}`;
  return isUnforcedPieceDrop(fen, uci) ? null : { uci };
}

/**
 * The next Hippo setup move for Monkey, or null when the setup is complete.
 *
 * Returns nothing for any other personality, for the wrong seat, or in check:
 * those are moments for the engine, not for a remembered plan.
 */
export function hippoPlan(
  fen: string,
  color: PlayColor,
  style: PersonalityStyle,
): HippoPlan | null {
  if (style.id !== 'monkey') return null;

  const game = new Chess(fen);
  if (game.turn() !== color || game.inCheck()) return null;

  const moves: HippoMove[] = [];
  const push = (from: string, to: string, type: PieceSymbol) => {
    const move = quietMove(fen, game, from, to, type, color);
    if (move) moves.push(move);
  };

  if (color === 'w') {
    /* The study's exception: after ...h5, 2.Nf3 stops ...h4 before the bishop
       goes to g2. */
    if (pieceAt(game, 'h5', 'p', 'b') && empty(game, 'f3')) {
      push('g1', 'f3', 'n');
    }

    push('g2', 'g3', 'p');
    push('f1', 'g2', 'b');
    push('d2', 'd3', 'p');
    push('b1', 'd2', 'n');
    push('b2', 'b3', 'p');
    push('c1', 'b2', 'b');
    push('a2', 'a3', 'p');
    push('e2', 'e3', 'p');
    push('g1', 'e2', 'n');

    const castle = castleMove(fen, game, color);
    if (castle) moves.push(castle);
  } else {
    push('g7', 'g6', 'p');
    push('f8', 'g7', 'b');
    push('d7', 'd6', 'p');
    push('b8', 'd7', 'n');
    push('e7', 'e6', 'p');

    /* The supplied chapter answers h4 with ...h5; there is no reason to commit
       the h-pawn when White has not. */
    if (pieceAt(game, 'h4', 'p', 'w') || pieceAt(game, 'h5', 'p', 'w')) {
      push('h7', 'h5', 'p');
    }

    push('a7', 'a6', 'p');
    push('b7', 'b5', 'p');
    push('g8', 'e7', 'n');
    push('c8', 'b7', 'b');

    const castle = castleMove(fen, game, color);
    if (castle) moves.push(castle);
  }

  return moves.length > 0 ? { moves } : null;
}
