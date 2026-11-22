import { Chess, type Color, type Square } from 'chess.js';
import type { PersonalityStyle } from './styles.ts';
import type { BookMove } from './repertoires/book.ts';
import {
  NINA_CAUTION_GAP,
  ninaAmbition,
  ninaCanTradeForComfort,
  ninaPrefersCautious,
} from './ninaTraits.ts';

/**
 * Personality-driven move selection.
 *
 * The engine still decides what is good: every move here comes from Stockfish's
 * MultiPV list with its own score attached. Personality only decides *which of
 * the plausible moves* to play. Two guards keep that honest:
 *
 * 1. Elo sets the widest score gap a move may give away (`candidateGapForElo`),
 *    so a 1250 can choose a 140cp worse move while a 2150 may not.
 * 2. Personality adds a small allowance and a few tens of centipawns of taste,
 *    which can reorder near-equal candidates but cannot rescue a losing move.
 *
 * Forced mates bypass taste entirely: if the bot can mate, it mates.
 */

export interface PersonalityCandidate {
  uci: string;
  /** White's point of view, as the engine reports it. */
  scoreCp: number;
  /** White's point of view: +N White mates. */
  mate: number | null;
}

export interface MoveFeatures {
  capture: boolean;
  capturedValue: number;
  check: boolean;
  castle: boolean;
  promotion: boolean;
  develops: boolean;
  centralPawn: boolean;
  toEnemyHalf: boolean;
  movesKing: boolean;
  sacrifices: boolean;
  attacksKing: boolean;
  trades: boolean;
  /** Own material minus opponent material after the move. */
  materialAfter: number;
}

export interface SelectionResult {
  uci: string;
  /** Centipawns given up against the best legal candidate (0 = best). */
  gap: number;
  features: MoveFeatures;
  best: boolean;
}

const PIECE_VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

export function materialOf(game: Chess, color: Color): number {
  let total = 0;
  for (const row of game.board()) {
    for (const piece of row) {
      if (piece && piece.color === color) total += PIECE_VALUE[piece.type] ?? 0;
    }
  }
  return total;
}

function kingSquare(game: Chess, color: Color): Square | null {
  for (const row of game.board()) {
    for (const piece of row) {
      if (piece && piece.color === color && piece.type === 'k') return piece.square;
    }
  }
  return null;
}

function distance(a: Square, b: Square): number {
  const fileGap = Math.abs(a.charCodeAt(0) - b.charCodeAt(0));
  const rankGap = Math.abs(Number(a[1]) - Number(b[1]));
  return Math.max(fileGap, rankGap);
}

/** Everything the scorer needs to know about one candidate, or null if illegal. */
export function describeMove(fen: string, uci: string): MoveFeatures | null {
  const game = new Chess(fen);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci.slice(4, 5) : undefined;

  const before = game.turn();
  const opponent: Color = before === 'w' ? 'b' : 'w';

  let applied;
  try {
    applied = game.move({ from, to, promotion });
  } catch {
    return null;
  }
  if (!applied) return null;

  const movedValue = PIECE_VALUE[applied.piece] ?? 0;
  const capturedValue = applied.captured ? (PIECE_VALUE[applied.captured] ?? 0) : 0;
  const castle = applied.flags.includes('k') || applied.flags.includes('q');
  const opponentKing = kingSquare(game, opponent);
  const attacked = game.attackers(to as Square, opponent).length > 0;
  const defended = game.attackers(to as Square, before).length > 0;
  const backRank = before === 'w' ? '1' : '8';

  return {
    capture: Boolean(applied.captured),
    capturedValue,
    check: game.isCheck(),
    castle,
    promotion: Boolean(applied.promotion),
    develops:
      (applied.piece === 'n' || applied.piece === 'b') && from[1] === backRank,
    centralPawn: applied.piece === 'p' && (to[0] === 'd' || to[0] === 'e'),
    toEnemyHalf: before === 'w' ? to[1] >= '5' : to[1] <= '4',
    /* Castling moves the king, but to safety: it is not the wandering-king
       penalty. */
    movesKing: applied.piece === 'k' && !castle,
    sacrifices: movedValue >= 300 && movedValue > capturedValue + 100 && attacked && !defended,
    attacksKing: Boolean(opponentKing) && distance(to as Square, opponentKing as Square) <= 2,
    trades: capturedValue >= 300,
    materialAfter: materialOf(game, before) - materialOf(game, opponent),
  };
}

/** White material minus Black material for a position. */
export function materialBalance(fen: string): number {
  const game = new Chess(fen);
  return materialOf(game, 'w') - materialOf(game, 'b');
}

/** The widest score gap a move may give away at a given rating. */
export function candidateGapForElo(elo: number): number {
  if (elo < 1300) return 140;
  if (elo < 1500) return 115;
  if (elo < 1700) return 100;
  if (elo < 2000) return 90;
  if (elo < 2100) return 80;
  if (elo < 2200) return 70;
  if (elo < 2325) return 60;
  return 50;
}

/** How much evaluation a character will trade for a move it likes. */
function personalityAllowance(style: PersonalityStyle): number {
  return Math.round(4 + style.risk * 0.18 + style.aggression * 0.12);
}

/**
 * A second, smaller dial on how far taste may outrank evaluation, on top of
 * `PersonalityStyle.accuracy`.
 *
 * `accuracy` is resolved from the rating by `styleFor` (0.85 at club level up to
 * 2.45 at the top), so evaluation already outranks taste more at higher ratings.
 * This scales the taste *bonus* itself as well: full weight below 1000, a tenth
 * at 2400+. It exists because accuracy alone still let a ~25 cp style nudge beat
 * a 20 cp evaluation gap, which is enough to keep a 2800 off the engine's line.
 */
function tasteScale(elo: number): number {
  /* Taste is a near-tie breaker, never a strength dial: a profile's maximum
     bonus is a few tens of centipawns, so at club level it may swing a 15-20 cp
     decision and at the top it may only swing a handful. Above 2400 it stops
     shrinking — those bots still have a character, they just do not trade real
     evaluation for it. */
  if (elo <= 1000) return 0.6;
  if (elo >= 2400) return 0.1;
  return 0.6 - ((elo - 1000) / 1400) * 0.5;
}

function featureScore(
  style: PersonalityStyle,
  features: MoveFeatures,
  botPov: number,
): number {
  const t = (value: number) => value / 100;
  let score = 0;

  /* Bonuses are deliberately small — a few centipawns each, tens at most for a
     profile at its strongest. They decide near-equal moves; evaluation decides
     the rest. */
  score += t(style.aggression) * ((features.check ? 6 : 0) + (features.attacksKing ? 5 : 0) + (features.toEnemyHalf ? 3 : 0) + (features.capture ? 2 : 0));
  score += t(style.risk) * ((features.sacrifices ? 8 : 0) + (features.check ? 3 : 0) + (features.attacksKing ? 3 : 0));
  score += t(style.positional) * ((features.develops ? 4 : 0) + (features.castle ? 5 : 0) + (features.centralPawn ? 3 : 0));
  score += t(style.tactical) * ((features.capture ? 4 : 0) + (features.check ? 4 : 0) + (features.promotion ? 10 : 0) + (features.attacksKing ? 3 : 0));
  score += t(style.defensive) * (botPov < -60 && !features.capture ? 4 : 0) + t(style.defensive) * (features.trades ? 2 : 0);
  score += t(style.initiative) * ((features.develops ? 3 : 0) + (features.toEnemyHalf ? 4 : 0) + (features.check ? 3 : 0));
  score += t(style.simplification) * ((features.trades ? 5 : 0) + (features.capture ? 2 : 0) + (botPov > 150 && features.trades ? 4 : 0));
  score += t(style.complexity) * ((features.capture ? 0 : 2) + (features.sacrifices ? 4 : 0));
  score += t(style.kingSafety) * ((features.castle ? 6 : 0) + (features.movesKing ? -8 : 0) + (features.develops ? 1 : 0));
  score += t(style.material) * ((features.capture ? 4 : 0) + (features.promotion ? 8 : 0) + (features.sacrifices ? -12 : 0));
  score += t(style.activePieces) * ((features.develops ? 3 : 0) + (features.toEnemyHalf ? 2 : 0));

  return score;
}

/**
 * Picks one move from the engine's candidates.
 *
 * Returns null only when every candidate is illegal for this position (which
 * means the engine and the board disagree — the caller then falls back).
 */
export function choosePersonalityMove(input: {
  fen: string;
  candidates: readonly PersonalityCandidate[];
  style: PersonalityStyle;
  elo: number;
  random?: () => number;
}): SelectionResult | null {
  const { fen, candidates, style, elo } = input;
  const random = input.random ?? Math.random;
  const game = new Chess(fen);
  const white = game.turn() === 'w';
  const sign = white ? 1 : -1;

  interface Evaluated {
    uci: string;
    scoreCp: number;
    mate: number | null;
    botPov: number;
    botMate: number | null;
    features: MoveFeatures;
  }

  const legal: Evaluated[] = [];
  for (const candidate of candidates) {
    const features = describeMove(fen, candidate.uci);
    if (!features) continue;
    legal.push({
      uci: candidate.uci,
      scoreCp: candidate.scoreCp,
      mate: candidate.mate,
      botPov: sign * candidate.scoreCp,
      botMate: candidate.mate === null ? null : sign * candidate.mate,
      features,
    });
  }

  if (legal.length === 0) return null;

  /* A forced mate is not a style question. */
  const mates = legal.filter((entry) => entry.botMate !== null && entry.botMate > 0);
  if (mates.length > 0) {
    mates.sort((a, b) => (a.botMate ?? 99) - (b.botMate ?? 99));
    const chosen = mates[0];
    return { uci: chosen.uci, gap: 0, features: chosen.features, best: true };
  }

  const bestPov = Math.max(...legal.map((entry) => entry.botPov));
  const allowance = candidateGapForElo(elo) + personalityAllowance(style);

  const scored = legal
    .map((entry) => {
      const gap = bestPov - entry.botPov;
      return {
        ...entry,
        gap,
        score: -gap * style.accuracy + featureScore(style, entry.features, entry.botPov) * tasteScale(elo),
      };
    })
    .filter((entry) => entry.gap <= allowance);

  if (scored.length === 0) {
    const best = legal.find((entry) => entry.botPov === bestPov) ?? legal[0];
    return { uci: best.uci, gap: bestPov - best.botPov, features: best.features, best: true };
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  /* Near-ties are decided with a little human unpredictability. */
  const rivals = scored.filter((entry) => top.score - entry.score <= 4);
  let chosen = rivals.length > 1 && random() < 0.5
    ? rivals[Math.min(rivals.length - 1, Math.floor(random() * rivals.length))]
    : top;

  /* Nina's defining contradiction: she can see the ambitious move, then choose
     a comfortable one. This only reorders candidates the Elo allowance already
     considers playable, never a losing move, and it switches off when she is
     under pressure or the move simply wins material. */
  if (
    style.id === 'nina' &&
    scored.length > 1 &&
    ninaCanTradeForComfort(chosen.features) &&
    ninaPrefersCautious({
      ambition: ninaAmbition(chosen.features),
      botPov: chosen.botPov,
      random,
    })
  ) {
    const calmer = scored
      .filter(
        (entry) =>
          entry !== chosen &&
          entry.gap <= chosen.gap + NINA_CAUTION_GAP &&
          ninaAmbition(entry.features) < ninaAmbition(chosen.features),
      )
      .sort(
        (a, b) => ninaAmbition(a.features) - ninaAmbition(b.features) || b.score - a.score,
      )[0];
    if (calmer) chosen = calmer;
  }

  return {
    uci: chosen.uci,
    gap: Math.max(0, Math.round(chosen.gap)),
    features: chosen.features,
    best: chosen.gap <= 1,
  };
}

/**
 * Chooses among repertoire moves. Multiple book moves in one position are all
 * fine by definition; the character's opening bias decides which one it likes.
 */
export function chooseBookMove(
  moves: readonly BookMove[],
  style: PersonalityStyle,
  random: () => number = Math.random,
): BookMove | null {
  if (moves.length === 0) return null;

  const weights = moves.map((move) => {
    const bias = move.tags.reduce((total, tag) => total + (style.openingBias[tag] ?? 0), 0);
    return Math.max(0.05, move.weight * (1 + bias / 100));
  });

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  for (let index = 0; index < moves.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return moves[index];
  }
  return moves[moves.length - 1];
}
