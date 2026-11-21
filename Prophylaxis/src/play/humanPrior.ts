import { Chess, type Square } from 'chess.js';

/**
 * Human prior: a tiny log-weight per legal move, added to `evalCp / temp`
 * before softmax sampling.
 *
 * The prior is what makes a weak player's *plausible* move list human: they grab,
 * take back, check, castle, develop and push the centre pawns — and they find
 * pointless rook-pawn pushes, wandering kings, early queens and pieces left
 * hanging much easier to play than a quiet engine move.
 *
 * ---------------------------------------------------------------------------
 * Calibration hooks — every constant below is intended to be refit
 * ---------------------------------------------------------------------------
 * | constant                   | what it changes         | target statistic |
 * | -------------------------- | ----------------------- | ---------------- |
 * | `DEFAULT_PRIOR_WEIGHTS`    | relative pull of each habit | top-1 match rate by |
 * |                            |                         | rating; move-length of |
 * |                            |                         | games by rating |
 * | `PRIOR_TOTAL_CLAMP`        | ceiling on the unscaled logit | blunder rate (higher |
 * |                            |                         | clamp = more habitual, |
 * |                            |                         | less engine-like) |
 * | `PRIOR_STRENGTH_LOW/HIGH`, | how much a rating leans on habits | ACPL by rating |
 * | `PRIOR_STRENGTH_MIDPOINT`, |                         | band |
 * | `PRIOR_STRENGTH_SCALE`     |                         |                  |
 * | `OPENING_*`, `ENDGAME_*`   | phase windows           | opening-repertoire |
 * |                            |                         | adherence        |
 *
 * The values below are hand-set starting points, not fitted numbers.
 */

const PIECE_VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

export interface PriorWeights {
  /** Any capture. */
  capture: number;
  /** Capture where the taken piece outranks the taker. */
  captureGain: number;
  /** Capturing on the square the opponent just captured on. */
  recapture: number;
  /** Giving check. */
  check: number;
  /** Promoting to a queen. */
  promotionQueen: number;
  /** Any under-promotion. */
  underpromotion: number;
  /** Castling inside the opening window. */
  castle: number;
  /** Moving a knight/bishop off its starting square early. */
  develop: number;
  /** c/d/e/f pawn push inside the opening window. */
  centralPawn: number;
  /** Moving the piece that just moved again, with pieces still undeveloped. */
  repeatPiece: number;
  /** a/h pawn push without a tactical purpose. */
  rookPawnPush: number;
  /** Non-castling king move early, not in check. */
  earlyKing: number;
  /** Queen move in the first five moves. */
  earlyQueen: number;
  /** Move that takes a piece out of a cheaper attacker's reach. */
  escape: number;
  /** Move that leaves the piece attacked by something cheaper and under-defended. */
  looksHanging: number;
  /** Passed-pawn push with few pieces left. */
  passedPawnPush: number;
  /** Continues the piece's previous plan. */
  continuity: number;
}

export const DEFAULT_PRIOR_WEIGHTS: PriorWeights = {
  capture: 1.0,
  captureGain: 0.3,
  recapture: 1.5,
  check: 0.5,
  promotionQueen: 1.5,
  underpromotion: -0.5,
  castle: 0.8,
  develop: 0.4,
  centralPawn: 0.4,
  repeatPiece: -0.4,
  rookPawnPush: -0.4,
  earlyKing: -0.8,
  earlyQueen: -0.5,
  escape: 0.8,
  looksHanging: -0.6,
  passedPawnPush: 0.4,
  continuity: 0.3,
};

/** The unscaled total is clamped to ±this before Elo scaling. */
export const PRIOR_TOTAL_CLAMP = 3;

/** Opening windows, in full moves. */
export const OPENING_DEVELOP_MOVES = 12;
export const OPENING_CENTRAL_PAWN_MOVES = 10;
export const OPENING_REPEAT_MOVES = 10;
export const OPENING_ROOK_PAWN_MOVES = 12;
export const OPENING_KING_MOVES = 15;
export const OPENING_QUEEN_MOVES = 5;
export const OPENING_CASTLE_MOVES = 15;
/** Total pieces at or below which the endgame bonuses apply. */
export const ENDGAME_PIECE_COUNT = 14;

export const PRIOR_STRENGTH_LOW = 0.4;
export const PRIOR_STRENGTH_HIGH = 1.4;
/** Elo at which the habit weight is halfway between the two extremes. */
export const PRIOR_STRENGTH_MIDPOINT = 1400;
/** Width of the transition, in Elo. */
export const PRIOR_STRENGTH_SCALE = 300;

/** Kind of move, used only to read the board once per call. */
type Color = 'w' | 'b';

export interface PriorContext {
  /** Rating the move is being played at. */
  elo: number;
  /** UCI of the opponent's last move, if any. */
  lastMove?: string;
  /** This player's previous moves, most recent last. */
  prevOwnMoves?: string[];
  /** Full-move number of the move being chosen. */
  moveNumber: number;
}

/**
 * How strongly a rating leans on the prior: ~1.37 at 400 Elo, ~0.46 at 2200.
 * A logistic in Elo, monotonically non-increasing, clamped to [0.4, 1.4].
 */
export function priorStrength(elo: number): number {
  const rating = Number.isFinite(elo) ? elo : PRIOR_STRENGTH_MIDPOINT;
  const raw =
    PRIOR_STRENGTH_LOW +
    (PRIOR_STRENGTH_HIGH - PRIOR_STRENGTH_LOW) /
      (1 + Math.exp((rating - PRIOR_STRENGTH_MIDPOINT) / PRIOR_STRENGTH_SCALE));
  return Math.min(PRIOR_STRENGTH_HIGH, Math.max(PRIOR_STRENGTH_LOW, raw));
}

interface LegalMove {
  uci: string;
  from: Square;
  to: Square;
  piece: string;
  captured?: string;
  promotion?: string;
  san: string;
  flags: string;
}

interface Prepared {
  weights: PriorWeights;
  strength: number;
  game: Chess;
  color: Color;
  opponent: Color;
  ctx: PriorContext;
  moves: Map<string, LegalMove>;
  /** `attackers(square, color)`, cached for the squares the prior asks about. */
  attackCache: Map<string, Square[]>;
  /** Last UCI of the opponent, when it exists. */
  lastMove: string | null;
  /** Squares this player's own previous moves landed on, most recent last. */
  ownTargets: Square[];
  totalPieces: number;
  undevelopedMinors: number;
  inCheck: boolean;
  /** Enemy pawn squares grouped by file, for passed-pawn detection. */
  enemyPawnFiles: Map<string, number[]>;
}

function fileOf(square: string): string {
  return square[0];
}

function rankOf(square: string): number {
  return Number(square[1]);
}

function valueOf(type: string | undefined): number {
  return type ? (PIECE_VALUE[type] ?? 0) : 0;
}

const KNIGHT_HOME: Record<Color, readonly Square[]> = {
  w: ['b1', 'g1'],
  b: ['b8', 'g8'],
};
const BISHOP_HOME: Record<Color, readonly Square[]> = {
  w: ['c1', 'f1'],
  b: ['c8', 'f8'],
};

function prepare(position: Chess | string, ctx: PriorContext): Prepared {
  const game = typeof position === 'string' ? new Chess(position) : position;
  const color = game.turn() as Color;
  const opponent: Color = color === 'w' ? 'b' : 'w';

  const moves = new Map<string, LegalMove>();
  let totalPieces = 0;
  const enemyPawnFiles = new Map<string, number[]>();

  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece) continue;
      totalPieces += 1;
      if (piece.type === 'p' && piece.color === opponent) {
        const file = fileOf(piece.square);
        const list = enemyPawnFiles.get(file) ?? [];
        list.push(rankOf(piece.square));
        enemyPawnFiles.set(file, list);
      }
    }
  }

  for (const move of game.moves({ verbose: true })) {
    const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
    moves.set(uci, {
      uci,
      from: move.from as Square,
      to: move.to as Square,
      piece: move.piece,
      captured: move.captured,
      promotion: move.promotion,
      san: move.san,
      flags: move.flags,
    });
  }

  let undevelopedMinors = 0;
  for (const square of KNIGHT_HOME[color]) {
    const piece = game.get(square);
    if (piece && piece.color === color && piece.type === 'n') undevelopedMinors += 1;
  }
  for (const square of BISHOP_HOME[color]) {
    const piece = game.get(square);
    if (piece && piece.color === color && piece.type === 'b') undevelopedMinors += 1;
  }

  const ownTargets: Square[] = [];
  for (const uci of ctx.prevOwnMoves ?? []) {
    if (uci.length >= 4) ownTargets.push(uci.slice(2, 4) as Square);
  }

  return {
    weights: DEFAULT_PRIOR_WEIGHTS,
    strength: priorStrength(ctx.elo),
    game,
    color,
    opponent,
    ctx,
    moves,
    attackCache: new Map(),
    lastMove: ctx.lastMove && ctx.lastMove.length >= 4 ? ctx.lastMove : null,
    ownTargets,
    totalPieces,
    undevelopedMinors,
    inCheck: game.isCheck(),
    enemyPawnFiles,
  };
}

function attackersOf(prepared: Prepared, square: Square, color: Color): Square[] {
  const key = `${square}:${color}`;
  const cached = prepared.attackCache.get(key);
  if (cached) return cached;
  const attackers = prepared.game.attackers(square, color);
  prepared.attackCache.set(key, attackers);
  return attackers;
}

/** Cheapest enemy attacker of `square`, if any. */
function cheapestAttacker(prepared: Prepared, square: Square): number {
  let cheapest = Infinity;
  for (const from of attackersOf(prepared, square, prepared.opponent)) {
    const piece = prepared.game.get(from);
    cheapest = Math.min(cheapest, valueOf(piece?.type));
  }
  return cheapest;
}

/** No enemy pawn on this file or an adjacent one, anywhere ahead of `to`. */
function isPassedPawnPush(prepared: Prepared, move: LegalMove): boolean {
  if (move.piece !== 'p') return false;
  const direction = prepared.color === 'w' ? 1 : -1;
  const fileIndex = move.to.charCodeAt(0) - 97;
  const rank = rankOf(move.to);
  for (let df = -1; df <= 1; df += 1) {
    const file = String.fromCharCode(97 + fileIndex + df);
    const ranks = prepared.enemyPawnFiles.get(file);
    if (!ranks) continue;
    for (const enemyRank of ranks) {
      if (direction > 0 ? enemyRank > rank : enemyRank < rank) return false;
    }
  }
  return true;
}

function sameWing(from: Square, to: Square): boolean {
  return (fileOf(from) <= 'd') === (fileOf(to) <= 'd');
}

/**
 * Per-feature contributions of one move. Every key is a raw log-weight in the
 * weight table; the sum is what `makePrior` clamps and scales.
 */
function contributions(prepared: Prepared, move: LegalMove): Record<string, number> {
  const { weights, ctx } = prepared;
  const out: Record<string, number> = {};
  const add = (key: keyof PriorWeights, amount: number) => {
    if (amount === 0) return;
    out[key] = (out[key] ?? 0) + amount;
  };

  const moveNumber = Number.isFinite(ctx.moveNumber) ? ctx.moveNumber : 1;
  const givesCheck = move.san.includes('+') || move.san.includes('#');
  const isCastle = move.flags.includes('k') || move.flags.includes('q');

  /* Captures: the grab, and the extra pull of winning material outright. */
  if (move.captured) {
    add('capture', weights.capture);
    if (valueOf(move.captured) > valueOf(move.piece)) add('captureGain', weights.captureGain);
  }

  /* Take-back on the square the opponent just used. */
  if (prepared.lastMove && prepared.lastMove.slice(2, 4) === move.to) {
    add('recapture', weights.recapture);
  }

  if (givesCheck) add('check', weights.check);

  if (move.promotion) {
    add(move.promotion === 'q' ? 'promotionQueen' : 'underpromotion',
      move.promotion === 'q' ? weights.promotionQueen : weights.underpromotion);
  }

  if (isCastle && moveNumber <= OPENING_CASTLE_MOVES) add('castle', weights.castle);

  const developsMinor =
    (move.piece === 'n' && KNIGHT_HOME[prepared.color].includes(move.from)) ||
    (move.piece === 'b' && BISHOP_HOME[prepared.color].includes(move.from));
  if (developsMinor && moveNumber <= OPENING_DEVELOP_MOVES) add('develop', weights.develop);

  const centralPawn =
    move.piece === 'p' &&
    ['c', 'd', 'e', 'f'].includes(fileOf(move.from)) &&
    Math.abs(rankOf(move.to) - rankOf(move.from)) > 0;
  if (centralPawn && moveNumber <= OPENING_CENTRAL_PAWN_MOVES) add('centralPawn', weights.centralPawn);

  const repeatsPiece =
    prepared.lastMove !== null &&
    prepared.lastMove.slice(2, 4) === move.from &&
    prepared.undevelopedMinors > 0;
  if (repeatsPiece && moveNumber <= OPENING_REPEAT_MOVES) add('repeatPiece', weights.repeatPiece);

  const rookPawnPush =
    move.piece === 'p' &&
    (fileOf(move.from) === 'a' || fileOf(move.from) === 'h') &&
    !move.captured &&
    !givesCheck;
  if (rookPawnPush && moveNumber <= OPENING_ROOK_PAWN_MOVES) add('rookPawnPush', weights.rookPawnPush);

  if (move.piece === 'k' && !isCastle && !prepared.inCheck && moveNumber <= OPENING_KING_MOVES) {
    add('earlyKing', weights.earlyKing);
  }

  if (move.piece === 'q' && moveNumber <= OPENING_QUEEN_MOVES) add('earlyQueen', weights.earlyQueen);

  /* An escape: the piece on `from` can be taken by something cheaper right now. */
  const cheapestOnFrom = cheapestAttacker(prepared, move.from);
  if (Number.isFinite(cheapestOnFrom) && cheapestOnFrom < valueOf(move.piece)) {
    add('escape', weights.escape);
  }

  /* Looks hanging: land on a square a cheaper enemy piece already covers,
     without enough support to make the trade acceptable. */
  const cheapestOnTo = cheapestAttacker(prepared, move.to);
  if (Number.isFinite(cheapestOnTo) && cheapestOnTo < valueOf(move.piece)) {
    /* The moving piece defends its own destination on the current board but
       vacates `from`, so it must not count as support. */
    const defenders = attackersOf(prepared, move.to, prepared.color).filter(
      (square) => square !== move.from,
    ).length;
    const attackers = attackersOf(prepared, move.to, prepared.opponent).length;
    const acceptableCapture = move.captured !== undefined && valueOf(move.captured) >= valueOf(move.piece);
    if (defenders < attackers && !acceptableCapture) add('looksHanging', weights.looksHanging);
  }

  if (prepared.totalPieces <= ENDGAME_PIECE_COUNT && isPassedPawnPush(prepared, move)) {
    add('passedPawnPush', weights.passedPawnPush);
  }

  /* Continuity: the same piece moving again, or a follow-up on the same wing. */
  const previousTarget = prepared.ownTargets[prepared.ownTargets.length - 1];
  if (
    previousTarget &&
    (previousTarget === move.from ||
      (sameWing(previousTarget, move.to) && fileOf(previousTarget) === fileOf(move.to)))
  ) {
    add('continuity', weights.continuity);
  }

  return out;
}

function totalOf(entries: Record<string, number>): number {
  let total = 0;
  for (const value of Object.values(entries)) total += value;
  return total;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Builds the prior for one position.
 *
 * The returned function takes a UCI move and gives its **log-weight** (already
 * Elo-scaled). Illegal or unknown moves return 0, so a caller can safely probe
 * any string. Cheap position data (legal moves, attack maps, development count,
 * enemy pawn files) is computed once here, not per move.
 */
export function makePrior(
  position: Chess | string,
  ctx: PriorContext,
): (uci: string) => number {
  const prepared = prepare(position, ctx);
  return (uci: string): number => {
    const move = prepared.moves.get(uci);
    if (!move) return 0;
    const raw = clamp(totalOf(contributions(prepared, move)), -PRIOR_TOTAL_CLAMP, PRIOR_TOTAL_CLAMP);
    return raw * prepared.strength;
  };
}

/**
 * The same prior, itemised: `{ feature: contribution }` in raw log-weights.
 *
 * The entries are scaled so they always sum to the unclamped-by-Elo total —
 * i.e. the value `makePrior` produces before `priorStrength` is applied. When
 * the raw sum exceeds the clamp, every entry shrinks proportionally, which keeps
 * `sum(explainPrior(...)) === makePrior(...) / priorStrength(elo)` exact.
 */
export function explainPrior(
  position: Chess | string,
  ctx: PriorContext,
  uci: string,
): Record<string, number> {
  const prepared = prepare(position, ctx);
  const move = prepared.moves.get(uci);
  if (!move) return {};

  const entries = contributions(prepared, move);
  const raw = totalOf(entries);
  const clamped = clamp(raw, -PRIOR_TOTAL_CLAMP, PRIOR_TOTAL_CLAMP);
  if (raw === 0 || raw === clamped) return entries;

  const factor = clamped / raw;
  const scaled: Record<string, number> = {};
  for (const [key, value] of Object.entries(entries)) scaled[key] = value * factor;
  return scaled;
}
