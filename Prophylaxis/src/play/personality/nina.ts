import { Chess, type Square } from 'chess.js';
import {
  candidateGapForElo,
  chooseBookMove,
  describeMove,
  type PersonalityCandidate,
  type SelectionResult,
} from './engine.ts';
import type { BookMove } from './repertoires/book.ts';
import type { PersonalityStyle } from './styles.ts';
import { chooseFaadiBookMove } from './faadi.ts';
import { chooseEdwardBookMove } from './edward.ts';
import { chooseBrandonFreshmanBookMove } from './brandonFreshman.ts';

/**
 * Nina Yang's character mechanics.
 *
 * Three behaviours live here, deliberately separate from engine strength:
 *
 * 1. Principle openings. The Jobava study is mostly FEN-based ideas with only
 *    one chapter beginning 1.d4, and nothing covers her answer to 1.d4. The
 *    setup and ...d5 are therefore treated as preferences, not a fabricated
 *    book: each move must be legal, and anything after the first move must also
 *    be one of Stockfish's candidates within her normal allowance. Both Nina
 *    profiles read the same London skeleton, because it is the same opening;
 *    the Freshman simply accepts it less accurately at 1150.
 * 2. Opening memory. Her compiled book is known imperfectly. A controlled roll
 *    can make her leave the book for this game; it never changes the engine's
 *    strength or forces a bad move.
 * 3. Noncommittal selection. When the engine offers both an ambitious and a
 *    comfortable continuation, Nina sometimes takes the comfortable one.
 */

/** The two Nina profiles share her character mechanics but not her strength. */
export type NinaProfileId = 'nina' | 'nina-freshman';

export function isNinaProfile(id: string): id is NinaProfileId {
  return id === 'nina' || id === 'nina-freshman';
}

export type NinaPlanKind = 'first' | 'setup';

export interface NinaPlanMove {
  uci: string;
  kind: NinaPlanKind;
}

export interface NinaPlan {
  moves: NinaPlanMove[];
}

function legal(fen: string, uci: string): boolean {
  const game = new Chess(fen);
  try {
    game.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
    });
    return true;
  } catch {
    return false;
  }
}

function pieceAt(game: Chess, square: string, type: string, color: 'w' | 'b'): boolean {
  const piece = game.get(square as Square);
  return Boolean(piece && piece.type === type && piece.color === color);
}

function pawnOnFile(game: Chess, color: 'w' | 'b', file: string): boolean {
  for (const row of game.board()) {
    for (const piece of row) {
      if (piece && piece.color === color && piece.type === 'p' && piece.square[0] === file) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The principle skeleton for the Jobava London and the ...d5 answer.
 *
 * Returns null when the position is not one of those systems (for example
 * Nina is Black against 1.e4, where the Caro-Kann book takes over).
 */
export function ninaPlan(
  fen: string,
  history: readonly string[],
  style: PersonalityStyle,
  forgotten = false,
): NinaPlan | null {
  if (!isNinaProfile(style.id) || forgotten) return null;
  const game = new Chess(fen);
  const moveNumber = history.length;
  if (moveNumber > 12) return null;

  if (game.turn() === 'w') {
    /* Only the Jobava move order: 1.d4 and no other first move. */
    if (history.length > 0 && history[0] !== 'd4') return null;
    if (history.length > 0 && !pawnOnFile(game, 'w', 'd')) return null;

    const moves: NinaPlanMove[] = [];
    if (history.length === 0) {
      if (legal(fen, 'd2d4')) moves.push({ uci: 'd2d4', kind: 'first' });
    } else {
      if (pieceAt(game, 'b1', 'n', 'w') && !game.get('c3') && legal(fen, 'b1c3')) {
        moves.push({ uci: 'b1c3', kind: 'setup' });
      }
      if (pieceAt(game, 'c1', 'b', 'w') && !game.get('f4') && legal(fen, 'c1f4')) {
        moves.push({ uci: 'c1f4', kind: 'setup' });
      }
      if (pieceAt(game, 'e2', 'p', 'w') && legal(fen, 'e2e3')) {
        moves.push({ uci: 'e2e3', kind: 'setup' });
      }
      if (pieceAt(game, 'g1', 'n', 'w') && !game.get('f3') && legal(fen, 'g1f3')) {
        moves.push({ uci: 'g1f3', kind: 'setup' });
      }
      if (pieceAt(game, 'f1', 'b', 'w') && !game.get('d3') && legal(fen, 'f1d3')) {
        moves.push({ uci: 'f1d3', kind: 'setup' });
      }
      if (legal(fen, 'e1g1')) moves.push({ uci: 'e1g1', kind: 'setup' });
    }
    return moves.length > 0 ? { moves } : null;
  }

  /* Black's intuitive answer: only against a queen's-pawn opening. */
  if (history.length === 0 || history[0] !== 'd4') return null;
  if (history.length === 1) {
    return legal(fen, 'd7d5') ? { moves: [{ uci: 'd7d5', kind: 'first' }] } : null;
  }
  if (!pawnOnFile(game, 'b', 'd')) return null;

  const moves: NinaPlanMove[] = [];
  if (pieceAt(game, 'g8', 'n', 'b') && !game.get('f6') && legal(fen, 'g8f6')) {
    moves.push({ uci: 'g8f6', kind: 'setup' });
  }
  if (pieceAt(game, 'e7', 'p', 'b') && legal(fen, 'e7e6')) {
    moves.push({ uci: 'e7e6', kind: 'setup' });
  }
  if (pieceAt(game, 'f8', 'b', 'b') && legal(fen, 'f8e7')) {
    moves.push({ uci: 'f8e7', kind: 'setup' });
  }
  if (legal(fen, 'e8g8')) moves.push({ uci: 'e8g8', kind: 'setup' });
  return moves.length > 0 ? { moves } : null;
}

/**
 * Takes a principle move only when it is legal and, after the first move, the
 * engine agrees closely enough for a 1550-level player.
 */
export function chooseNinaPlanMove(input: {
  fen: string;
  history: readonly string[];
  style: PersonalityStyle;
  elo: number;
  candidates: readonly PersonalityCandidate[];
  forgotten?: boolean;
}): SelectionResult | null {
  const { fen, history, style, elo, candidates } = input;
  const plan = ninaPlan(fen, history, style, input.forgotten);
  if (!plan) return null;

  const game = new Chess(fen);
  const sign = game.turn() === 'w' ? 1 : -1;
  const bestPov = candidates.length > 0
    ? Math.max(...candidates.map((candidate) => sign * candidate.scoreCp))
    : 0;

  for (const move of plan.moves) {
    const features = describeMove(fen, move.uci);
    if (!features) continue;

    /* The first move is the character's stated repertoire choice. Later setup
       moves must also be among the engine's candidates. */
    const candidate = candidates.find((entry) => entry.uci === move.uci);
    if (!candidate) {
      if (move.kind === 'first') {
        return { uci: move.uci, gap: 0, features, best: true };
      }
      continue;
    }

    const gap = Math.max(0, bestPov - sign * candidate.scoreCp);
    if (move.kind === 'setup' && gap > candidateGapForElo(elo) + 10) continue;
    return { uci: move.uci, gap, features, best: gap <= 1 };
  }

  return null;
}

/* ------------------------------ opening memory ----------------------------- */

export interface OpeningMemoryState {
  /** Once she loses the line, she does not try to re-enter it this game. */
  forgotten: boolean;
}

export function createOpeningMemory(): OpeningMemoryState {
  return { forgotten: false };
}

/**
 * Per-book-move chance of losing the line. Main-line moves are more familiar
 * than branches, and recall gets worse deeper into the line. The cap keeps her
 * from forgetting every few moves.
 */
export function ninaForgetChance(
  move: BookMove,
  ply: number,
  profile: NinaProfileId = 'nina',
): number {
  const branch = move.weight >= 3 ? 1 : 2.2;
  const depth = Math.max(0, ply - 6);
  const familiarity = Math.min(2.5, 1 + depth * 0.08 + Math.max(0, move.lineIds.length - 1) * 0.12);
  /* Freshman has only basic familiarity: she leaves the line more often, and the
     per-move cap is looser, but it stays a rare event rather than a habit. */
  const base = profile === 'nina-freshman' ? 0.028 : 0.012;
  const cap = profile === 'nina-freshman' ? 0.22 : 0.12;
  return Math.min(cap, base * branch * familiarity);
}

export interface NinaBookChoice {
  move: BookMove | null;
  /** True only on the move where she loses the line. */
  forgotten: boolean;
}

/**
 * Chooses a book move, or deliberately leaves the book.
 *
  * A forgotten move is not a blunder generator: the caller simply continues with
 * its ordinary engine/personality selection. Faadi has his own, per-ply recall
 * curve (he can re-enter the book later in the same game); every other
 * character uses their book exactly as before. */
export function chooseNinaBookMove(input: {
  moves: readonly BookMove[];
  style: PersonalityStyle;
  history: readonly string[];
  memory: OpeningMemoryState;
  random?: () => number;
}): NinaBookChoice {
  const random = input.random ?? Math.random;
  if (input.style.id === 'faadi') {
    return chooseFaadiBookMove({
      moves: input.moves,
      style: input.style,
      ply: input.history.length,
      random,
    });
  }
  /* Freshman Brandon knows his Vienna and French better than his mainlines, and
     a forgotten ply costs that move only: the next familiar position is still
     recognised, unlike Nina's per-game memory. */
  if (input.style.id === 'brandon-freshman') {
    return chooseBrandonFreshmanBookMove({
      moves: input.moves,
      style: input.style,
      ply: input.history.length,
      random,
    });
  }
  /* Edward's recall is its own curve: low from the first move, and a forgotten
     ply never ends his book for the game. */
  if (input.style.id === 'edward') {
    return chooseEdwardBookMove({
      moves: input.moves,
      style: input.style,
      ply: input.history.length,
      random,
    });
  }
  if (!isNinaProfile(input.style.id)) {
    return { move: chooseBookMove(input.moves, input.style, random), forgotten: false };
  }
  if (input.memory.forgotten || input.moves.length === 0) {
    return { move: null, forgotten: false };
  }

  const intended = chooseBookMove(input.moves, input.style, random);
  if (!intended) return { move: null, forgotten: false };

  if (random() < ninaForgetChance(intended, input.history.length, input.style.id)) {
    input.memory.forgotten = true;
    return { move: null, forgotten: true };
  }
  return { move: intended, forgotten: false };
}

/* --------------------------- noncommittal selection ------------------------ */

export {
  NINA_CAUTION_GAP,
  ninaAmbition,
  ninaCanTradeForComfort,
  ninaPrefersCautious,
} from './ninaTraits.ts';
