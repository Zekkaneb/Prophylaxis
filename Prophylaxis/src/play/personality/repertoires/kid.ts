import { Chess, type Square } from 'chess.js';
import {
  candidateGapForElo,
  describeMove,
  type PersonalityCandidate,
  type SelectionResult,
} from '../engine.ts';
import type { PersonalityStyle } from '../styles.ts';

/**
 * King's Indian preferences for Sophomore and Junior (Black vs 1.d4).
 *
 * No King's Indian PGN was supplied, and none is invented here: this is a
 * lightweight, principle-based preference layer on top of the engine, in the
 * same spirit as Freshman's rule-based Ruy Lopez. It recognises a King's Indian
 * structure, states which developing moves that structure wants, and then lets
 * engine evaluation decide whether those moves are actually available and
 * sensible in this position.
 *
 * The setup is a preference, never a script:
 *
 *   ...Nf6, ...g6, ...Bg7, ...d6, ...O-O, then ...e5 or ...c5 as the centre
 *   requires.
 *
 * Legal move generation is the first gate (`describeMove` returns null for an
 * illegal or impossible move), and engine evaluation is the second: a preferred
 * move is only played when it appears in Stockfish's MultiPV list and does not
 * give away more than the character's allowance. If White's play makes the
 * King's Indian inappropriate (an early 1.e4, a Queen's Gambit structure, a
 * traded fianchetto bishop), this module returns nothing and normal personality
 * selection takes over.
 *
 * Sophomore, Junior and Bryan share the structure but not the interpretation:
 *
 * - Sophomore is opportunistic: he will break with ...e5 or ...c5 before
 *   castling, prefers the more committal ...e5 when the engine allows it, and
 *   will occasionally push ...f5 once the kingside is his.
 * - Junior is disciplined: he completes the setup and castles first, follows
 *   the structurally correct break, and only plays it when the engine agrees
 *   closely. He never plays a speculative ...f5.
 * - Bryan knows the shape rather than the theory: he develops the setup in
 *   order, castles, then takes the break the centre asks for when the engine is
 *   reasonably happy with it (a wider tolerance than Junior's, since he plays
 *   by feel). No speculative ...f5.
 */

export type KidBreak = 'e5' | 'c5';
export type KidMoveKind = 'setup' | 'break' | 'space';

export interface KidPlanMove {
  uci: string;
  kind: KidMoveKind;
}

export interface KidPlan {
  /** Ordered preferences: the first one that passes every gate is played. */
  moves: KidPlanMove[];
  /** The central break the structure asks for, if it can be played at all. */
  breakPlan: KidBreak | null;
  /** ...Nf6, ...g6, ...Bg7, ...d6 and castling are all in place. */
  setupComplete: boolean;
}

/** White first moves that can transpose into a King's Indian. */
const KID_FIRST_MOVES = new Set(['d4', 'c4', 'Nf3', 'g3']);

function firstWhiteMove(history: readonly string[]): string | null {
  if (history.length === 0) return null;
  return history[0] ?? null;
}

function pawnOn(game: Chess, color: 'w' | 'b', square: string): boolean {
  const piece = game.get(square as Square);
  return Boolean(piece && piece.color === color && piece.type === 'p');
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

function at(game: Chess, square: string, type: string, color: 'w' | 'b'): boolean {
  const piece = game.get(square as Square);
  return Boolean(piece && piece.type === type && piece.color === color);
}

function isLegal(fen: string, uci: string): boolean {
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

/**
 * Is this a position where a King's Indian is still the right plan?
 *
 * Rejects the Pirc assignment (White opened 1.e4), Queen's Gambit structures,
 * and positions where the fianchetto bishop has already been committed
 * elsewhere.
 */
export function isKidOpening(fen: string, history: readonly string[]): boolean {
  const game = new Chess(fen);
  if (game.turn() !== 'b') return false;

  const first = firstWhiteMove(history);
  if (first !== null && !KID_FIRST_MOVES.has(first)) return false;

  /* The structure needs White's d4/c4 centre. 1.Nf3 and 1.g3 are flexible
     enough that ...Nf6 can still lead to it. */
  const flexible = first === 'Nf3' || first === 'g3';
  if (!pawnOn(game, 'w', 'd4') && !pawnOn(game, 'w', 'c4') && !flexible) return false;

  /* ...d5 means a Queen's Gambit-type structure, not a King's Indian. A
     ...e5 pawn is the classical King's Indian centre, but only once the d6
     and g6 pawns are there to support it. */
  if (pawnOn(game, 'b', 'd5')) return false;
  if (pawnOn(game, 'b', 'e5') && (!pawnOn(game, 'b', 'd6') || !pawnOnFile(game, 'b', 'g'))) {
    return false;
  }

  /* The king's bishop must still belong to the fianchetto. */
  if (!at(game, 'f8', 'b', 'b') && !at(game, 'g7', 'b', 'b')) return false;

  return true;
}

function kingOn(game: Chess, square: string, color: 'w' | 'b'): boolean {
  return at(game, square, 'k', color);
}

/**
 * Preferences for the current position, best first. Returns null when the
 * King's Indian does not apply at all; returns a plan with no moves when the
 * setup is finished and no break is currently available or legal.
 */
export function kidPlan(
  fen: string,
  history: readonly string[],
  style: PersonalityStyle,
  random: () => number = Math.random,
): KidPlan | null {
  if (
    style.id !== 'sophomore' &&
    style.id !== 'junior' &&
    style.id !== 'bryan' &&
    style.id !== 'bryan-prime' &&
    style.id !== 'bryan-sophomore'
  ) {
    return null;
  }
  if (!isKidOpening(fen, history)) return null;

  const game = new Chess(fen);
  const junior = style.id === 'junior';
  /* Junior and both Bryan profiles build the structure before any break. */
  const patient =
    junior ||
    style.id === 'bryan' ||
    style.id === 'bryan-prime' ||
    style.id === 'bryan-sophomore';

  const nf6 = at(game, 'f6', 'n', 'b');
  const g6 = at(game, 'g6', 'p', 'b');
  const bg7 = at(game, 'g7', 'b', 'b');
  const d6 = at(game, 'd6', 'p', 'b');
  const castled = kingOn(game, 'g8', 'b');

  const setup: KidPlanMove[] = [];
  if (!nf6 && at(game, 'g8', 'n', 'b') && !game.get('f6') && isLegal(fen, 'g8f6')) {
    setup.push({ uci: 'g8f6', kind: 'setup' });
  }
  if (!g6 && at(game, 'g7', 'p', 'b') && !game.get('g6') && isLegal(fen, 'g7g6')) {
    setup.push({ uci: 'g7g6', kind: 'setup' });
  }
  if (!bg7 && at(game, 'f8', 'b', 'b') && !game.get('g7') && isLegal(fen, 'f8g7')) {
    setup.push({ uci: 'f8g7', kind: 'setup' });
  }
  if (!d6 && at(game, 'd7', 'p', 'b') && !game.get('d6') && isLegal(fen, 'd7d6')) {
    setup.push({ uci: 'd7d6', kind: 'setup' });
  }
  if (!castled && isLegal(fen, 'e8g8')) {
    setup.push({ uci: 'e8g8', kind: 'setup' });
  }

  const setupComplete = nf6 && g6 && bg7 && d6 && castled;
  const coreReady = nf6 && g6 && bg7 && d6;

  /* Which central break does White's centre ask for? */
  const whiteE4 = pawnOn(game, 'w', 'e4');
  const whiteC4 = pawnOn(game, 'w', 'c4');
  const structural: KidBreak = whiteE4 ? 'e5' : whiteC4 ? 'c5' : 'e5';

  const breaks: KidBreak[] = [];
  const canE5 = d6 && at(game, 'e7', 'p', 'b') && !game.get('e5') && isLegal(fen, 'e7e5');
  const canC5 = at(game, 'c7', 'p', 'b') && !game.get('c5') && isLegal(fen, 'c7c5');
  if (coreReady) {
    const wantE5 = structural === 'e5';
    /* Sophomore is willing to commit to the more ambitious ...e5 even when the
       structure points at ...c5; Junior and Bryan follow the structure. */
    const ambition = !patient && canE5 && random() < 0.3;
    if (wantE5 || ambition) {
      if (canE5) breaks.push('e5');
      if (canC5) breaks.push('c5');
    } else {
      if (canC5) breaks.push('c5');
      if (canE5) breaks.push('e5');
    }
  }

  const breakMoves: KidPlanMove[] = breaks.map((move) => ({
    uci: move === 'e5' ? 'e7e5' : 'c7c5',
    kind: 'break',
  }));
  const breakPlan = breaks[0] ?? null;

  /* A ready ...e5 gives Sophomore an occasional kingside gesture: the f6
     knight swings to h5, where it eyes f4 and supports a later ...f5. Junior
     keeps the knight at home until the engine has a concrete reason. */
  const space: KidPlanMove[] = [];
  const whiteKingShort = kingOn(game, 'g1', 'w');
  if (
    !patient &&
    castled &&
    whiteKingShort &&
    at(game, 'e5', 'p', 'b') &&
    at(game, 'f6', 'n', 'b') &&
    !game.get('h5') &&
    isLegal(fen, 'f6h5') &&
    random() < 0.25
  ) {
    space.push({ uci: 'f6h5', kind: 'space' });
  }

  let moves: KidPlanMove[];
  if (patient) {
    /* Setup first, always; the break waits for castling. */
    moves = setupComplete ? breakMoves : setup;
  } else if (setup.length > 0 && !coreReady) {
    /* Until the core is built, even the opportunist develops. */
    moves = setup;
  } else {
    /* Sophomore may break before castling. */
    moves = [...space, ...breakMoves, ...setup];
  }

  return { moves, breakPlan, setupComplete };
}

/**
 * Picks a King's Indian move from the engine's candidates.
 *
 * Returns null whenever the plan has nothing suitable — no candidate, an
 * illegal move, or a move the engine rates too poorly for this character — so
 * the caller falls back to ordinary personality selection.
 */
export function chooseKidMove(input: {
  fen: string;
  history: readonly string[];
  style: PersonalityStyle;
  elo: number;
  candidates: readonly PersonalityCandidate[];
  random?: () => number;
}): SelectionResult | null {
  const { fen, history, style, elo, candidates } = input;
  if (candidates.length === 0) return null;

  const plan = kidPlan(fen, history, style, input.random);
  if (!plan || plan.moves.length === 0) return null;

  const game = new Chess(fen);
  const sign = game.turn() === 'w' ? 1 : -1;
  const bestPov = Math.max(...candidates.map((candidate) => sign * candidate.scoreCp));
  const base = candidateGapForElo(elo);
  const breakTolerance =
    style.id === 'junior'
      ? 20
      : style.id === 'bryan'
        ? 45
        : style.id === 'bryan-prime'
          ? 35
          : style.id === 'bryan-sophomore'
            /* A defender commits to a break only when it is clearly sound. */
            ? 40
            : 60;

  for (const move of plan.moves) {
    const features = describeMove(fen, move.uci);
    if (!features) continue;

    const candidate = candidates.find((entry) => entry.uci === move.uci);
    if (!candidate) continue;

    const gap = Math.max(0, bestPov - sign * candidate.scoreCp);
    /* Setup moves are ordinary developing choices and get the normal Elo
       allowance. The break is a commitment: Junior needs the engine to agree
       closely, Bryan accepts a little more (he plays by feel), Sophomore the
       most. */
    const tolerance = move.kind === 'setup' ? base : breakTolerance;
    if (gap > tolerance) continue;

    return { uci: move.uci, gap, features, best: gap <= 1 };
  }

  return null;
}
