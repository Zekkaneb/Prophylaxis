import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';

/**
 * Guards the weaker bots against free-piece accidents.
 *
 * A low-rated player still understands that a knight or queen should not be
 * left where a pawn can take it. The engine path already prices that in; the
 * "play a random legal move" weakness does not, so this module filters those
 * selections with a small static-exchange check. It never resolves tactics or
 * strengthens the search: it only rejects a move that immediately loses a piece
 * for less than a piece.
 */

const PIECE_VALUE: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

/** A loss at or above this value counts as a piece, not a pawn. */
export const BLUNDER_MATERIAL = 300;

/** Bots below this rating get the guard on random selections. */
export const BLUNDER_GUARD_ELO = 1800;

const MAX_EXCHANGE_DEPTH = 6;

export function guardsAgainstPieceBlunders(elo: number): boolean {
  return elo < BLUNDER_GUARD_ELO;
}

function valueOf(piece: PieceSymbol | undefined): number {
  return piece ? PIECE_VALUE[piece] : 0;
}

function other(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

function legalCapturesOn(fen: string, square: Square, color: Color): Move[] {
  const game = new Chess(fen);
  return game
    .moves({ verbose: true })
    .filter((move) => move.color === color && move.to === square && Boolean(move.captured))
    .sort(
      (a, b) =>
        valueOf(a.piece) - valueOf(b.piece) ||
        valueOf(b.captured) - valueOf(a.captured),
    );
}

/**
 * Net material the side to move can win on one square, assuming both sides
 * take with their least valuable attacker. This is deliberately shallow; it is
 * a "can this piece simply be taken?" test, not a full tactical evaluator.
 */
function exchangeGain(fen: string, square: Square, color: Color, depth: number): number {
  if (depth >= MAX_EXCHANGE_DEPTH) return 0;
  const captures = legalCapturesOn(fen, square, color);
  const capture = captures[0];
  if (!capture) return 0;

  const game = new Chess(fen);
  game.move({
    from: capture.from,
    to: capture.to,
    promotion: capture.promotion,
  });
  const remaining = exchangeGain(game.fen(), square, other(color), depth + 1);
  return Math.max(0, valueOf(capture.captured) - remaining);
}

/** Best immediate material gain available to `color`. */
function bestCaptureGain(fen: string, color: Color): number {
  const game = new Chess(fen);
  let best = 0;
  for (const capture of game.moves({ verbose: true })) {
    if (!capture.captured) continue;
    const next = new Chess(fen);
    next.move({
      from: capture.from,
      to: capture.to,
      promotion: capture.promotion,
    });
    const gain =
      valueOf(capture.captured) - exchangeGain(next.fen(), capture.to, other(color), 1);
    if (gain > best) best = gain;
  }
  return best;
}

function applyUci(fen: string, uci: string): Chess | null {
  const game = new Chess(fen);
  try {
    const move = game.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci.length > 4 ? (uci.slice(4, 5) as PieceSymbol) : undefined,
    });
    return move ? game : null;
  } catch {
    return null;
  }
}

/**
 * True when the move allows the opponent to win material worth a piece or more
 * immediately. The check is position-based, so it also catches a piece left
 * hanging somewhere other than the destination square.
 */
export function isBlatantMaterialBlunder(
  fen: string,
  uci: string,
  threshold = BLUNDER_MATERIAL,
): boolean {
  const game = applyUci(fen, uci);
  if (!game) return false;
  const opponent = other(new Chess(fen).turn());
  return bestCaptureGain(game.fen(), opponent) >= threshold;
}

function uciOf(move: Move): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

/**
 * Picks a random legal move, re-rolling away from free-piece accidents for
 * lower-rated bots. The randomness stays: the move is still arbitrary among
 * the safe legal choices, only the obviously self-destructive choices drop out.
 */
export function chooseRandomLegalMove(
  game: Chess,
  elo: number,
  random: () => number = Math.random,
): string | null {
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return null;
  if (!guardsAgainstPieceBlunders(elo)) {
    return uciOf(moves[Math.floor(random() * moves.length)] ?? moves[0]);
  }

  const fen = game.fen();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const move = moves[Math.floor(random() * moves.length)] ?? moves[0];
    const uci = uciOf(move);
    if (!isBlatantMaterialBlunder(fen, uci)) return uci;
  }

  /* The position may genuinely require giving material. Prefer a move the
     static check accepts; if every move loses a piece, there is nothing to
     protect, so play one rather than freezing. */
  for (const move of moves) {
    const uci = uciOf(move);
    if (!isBlatantMaterialBlunder(fen, uci)) return uci;
  }
  return uciOf(moves[0]);
}
